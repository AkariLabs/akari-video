import { segmentDuration } from "../cut-timeline.mjs";
import { EPSILON, addFinding, formatNumber, isFiniteNumber, isNonEmptyString, isPositiveNumber, isRecord } from "./shared.mjs";
import { TRANSITION_TYPE_IDS, areCutsAdjacent, findUnsupportedDeclaredTrackTransitions, isStillImageSourcePath } from "./external.mjs";

export function collectInternalAudioTrackRefs(internalEdit) {
  return new Set(internalEdit.tracks
    // v2 top-level audio は読み込み層が implicit audio track へ射影するが、元データに
    // tracks[] 宣言は無い。これを実段として数えると declaration-missing が必ず出る。
    // validateTimelineTracks が照合する相手は projectLegacyEdit の declaredTracks なので、
    // 実データ側も同じ declared origin に限定して投影ノイズを除く。
    .filter(track => track.origin === "declared" && track.lane === "audio" && track.items.length > 0)
    .map(track => Number.isInteger(track.legacy.ref) ? track.legacy.ref : 0));
}

function validateTransitionOut(value, findings, path) {
  if (value === undefined || value === null) return;
  if (!isRecord(value)) {
    addFinding(findings, { severity: "error", check: "cuts.transition-out.structure", message: "transition_out must be an object", path });
    return;
  }
  if (!TRANSITION_TYPE_IDS.includes(value.type)) {
    addFinding(findings, { severity: "error", check: "cuts.transition-out.type", message: `type must be ${TRANSITION_TYPE_IDS.join("/")}`, path });
  }
  if (!isPositiveNumber(value.duration)) {
    addFinding(findings, { severity: "error", check: "cuts.transition-out.duration", message: "duration must be a positive number", path });
  }
}

// at 省略 = 同一 track 内で直前カットの直後（既存ファイルは全カット track 省略=0・
// at 省略なので、この既定は従来のギャップレス連結と完全に同値 = 後方互換）
export function computeCutTrackSegments(cuts) {
  if (!Array.isArray(cuts)) return [];
  const cursorByTrack = new Map();
  const segments = [];
  for (const [index, cut] of cuts.entries()) {
    if (!isRecord(cut) || !isFiniteNumber(cut.in) || !isFiniteNumber(cut.out) || cut.out <= cut.in) {
      continue;
    }
    const hasValidTrack = Object.hasOwn(cut, "track") && Number.isInteger(cut.track) && cut.track >= 0;
    const track = hasValidTrack ? cut.track : 0;
    const duration = segmentDuration(cut);
    const cursor = cursorByTrack.get(track) ?? 0;
    const hasValidAt = Object.hasOwn(cut, "at") && isFiniteNumber(cut.at) && cut.at >= 0;
    const start = hasValidAt ? cut.at : cursor;
    const end = start + duration;
    cursorByTrack.set(track, end);
    segments.push({ index, track, start, end });
  }
  return segments;
}

export function findTrackOverlaps(segments) {
  const byTrack = new Map();
  for (const segment of segments) {
    if (!byTrack.has(segment.track)) byTrack.set(segment.track, []);
    byTrack.get(segment.track).push(segment);
  }
  const overlaps = [];
  for (const list of byTrack.values()) {
    list.sort((a, b) => a.start - b.start);
    for (let i = 1; i < list.length; i += 1) {
      if (list[i].start < list[i - 1].end - EPSILON) {
        overlaps.push(list[i]);
      }
    }
  }
  return overlaps;
}

// P0 2026-08-21 render-path-unification (MAJOR-3 fix, Codex review): render-cut now auto-clamps
// a declared transition_out.duration down to whatever overlap an explicit `at` actually provides
// (packages/render-cut/src/cut-timeline.mjs's effectiveTransitionDurations) whenever that overlap
// is real (positive) but shorter than declared, rendering a genuinely shorter dissolve instead of
// silently hard-cutting and dropping frames -- so this check must accept that same range as a
// valid, declared transition (not only an exact duration match), or a project render-cut can now
// render correctly would still fail lint. Still rejects zero/negative overlap (a genuine gap --
// no transition is physically possible) and overlap greater than declared (an unrelated shape
// render-cut does not auto-adjust for -- see effectiveTransitionDurations' own comment).
function isDeclaredTransitionOverlap(cuts, segments, current, fps) {
  const previous = segments
    .filter(segment => segment.track === current.track && segment.index < current.index)
    .sort((left, right) => right.index - left.index)[0];
  if (!previous) return false;
  const duration = cuts?.[previous.index]?.transition_out?.duration;
  if (!isPositiveNumber(duration)) return false;
  return areCutsAdjacent(
    { tlEnd: previous.end, transitionOut: { duration } },
    { tlStart: current.start },
    fps,
  );
}

export function validateCutTrackFields(cuts, findings) {
  if (!Array.isArray(cuts)) return;
  for (const [index, cut] of cuts.entries()) {
    if (!isRecord(cut)) continue;
    const path = `edit.json#cuts[${index}]`;
    if (Object.hasOwn(cut, "at") && (!isFiniteNumber(cut.at) || cut.at < 0)) {
      addFinding(findings, {
        severity: "error",
        check: "cuts.at",
        message: "at must be a non-negative finite number when present",
        path: `${path}.at`,
      });
    }
    if (Object.hasOwn(cut, "track") && (!Number.isInteger(cut.track) || cut.track < 0)) {
      addFinding(findings, {
        severity: "error",
        check: "cuts.track",
        message: "cut track must be a non-negative integer when present",
        path: `${path}.track`,
      });
    }
  }
}

export function validateCutTransformFields(cuts, findings) {
  if (!Array.isArray(cuts)) return;
  for (const [index, cut] of cuts.entries()) {
    if (!isRecord(cut)) continue;
    const path = `edit.json#cuts[${index}]`;
    if (
      Object.hasOwn(cut, "opacity") &&
      (!isFiniteNumber(cut.opacity) || cut.opacity < 0 || cut.opacity > 1)
    ) {
      addFinding(findings, {
        severity: "error",
        check: "cuts.opacity",
        message: "opacity must be a finite number between 0 and 1 when present",
        path: `${path}.opacity`,
      });
    }
    if (!Object.hasOwn(cut, "transform")) continue;
    if (!isRecord(cut.transform)) {
      addFinding(findings, {
        severity: "error",
        check: "cuts.transform",
        message: "transform must be an object when present",
        path: `${path}.transform`,
      });
      continue;
    }
    const allowedKeys = new Set(["x", "y", "scale", "rotate"]);
    for (const key of Object.keys(cut.transform)) {
      if (!allowedKeys.has(key)) {
        addFinding(findings, {
          severity: "error",
          check: "cuts.transform",
          message: `transform has an unknown key: ${key}`,
          path: `${path}.transform`,
        });
      }
    }
    for (const field of ["x", "y", "rotate"]) {
      if (Object.hasOwn(cut.transform, field) && !isFiniteNumber(cut.transform[field])) {
        addFinding(findings, {
          severity: "error",
          check: "cuts.transform",
          message: `transform.${field} must be a finite number when present`,
          path: `${path}.transform.${field}`,
        });
      }
    }
    if (Object.hasOwn(cut.transform, "scale") && !isPositiveNumber(cut.transform.scale)) {
      addFinding(findings, {
        severity: "error",
        check: "cuts.transform",
        message: "transform.scale must be a positive number when present",
        path: `${path}.transform.scale`,
      });
    }
  }
}

// 裁定3〜5（in/out 意味論・freeze/speed 警告・v0 空 cuts 拒否）。source が静止画のときだけ発火する。
export function validateStillImageCuts(edit, findings) {
  if (!isRecord(edit)) return;
  const cuts = Array.isArray(edit.cuts) ? edit.cuts : [];

  const imageSourceIds = new Set(
    (Array.isArray(edit.sources) ? edit.sources : [])
      .filter((source) => isRecord(source) && isStillImageSourcePath(source.path))
      .map((source) => source.id),
  );
  if (imageSourceIds.size === 0) return;
  for (const [index, cut] of cuts.entries()) {
    if (!isRecord(cut) || !imageSourceIds.has(cut.src)) continue;
    validateStillImageCutFields(cut, index, findings);
  }
}

function validateStillImageCutFields(cut, index, findings) {
  if (!isRecord(cut)) return;
  const path = `edit.json#cuts[${index}]`;
  if (isFiniteNumber(cut.in) && Math.abs(cut.in) > EPSILON) {
    addFinding(findings, {
      severity: "warning",
      check: "cuts.still-image-in",
      message:
        "cut.in has no source to seek into for a still image -- only out - in (the display duration) is used "
          + "by render; 0 is recommended for cut.in here",
      path: `${path}.in`,
    });
  }
  if (Object.hasOwn(cut, "freeze") && isRecord(cut.freeze)) {
    addFinding(findings, {
      severity: "warning",
      check: "cuts.still-image-freeze",
      message:
        "freeze on a still image source is a no-op visually (the source frame never changes) -- it only adds "
          + "hold time; extending out achieves the same result more directly",
      path: `${path}.freeze`,
    });
  }
  if (
    Object.hasOwn(cut, "speed") &&
    isPositiveNumber(cut.speed) &&
    Math.abs(cut.speed - 1) > EPSILON
  ) {
    addFinding(findings, {
      severity: "warning",
      check: "cuts.still-image-speed",
      message:
        "speed on a still image source has no visual effect (the source frame never changes) -- it only "
          + "rescales the display duration",
      path: `${path}.speed`,
    });
  }
}

export function validateOutputAxisDurationMax(outputs, cutSegments, findings) {
  if (!Array.isArray(outputs) || cutSegments.length === 0) return;
  const maxEnd = cutSegments.reduce((max, segment) => Math.max(max, segment.end), 0);
  for (const [index, output] of outputs.entries()) {
    if (!isRecord(output) || !Object.hasOwn(output, "duration_max")) continue;
    const maximum = output.duration_max;
    if (!isPositiveNumber(maximum)) continue;
    if (maxEnd > maximum + EPSILON) {
      addFinding(findings, {
        severity: "warning",
        check: "outputs.duration-max-gaps",
        message: `output axis duration ${formatNumber(maxEnd)}s (accounting for cuts[].at gaps/tracks) exceeds duration_max ${formatNumber(maximum)}s`,
        path: `edit.json#outputs[${index}].duration_max`,
      });
    }
  }
}

export function validateLayerTracks(layers, findings) {
  if (!Array.isArray(layers)) return;
  const segments = [];
  layers.forEach((layer, index) => {
    if (!isRecord(layer)) return;
    const path = `edit.json#layers[${index}]`;
    if (Object.hasOwn(layer, "track") && (!Number.isInteger(layer.track) || layer.track < 0)) {
      addFinding(findings, {
        severity: "error",
        check: "layers.track",
        message: "layer track must be a non-negative integer when present",
        path: `${path}.track`,
      });
      return;
    }
    if (!isFiniteNumber(layer.t) || !isPositiveNumber(layer.duration)) return;
    const hasValidTrack = Object.hasOwn(layer, "track") && Number.isInteger(layer.track) && layer.track >= 0;
    const track = hasValidTrack ? layer.track : 0;
    segments.push({ index, track, start: layer.t, end: layer.t + layer.duration });
  });
  for (const segment of findTrackOverlaps(segments)) {
    addFinding(findings, {
      severity: "warning",
      check: "layers.track-overlap",
      message: `layer overlaps another layer on track ${segment.track} in the output axis`,
      path: `edit.json#layers[${segment.index}]`,
      range: { start: segment.start, end: segment.end },
    });
  }
}

// sfx には duration が無い（瞬間マーカー）ため、「重なり」は同一 track かつ
// 実質同一 t（EPSILON 以内）に退化させる。
export function validateSfxTracks(sfx, findings) {
  if (!Array.isArray(sfx)) return;
  const pointsByTrack = new Map();
  sfx.forEach((item, index) => {
    if (!isRecord(item)) return;
    const path = `edit.json#audio.sfx[${index}]`;
    if (Object.hasOwn(item, "track") && (!Number.isInteger(item.track) || item.track < 0)) {
      addFinding(findings, {
        severity: "error",
        check: "audio.sfx.track",
        message: "sfx track must be a non-negative integer when present",
        path: `${path}.track`,
      });
      return;
    }
    if (!isFiniteNumber(item.t)) return;
    const hasValidTrack = Object.hasOwn(item, "track") && Number.isInteger(item.track) && item.track >= 0;
    const track = hasValidTrack ? item.track : 0;
    if (!pointsByTrack.has(track)) pointsByTrack.set(track, []);
    pointsByTrack.get(track).push({ index, t: item.t, path: isNonEmptyString(item.path) ? item.path : undefined, track });
  });
  for (const list of pointsByTrack.values()) {
    list.sort((a, b) => a.t - b.t);
    let groupStart = 0;
    for (let i = 1; i < list.length; i += 1) {
      if (Math.abs(list[i].t - list[i - 1].t) <= EPSILON) {
        const current = list[i];
        const samePath = current.path !== undefined
          && list.slice(groupStart, i).some(previous => previous.path !== undefined && previous.path === current.path);
        addFinding(findings, {
          severity: samePath ? "warning" : "info",
          check: "audio.sfx.track-overlap",
          message: samePath
            ? `効果音 audio.sfx[${current.index}] が同じ track ${current.track}・同じ時刻 ${formatNumber(current.t)} 秒に同じ素材 ${current.path} で置かれています（二重置きの可能性）。意図した重ねなら track を分けてください（書き出しのミックスは track を見ずに全部鳴らしますが、NLE 書き出しは track を NLE のトラック単位にするため同じトラックに重なります）。`
            : `効果音 audio.sfx[${current.index}] が同じ track ${current.track}・同じ時刻 ${formatNumber(current.t)} 秒に別素材と重なっています。書き出しのミックスは track を見ずに両方鳴らします。重ねるつもりなら track を分けてください（NLE 書き出しは track を NLE のトラック単位にするため、同じトラックに重なります）。`,
          path: `edit.json#audio.sfx[${current.index}]`,
          range: { start: current.t, end: current.t },
        });
      } else {
        groupStart = i;
      }
    }
  }
}

export function validateTimelineTracks(edit, findings, projectedAudioTracks = null) {
  const timeline = edit?.timeline;
  if (timeline === undefined || timeline === null) return;
  if (!isRecord(timeline)) {
    addFinding(findings, {
      severity: "error",
      check: "timeline.tracks.structure",
      message: "timeline must be an object",
      path: "edit.json#timeline",
    });
    return;
  }
  if (!Array.isArray(timeline.tracks)) {
    addFinding(findings, {
      severity: "error",
      check: "timeline.tracks.structure",
      message: "timeline.tracks must be an array",
      path: "edit.json#timeline.tracks",
    });
    return;
  }

  const audioTracks = projectedAudioTracks ?? collectActualTrackNumbers(edit?.audio?.sfx);
  if (projectedAudioTracks === null
    && (isRecord(edit?.audio?.bgm) || (Array.isArray(edit?.audio?.narration) && edit.audio.narration.length > 0))) {
    audioTracks.add(0);
  }
  const actualTracks = new Map([
    ["cuts", collectActualTrackNumbers(edit?.cuts)],
    ["layers", collectActualTrackNumbers(edit?.layers)],
    ["overlays", collectActualTrackNumbers(edit?.overlays)],
    ["audio", audioTracks],
  ]);
  const allowedKinds = new Set(["cuts", "layers", "overlays", "captions", "audio"]);
  const ids = new Set();
  const declarations = new Set();
  const singletonCounts = new Map();

  for (const [index, item] of timeline.tracks.entries()) {
    const path = `edit.json#timeline.tracks[${index}]`;
    if (!isRecord(item)) {
      addFinding(findings, {
        severity: "error",
        check: "timeline.tracks.structure",
        message: "timeline track must be an object",
        path,
      });
      continue;
    }

    if (!isNonEmptyString(item.id)) {
      addFinding(findings, {
        severity: "error",
        check: "timeline.tracks.id",
        message: "timeline track id must be a non-empty string",
        path: `${path}.id`,
      });
    } else if (ids.has(item.id)) {
      addFinding(findings, {
        severity: "error",
        check: "timeline.tracks.id",
        message: `duplicate timeline track id: ${item.id}`,
        path: `${path}.id`,
      });
    } else {
      ids.add(item.id);
    }

    if (!allowedKinds.has(item.kind)) {
      addFinding(findings, {
        severity: "error",
        check: "timeline.tracks.kind",
        message: "timeline track kind must be cuts/layers/overlays/captions/audio",
        path: `${path}.kind`,
      });
      continue;
    }

    const hasRef = Object.hasOwn(item, "ref");
    const validRef = !hasRef || (Number.isInteger(item.ref) && item.ref >= 0);
    if (!validRef) {
      addFinding(findings, {
        severity: "error",
        check: "timeline.tracks.ref",
        message: "timeline track ref must be a non-negative integer when present",
        path: `${path}.ref`,
      });
    }
    if (Object.hasOwn(item, "label") && typeof item.label !== "string") {
      addFinding(findings, {
        severity: "error",
        check: "timeline.tracks.label",
        message: "timeline track label must be a string when present",
        path: `${path}.label`,
      });
    }
    for (const field of ["muted", "hidden", "locked"]) {
      if (Object.hasOwn(item, field) && typeof item[field] !== "boolean") {
        addFinding(findings, {
          severity: "error",
          check: `timeline.tracks.${field}`,
          message: `timeline track ${field} must be a boolean when present`,
          path: `${path}.${field}`,
        });
      }
    }

    // audio は R6 契約 §1 裁定 2（2026-07-25）で複数トラック化された。宣言ごとの ref が
    // 異なる限り複数宣言は正常な運用のため、singleton warning の対象からは除外する
    // （captions は引き続き単一トラック運用のため維持）。
    if (item.kind === "captions") {
      const count = (singletonCounts.get(item.kind) ?? 0) + 1;
      singletonCounts.set(item.kind, count);
      if (count > 1) {
        addFinding(findings, {
          severity: "warning",
          check: "timeline.tracks.singleton",
          message: `${item.kind} timeline track is declared more than once`,
          path,
        });
      }
    }

    if (!validRef || item.kind === "captions") continue;
    // audio の ref は R6 契約 §1 裁定 2（2026-07-25）で複数トラック化されたため、
    // 0 固定を要求しない（非 0 ref も正当な宣言として declarations に加える）。
    const ref = item.kind === "audio" && !hasRef ? 0 : item.ref;
    if (ref === undefined) continue;
    declarations.add(`${item.kind}:${ref}`);
  }
  // ここには以前 `timeline.tracks.ref-missing`（宣言された段の ref が実データのどこにも
  // 現れなければ警告）があったが、2026-08-20 に撤去した。v2 では timeline.tracks[] の各段が
  // internal-model.ts の projectLegacyEdit を通じてそのまま legacy 射影され、ref は宣言順に
  // 毎回生成し直される連番なので、「宣言はあるが実データに現れない ref」は「段の中身が 0 個」
  // としか等価にならない。空の段は自動 prune せず残すのが正本（10番裁定 E）なので、この
  // チェックは空の段を持つ v2 プロジェクトのたびに必ず誤検知していた。v0/v1 は本体から既に
  // 除かれており（9番）、「(kind, ref) の参照」という v0/v1 由来の概念自体が v2 には無いため
  // 部分修正ではなく撤去する。撤去の証跡は edit-lint.test.mjs の
  // "空の段を持つ v2 プロジェクトは findings 0" で固定してある。

  for (const [kind, tracks] of actualTracks) {
    for (const ref of tracks) {
      if (declarations.has(`${kind}:${ref}`)) continue;
      addFinding(findings, {
        severity: "warning",
        check: "timeline.tracks.declaration-missing",
        message: `${kind} edit data uses track ${ref}, but timeline.tracks has no matching declaration`,
        path: `edit.json#${kind === "audio" ? "audio.sfx" : kind}`,
      });
    }
  }
}

// task 2026-08-07-track-transition-lint-guard (following up on task 2026-08-07-render-frame-accounting's
// track-compose.mjs sweep, task #14): gap-aware track compositing (a non-default timeline.tracks
// declaration, which routes v1 through buildTrackStackPlan/resolveCutTrackRanges instead of the
// plain sequential render path) does not compose with cuts[].transition_out. resolveCutTrackRanges's
// gap-aware placement is built on resolveCutSegments/computeVideoRuns, which assume same-track
// adjacent cuts occupy separate, non-overlapping windows -- an xfade's whole point is to blend two
// cuts into one overlapping region, so that assumption mechanically splits one continuous
// dissolve into two separately-windowed composites. Verified with a real render (2026-08-07,
// v1, a "cuts" track holding lime -> [0.5s dissolve] -> magenta, composited via an explicit
// non-default timeline.tracks order): the second cut's window pointed 0.5s past where the
// actually-xfade-shrunk clip's real content lives, so playback showed the base track's plain
// background leaking through for the tail 0.5s where the dissolved clip should still have been
// visible. Properly supporting this would mean teaching resolveCutSegments/computeVideoRuns
// about overlap, and those are shared by v0's own at/track placement and layers placement --
// too wide a blast radius to take on speculatively, especially with no evidence anyone needs the
// combination. Reject it instead: it fails loudly and specifically, rather than rendering a
// broken video with a phantom black flash that's very hard to trace back to its cause.
export function validateTrackTransitionOutCompatibility(edit, findings) {
  for (const { cutIndex, trackRef } of findUnsupportedDeclaredTrackTransitions(
    edit?.cuts,
    edit?.timeline?.tracks,
  )) {
    addFinding(findings, {
      severity: "error",
      check: "cuts.track-transition-unsupported",
      message:
        `映像トラック ${trackRef} の transition_out は、PiP または複数トラックを合成する方式では書き出せません。`
        + `トランジションを削除するか、映像を単一の cuts トラックへ戻してください。`,
      path: `edit.json#cuts[${cutIndex}]`,
    });
  }
}

function collectActualTrackNumbers(items) {
  const tracks = new Set();
  if (!Array.isArray(items)) return tracks;
  for (const item of items) {
    if (!isRecord(item)) continue;
    if (!Object.hasOwn(item, "track")) {
      tracks.add(0);
    } else if (Number.isInteger(item.track) && item.track >= 0) {
      tracks.add(item.track);
    }
  }
  return tracks;
}

export function validateCuts(cuts, findings, paths, sourceIds) {
  if (!Array.isArray(cuts)) return null;
  let valid = true;
  let timeline = 0;

  for (const [index, cut] of cuts.entries()) {
    const path = `edit.json#cuts[${index}]`;
    if (!isRecord(cut) || !isFiniteNumber(cut.in) || !isFiniteNumber(cut.out)) {
      addFinding(findings, {
        severity: "error",
        check: "cuts.range",
        message: "cut in/out must be finite numbers",
        path,
      });
      valid = false;
      continue;
    }
    if (cut.in < 0 || cut.out <= cut.in) {
      addFinding(findings, {
        severity: "error",
        check: "cuts.range",
        message: "cut must satisfy 0 <= in < out",
        path,
        range: { start: cut.in, end: cut.out },
      });
      valid = false;
    } else {
      timeline += segmentDuration(cut);
    }
    if (!isNonEmptyString(cut.src)) {
        addFinding(findings, {
          severity: "error",
          check: "cuts.src",
          message: "version 1 cut src must be a non-empty string",
          path,
        });
        valid = false;
    } else if (!sourceIds.has(cut.src)) {
        addFinding(findings, {
          severity: "error",
          check: "cuts.src-reference",
          message: `cut src does not reference sources[].id: ${cut.src}`,
          path,
        });
        valid = false;
    }
    if (Object.hasOwn(cut, "speed") && !isPositiveNumber(cut.speed)) {
      addFinding(findings, {
        severity: "error",
        check: "cuts.speed",
        message: "speed must be a positive number",
        path,
      });
      valid = false;
    }
    validateTransitionOut(cut.transition_out, findings, `${path}.transition_out`);
  }

  if (cuts.length === 0) return 0;
  return valid ? timeline : null;
}

export function validateDurationMaximum(outputs, timeline, findings) {
  if (outputs === undefined) return;
  if (!Array.isArray(outputs)) {
    addFinding(findings, {
      severity: "error",
      check: "outputs.duration-max",
      message: "outputs must be an array when present",
      path: "edit.json#outputs",
    });
    return;
  }
  for (const [index, output] of outputs.entries()) {
    if (!isRecord(output) || !Object.hasOwn(output, "duration_max")) continue;
    const maximum = output.duration_max;
    if (!isPositiveNumber(maximum)) {
      addFinding(findings, {
        severity: "error",
        check: "outputs.duration-max",
        message: "duration_max must be a positive number",
        path: `edit.json#outputs[${index}].duration_max`,
      });
    } else if (timeline !== null && timeline > maximum + EPSILON) {
      addFinding(findings, {
        severity: "error",
        check: "outputs.duration-max",
        message: `timeline duration ${formatNumber(timeline)}s exceeds duration_max ${formatNumber(maximum)}s`,
        path: `edit.json#outputs[${index}].duration_max`,
        range: { start: 0, end: timeline },
      });
    }
  }
}
