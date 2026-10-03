import { addFinding, isNonEmptyString, isPositiveNumber, isRecord } from "./shared.mjs";
import { areCutsAdjacent, captionsHaveRenderableCues, collectFitBasisCandidates, cutOverlapFrames, findCrossTrackLayerEvacuations, isStillImageSourcePath, planTransitionHandleWindow, withoutItemAnchors } from "./external.mjs";

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
    message: "fit 互換モードで描画中。`normalize-geometry` で実寸基準へ移行できます",
    path: "edit.json#output.geometry",
  });
}

export function validateTransitionAdjacency(cuts, segments, sources, fps, findings) {
  const sourcePaths = new Map((Array.isArray(sources) ? sources : [])
    .filter(source => isRecord(source) && typeof source.id === "string")
    .map(source => [source.id, source.path]));
  const isStillCut = cut => isStillImageSourcePath(sourcePaths.get(cut?.src) ?? cut?.src);
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
    if (overlapFrames === 0) {
      const outgoingCut = cuts?.[earlier.index];
      const incomingCut = cuts?.[later.index];
      const incomingSpeed = isPositiveNumber(incomingCut?.speed) ? incomingCut.speed : 1;
      const plan = planTransitionHandleWindow({
        declaredSeconds: transition.duration,
        outgoingTailRoomSeconds: Number.POSITIVE_INFINITY,
        incomingHeadRoomSeconds: isStillCut(incomingCut)
          ? Number.POSITIVE_INFINITY : Math.max(0, Number(incomingCut?.in) || 0) / incomingSpeed,
        outgoingDurationSeconds: Math.max(0, earlier.end - earlier.start),
        incomingDurationSeconds: Math.max(0, later.end - later.start),
      });
      if (plan.effectiveSeconds <= 0) {
        addFinding(findings, {
          severity: "warning",
          check: "cuts.transition-out.zero-overlap",
          message: "トランジションを宣言していますが、のりしろにできる素材の余りがないため効きません。素材のトリムを調整するか、トランジションを削除してください。",
          path: `edit.json#cuts[${earlier.index}].transition_out`,
          range: { start: earlier.end, end: later.start },
        });
      }
      continue;
    }
    // 正の重なりは、宣言尺未満なら既存の短縮クランプ、宣言尺超なら track-overlap が担当する。
    if (overlapFrames > 0 || areCutsAdjacent(
      { tlEnd: earlier.end, transitionOut: { duration: transition.duration } },
      { tlStart: later.start },
      fps,
    )) continue;
    addFinding(findings, {
      severity: "error",
      check: "cuts.transition-out.non-adjacent",
      message: "transition_out の次のクリップとの間にすき間があります。すき間を詰めるか、トランジションを削除してください。",
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
        ? `このクリップは他トラックのアイテム（${cause.causeItemId}）と重なっているため PiP 経路へ退避され、宣言したトランジションは書き出されません。`
        : "このクリップは合成機能または同一トラック内の重なりにより PiP 経路へ退避され、宣言したトランジションは書き出されません。";
      addFinding(findings, {
        severity: "warning",
        check: "cuts.transition-out.layer-evacuated",
        message: `${reason}重なりを解消するか、トランジションを削除してください。`,
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
    message: 'captions.json に描画対象 cue がありますが字幕トラックが未宣言です。現状は暗黙補完で表示自体はされています。visual トラックの items[] に { "id": "captions", "name": "字幕", "at": 0, "duration": <出力尺>, "source": { "kind": "captions", "path": "captions.json" }, "items": [] } を追加してください。',
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
