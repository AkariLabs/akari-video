import { addFinding, isNonEmptyString, isPositiveNumber, isRecord } from "./shared.mjs";
import { freezeDurationSeconds } from '../cut-timeline.mjs';
import { lintText, lintTextWithFallback } from '../i18n.mjs';
import { areCutsAdjacent, captionsHaveRenderableCues, collectFitBasisCandidates, cutOverlapFrames, findCrossTrackLayerEvacuations, isStillImageSourcePath, planTrackTransitions, transitionPlanClipsFromCuts, withoutItemAnchors } from "./external.mjs";

/**
 * 幾何の統一 G1: `output.geometry` を持たない v2 文書は fit 互換モード（出力へ contain fit した後に
 * transform）で描かれる。実寸基準へ移行できる media item があることを 1 件の warning で知らせる。
 * error にはしない（既存プロジェクトの CI を壊さないため）。移行後（`"source"`）は出さない。
 */
export function validateGeometryFitCompat(rawEdit, internalEdit, findings) {
  if (!isRecord(rawEdit) || rawEdit.version !== 2) return;
  if (isRecord(rawEdit.output) && rawEdit.output.geometry === "source") return;
  if (collectFitBasisCandidates(internalEdit).length === 0) return;
  addFinding(findings, {
    severity: "warning",
    check: "geometry.fit-compat",
    message: lintText('lint-messages.geometry.fit.compat'),
    path: "edit.json#output.geometry",
  });
}

export function validateTransitionAdjacency(cuts, segments, sources, fps, findings) {
  const sourcePaths = new Map((Array.isArray(sources) ? sources : [])
    .filter(source => isRecord(source) && typeof source.id === "string")
    .map(source => [source.id, source.path]));
  const isStillCut = cut => isStillImageSourcePath(sourcePaths.get(cut?.src) ?? cut?.src);
  const planCuts = (Array.isArray(cuts) ? cuts : []).map(cut => ({
    ...cut, transitionOut: cut?.transition_out ?? cut?.transitionOut
  }));
  for (const track of transitionPlanClipsFromCuts(planCuts, {
    fps, resolve: cut => ({ stillImage: isStillCut(cut), freezeSeconds: freezeDurationSeconds(cut?.freeze) })
  })) {
    for (const plan of planTrackTransitions(track.clips, { fps })) {
      if (plan.legacyOverlap || plan.state === 'ok') continue;
      const earlierIndex = Number(plan.earlierId);
      const laterIndex = Number(plan.laterId);
      const earlier = segments.find(segment => segment.index === earlierIndex);
      const later = segments.find(segment => segment.index === laterIndex);
      const path = `edit.json#cuts[${earlierIndex}].transition_out`;
      if (plan.state === 'none') {
        addFinding(findings, {
          severity: 'warning', check: 'cuts.transition-out.zero-overlap',
          message: lintText('lint-messages.cuts.transition.zeroOverlap'), path,
          ...(earlier && later ? { range: { start: earlier.end, end: later.start } } : {})
        });
      } else {
        const seconds = plan.effectiveSeconds;
        const reason = plan.reasons.join(', ') || 'available handles';
        addFinding(findings, {
          severity: 'info', check: 'cuts.transition-out.shortened',
          message: lintTextWithFallback('lint-messages.cuts.transition.shortened',
            { seconds, declared: plan.declaredSeconds, reason },
            `Transition shortened from ${plan.declaredSeconds} s to ${seconds} s (${reason}).`),
          path,
          range: { start: plan.cutSeconds + plan.startOffsetSeconds, end: plan.cutSeconds + plan.endOffsetSeconds }
        });
      }
    }
  }
  for (let position = 0; position < segments.length; position += 1) {
    const earlier = segments[position];
    const transition = cuts?.[earlier.index]?.transition_out;
    if (!isRecord(transition) || !isPositiveNumber(transition.duration)) continue;
    const later = segments.slice(position + 1).find(candidate => candidate.track === earlier.track);
    if (!later) continue;
    const overlapFrames = cutOverlapFrames(
      { tlEnd: earlier.end },
      { tlStart: later.start },
      fps,
    );
    if (overlapFrames === 0) continue;
    // 正の重なりは、宣言尺未満なら既存の短縮クランプ、宣言尺超なら track-overlap が担当する。
    if (overlapFrames > 0 || areCutsAdjacent(
      { tlEnd: earlier.end, transitionOut: { duration: transition.duration } },
      { tlStart: later.start },
      fps,
    )) continue;
    addFinding(findings, {
      severity: "error",
      check: "cuts.transition-out.non-adjacent",
      message: lintText('lint-messages.cuts.transition.nonAdjacent'),
      path: `edit.json#cuts[${earlier.index}].transition_out`,
      range: { start: earlier.end, end: later.start },
    });
  }
}

export function validateTransitionLayerEvacuations(rawEdit, internalEdit, findings) {
  if (!isRecord(rawEdit) || rawEdit.version !== 2) return;
  const crossTrackCauses = new Map();
  for (const cause of findCrossTrackLayerEvacuations(withoutItemAnchors(rawEdit))) {
    if (!crossTrackCauses.has(cause.itemId)) crossTrackCauses.set(cause.itemId, cause);
  }
  const rawLocations = new Map();
  if (Array.isArray(rawEdit.tracks)) {
    rawEdit.tracks.forEach((track, trackIndex) => {
      if (!isRecord(track) || !Array.isArray(track.items)) return;
      track.items.forEach((item, itemIndex) => {
        if (isRecord(item) && typeof item.id === "string") {
          rawLocations.set(item.id, { trackIndex, itemIndex });
        }
      });
    });
  }
  for (const track of internalEdit.tracks) {
    for (const item of track.items) {
      const transition = item.declaration?.transition_out;
      if (item.legacy.collection !== "layers" || !isRecord(transition)) continue;
      const location = rawLocations.get(item.id);
      const cause = crossTrackCauses.get(item.id);
      const reason = cause
        ? lintText('lint-messages.cuts.transition.evacuatedCrossTrack', { id: cause.causeItemId })
        : lintText('lint-messages.cuts.transition.evacuatedComposite');
      addFinding(findings, {
        severity: "warning",
        check: "cuts.transition-out.layer-evacuated",
        message: lintText('lint-messages.cuts.transition.evacuatedGuidance', { reason }),
        path: location
          ? `edit.json#tracks[${location.trackIndex}].items[${location.itemIndex}].source.transition_out`
          : `edit.json#tracks[${track.z}].items`,
        ...(cause ? {
          range: {
            start: cause.overlapStartFrames / internalEdit.output.fps,
            end: cause.overlapEndFrames / internalEdit.output.fps,
          },
        } : {}),
      });
    }
  }
}

export function validateCaptionTrackDeclaration(rawEdit, captionsRoot, findings) {
  if (!isRecord(rawEdit) || rawEdit.version !== 2
    || !captionsHaveRenderableCues(captionsRoot)) return;
  const declared = Array.isArray(rawEdit.tracks) && rawEdit.tracks.some(
    track => isDeclaredCaptionTrack(track),
  );
  if (declared) return;
  addFinding(findings, {
    severity: "warning",
    check: "v2.captions-track-undeclared",
    message: lintText('lint-messages.captions.track.undeclared'),
    path: "edit.json#tracks",
  });
}

function isDeclaredCaptionTrack(track) {
  return isRecord(track) && (
    (isRecord(track.content) && track.content.from === "captions.json")
    || (Array.isArray(track.items) && track.items.some(
      item => isRecord(item) && isRecord(item.source) && item.source.kind === "captions",
    ))
  );
}

export function projectAudioForLint(internalEdit) {
  const sfx = [];
  const narration = [];
  let bgm;
  for (const track of internalEdit.tracks) {
    if (track.lane !== "audio") continue;
    for (const item of track.items) {
      if (!isRecord(item.declaration)) continue;
      const declaration = { ...item.declaration };
      if (item.legacy.collection === "sfx") sfx.push(declaration);
      if (item.legacy.collection === "narration") narration.push(declaration);
      if (item.legacy.collection === "bgm") bgm = declaration;
    }
  }
  return {
    ...(sfx.length > 0 ? { sfx } : {}),
    ...(narration.length > 0 ? { narration } : {}),
    ...(bgm !== undefined ? { bgm } : {}),
  };
}

export function collectAudioOnlySourceIds(edit) {
  if (!Array.isArray(edit?.tracks)) return new Set();
  const audio = new Set();
  const visual = new Set();
  for (const track of edit.tracks) {
    if (!isRecord(track) || !Array.isArray(track.items)) continue;
    for (const item of track.items) {
      const sourceId = isRecord(item?.source) && item.source.kind === "media"
        ? item.source.src : undefined;
      if (!isNonEmptyString(sourceId)) continue;
      if (track.lane === "audio") audio.add(sourceId);
      if (track.lane === "visual") visual.add(sourceId);
    }
  }
  return new Set([...audio].filter(sourceId => !visual.has(sourceId)));
}
