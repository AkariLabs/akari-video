import { readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { isSourceCompatibleWithLane } from "../shape-lane.mjs";
import { EPSILON, addFinding, effectiveSourceOut, formatNumber, isFiniteNumber, isNonEmptyString, isPositiveNumber, isRecord, relativePath, structureFinding } from "./shared.mjs";
import { isStillImageSourcePath, resolveItemAnchors, toAnchorCaptions } from "./external.mjs";
import { validateAudioClipFxDeclaration, validateAudioDuckKeys, validateAudioEnvelopeDeclaration } from "./audio.mjs";
import { validateAdjust, validateChromaKey, validateLook } from "./look-adjust.mjs";

const MOTION_IN_OUT_PRESETS = new Set(["fade", "slide-up", "slide-down", "slide-left", "slide-right", "scale", "wipe", "pop", "zoom", "twirl"]);

const MOTION_LOOP_PRESETS = new Set(["pulse", "float", "spin", "blink", "jiggle"]);

export function validateEditStructure(edit, findings, paths) {
  const editRelative = relativePath(paths.projectRoot, paths.editPath);
  if (!isRecord(edit)) {
    addFinding(findings, { severity: "error", check: "edit.structure", message: "edit.json root must be an object", path: editRelative });
    return { sourcePath: null, sourceIds: new Set() };
  }
  if (!isRecord(edit.output)) {
    structureFinding(findings, editRelative, "output must be an object");
  } else {
    for (const field of ["width", "height", "fps"]) {
      if (!isPositiveNumber(edit.output[field])) structureFinding(findings, editRelative, `output.${field} must be a positive number`);
    }
    validateLook(edit.output.look, findings, "edit.json#output.look");
  }
  const sourceIds = new Set();
  if (!Array.isArray(edit.sources) && !(edit.version === 2 && edit.sources === undefined)) {
    structureFinding(findings, editRelative, "sources must be an array");
  } else {
    for (const [index, source] of edit.sources.entries()) {
      const sourceRelative = `edit.json#sources[${index}]`;
      if (!isRecord(source)) {
        structureFinding(findings, sourceRelative, "source must be an object");
        continue;
      }
      if (!isNonEmptyString(source.id)) {
        structureFinding(findings, sourceRelative, "source id must be a non-empty string");
      } else if (sourceIds.has(source.id)) {
        addFinding(findings, { severity: "error", check: "sources.id", message: `duplicate source id: ${source.id}`, path: sourceRelative });
      } else {
        sourceIds.add(source.id);
      }
      if (!isNonEmptyString(source.path)) structureFinding(findings, sourceRelative, "source path must be a non-empty string");
      if (source.proxy !== null && source.proxy !== undefined && !isNonEmptyString(source.proxy)) {
        structureFinding(findings, sourceRelative, "source proxy must be null or a non-empty string");
      }
      validateChromaKey(source.chroma_key, findings, `${sourceRelative}.chroma_key`);
    }
  }
  if (!Array.isArray(edit.cuts)) structureFinding(findings, editRelative, "cuts must be an array");
  if (!Array.isArray(edit.overlays)) structureFinding(findings, editRelative, "overlays must be an array");
  return { sourcePath: null, sourceIds };
}

// notes-2026-08-18-timeline-latency-and-track-model.md §9 / §10-1。
// v2 Phase 0 は既存 v0/v1 の検証パイプラインへ混ぜず、トラック正本の最小不変条件だけを検査する。
function validateAnimatorRefs(item, points, findings, keyframesPath) {
  if (!Array.isArray(points)) return;
  const ids = new Set((Array.isArray(item.animator) ? item.animator : [])
    .filter(isRecord).map(animator => animator.id));
  for (const [index, point] of points.entries()) {
    if (!isRecord(point) || !isRecord(point.animator)) continue;
    for (const id of Object.keys(point.animator)) {
      if (ids.has(id)) continue;
      addFinding(findings, {
        severity: "error", check: "animator.unknown-ref",
        message: `keyframe references undeclared animator id: ${id}`,
        path: `${keyframesPath}[${index}].animator[${JSON.stringify(id)}]`,
      });
    }
  }
}

function validateAnimators(item, findings, itemPath) {
  if (Object.hasOwn(item, "animator") && ["media", "filter"].includes(item.source?.kind)) {
    addFinding(findings, {
      severity: "warning", check: "animator.non-text-target",
      message: "animator is ignored on non-text items",
      path: `${itemPath}.animator`,
    });
  }
  const ids = new Set();
  for (const [index, animator] of (Array.isArray(item.animator) ? item.animator : []).entries()) {
    if (!isRecord(animator)) continue;
    if (isNonEmptyString(animator.id)) {
      if (ids.has(animator.id)) addFinding(findings, {
        severity: "error", check: "animator.duplicate-id",
        message: `duplicate animator id: ${animator.id}; last declaration wins when rendering`,
        path: `${itemPath}.animator[${index}].id`,
      });
      ids.add(animator.id);
    }
    if (animator.basis === "segments") addFinding(findings, {
      severity: "warning", check: "animator.segments-fallback",
      message: "animator basis segments uses words in v1",
      path: `${itemPath}.animator[${index}].basis`,
    });
  }
  validateAnimatorRefs(item, item.keyframes, findings, `${itemPath}.keyframes`);
}

export function validateEditV2(edit, findings) {
  validateAudioDuckKeys(edit?.audio?.duck_keys, findings);
  if (!Array.isArray(edit.tracks)) {
    addFinding(findings, {
      severity: "error",
      check: "v2.track-content-exclusive",
      message: "version 2 tracks must be an array",
      path: "edit.json#tracks",
    });
    return;
  }

  const sourceIds = new Map();
  const sourcePaths = new Map();
  const trackIds = new Map();
  const itemIds = new Map();
  const itemTargets = new Map();
  const linkedAudioItems = [];
  const registerId = (ids, id, path, label) => {
    if (!isNonEmptyString(id)) {
      addFinding(findings, {
        severity: "error",
        check: "v2.id-unique",
        message: `${label} id must be a non-empty string`,
        path,
      });
      return;
    }
    const first = ids.get(id);
    if (first) {
      addFinding(findings, {
        severity: "error",
        check: "v2.id-unique",
        message: `${label} id is duplicated: ${id} (first declared at ${first})`,
        path,
      });
      return;
    }
    ids.set(id, path);
  };

  if (Array.isArray(edit.sources)) {
    for (const [index, source] of edit.sources.entries()) {
      if (isRecord(source)) {
        registerId(sourceIds, source.id, `edit.json#sources[${index}].id`, "source");
        if (isNonEmptyString(source.id)) sourcePaths.set(source.id, source.path);
      }
    }
  }

  const fps = edit.output?.fps;

  for (const [trackIndex, track] of edit.tracks.entries()) {
    if (!isRecord(track) || !Array.isArray(track.items)) continue;
    const visit = (items, parent, parentPath) => {
      for (const [index, item] of items.entries()) {
        const itemPath = `${parentPath}[${index}]`;
        if (!isRecord(item)) continue;
        registerId(itemIds, item.id, `${itemPath}.id`, "item");
        validateAnimators(item, findings, itemPath);
        if (isNonEmptyString(item.id) && !itemTargets.has(item.id)) {
          itemTargets.set(item.id, { item, lane: track.lane });
        }
        if (track.lane === "audio" && Object.hasOwn(item, "link")) {
          linkedAudioItems.push({ item, path: `${itemPath}.link` });
        }
        if (isPositiveNumber(fps) && Number.isInteger(item.duration) && item.duration > 0) {
          const duration = item.duration;
          const seconds = (duration / fps).toFixed(2);
          if (track.lane !== "audio" && item.source?.kind !== "caption"
            && duration < Math.round(0.5 * fps)) {
            addFinding(findings, {
              severity: "warning", check: "v2.item-duration-short",
              message: `item ${String(item.id)} の duration は ${duration} フレーム（${seconds} 秒）です。at / duration の単位はフレームです。${duration} 秒のつもりなら ${formatNumber(duration * fps)} フレームにしてください（×fps = ${formatNumber(fps)}）。`,
              path: `${itemPath}.duration`,
            });
          }
          const source = item.source;
          if (source?.kind === "media" && isFiniteNumber(source.out)
            && !isStillImageSourcePath(sourcePaths.get(source.src)) && !isRecord(source.freeze)) {
            const sourceIn = source.in ?? 0;
            const sourceSeconds = (effectiveSourceOut(item, fps) - sourceIn)
              / (isPositiveNumber(source.speed) ? source.speed : 1);
            const timelineSeconds = duration / fps;
            const ratio = Math.max(sourceSeconds / timelineSeconds, timelineSeconds / sourceSeconds);
            if (sourceSeconds > 0 && ratio >= 5) {
              addFinding(findings, {
                severity: "warning", check: "v2.item-duration-source-mismatch",
                message: `item ${String(item.id)} の duration ${duration} フレーム（${seconds} 秒）と source の区間 in ${formatNumber(sourceIn)} 秒 〜 out ${formatNumber(source.out)} 秒（${sourceSeconds.toFixed(2)} 秒${isPositiveNumber(source.speed) && source.speed !== 1 ? `・speed ${formatNumber(source.speed)}` : ""}）が ${ratio.toFixed(1)} 倍食い違っています。at / duration はフレーム、source.in / out は秒です。取り違えていないか確かめてください（duration を秒で書いたなら ×fps = ${formatNumber(fps)}）。`,
                path: `${itemPath}.duration`,
              });
            }
          }
        }
        if (track.lane === "visual" && item.source?.kind === "media" && item.audio === false
          && (Object.hasOwn(item.source, "gain_db") || Object.hasOwn(item.source, "mute"))) {
          addFinding(findings, {
            severity: "warning",
            check: "v2.audio-embedded-unused",
            message: "source.gain_db / source.mute have no effect when the visual media item declares audio: false",
            path: `${itemPath}.source`,
          });
        }
        if (parent && Number.isInteger(item.at) && Number.isInteger(item.duration)
          && (item.at < 0 || item.at + item.duration > parent.duration)) {
          addFinding(findings, {
            severity: "warning",
            check: "v2.child-in-parent",
            message: `child interval [${item.at}, ${item.at + item.duration}) exceeds parent ${String(parent.id)} interval [0, ${parent.duration})`,
            path: itemPath,
            range: { start: item.at, end: item.at + item.duration },
          });
        }
        if (isRecord(item.motion)) {
          for (const seat of ["in", "out", "loop"]) {
            const entry = item.motion[seat];
            const presets = seat === "loop" ? MOTION_LOOP_PRESETS : MOTION_IN_OUT_PRESETS;
            if (isRecord(entry) && typeof entry.preset === "string" && !presets.has(entry.preset)) {
              addFinding(findings, {
                severity: "warning",
                check: "motion.unknown-preset",
                message: `unknown motion ${seat} preset: ${entry.preset}; ignored when rendering`,
                path: `${itemPath}.motion.${seat}`,
              });
            }
          }
          const inDuration = isRecord(item.motion.in) && Number.isInteger(item.motion.in.duration)
            ? item.motion.in.duration : 0;
          const outDuration = isRecord(item.motion.out) && Number.isInteger(item.motion.out.duration)
            ? item.motion.out.duration : 0;
          if (Number.isInteger(item.duration) && inDuration + outDuration > item.duration) {
            addFinding(findings, {
              severity: "error",
              check: "motion.in-out-exceeds",
              message: `motion in/out total ${inDuration + outDuration} exceeds item duration ${item.duration}`,
              path: `${itemPath}.motion`,
            });
          }
        }
        if (Object.hasOwn(item, "adjust")) {
          validateAdjust(item.adjust, findings, `${itemPath}.adjust`);
        }
        if (Array.isArray(item.items)) visit(item.items, item, `${itemPath}.items`);
      }
    };
    visit(track.items, null, `edit.json#tracks[${trackIndex}].items`);
  }

  const linkedTargets = new Map();
  for (const { item, path } of linkedAudioItems) {
    const target = itemTargets.get(item.link);
    if (!isNonEmptyString(item.link) || !target) {
      addFinding(findings, {
        severity: "error", check: "v2.audio-link-target",
        message: `link does not reference an item in this edit: ${String(item.link)}`, path,
      });
    } else if (target.lane !== "visual" || target.item.source?.kind !== "media") {
      addFinding(findings, {
        severity: "error", check: "v2.audio-link-target-kind",
        message: `link target must be a visual media item: ${item.link}`, path,
      });
    } else if (target.item.audio !== false) {
      addFinding(findings, {
        severity: "error", check: "v2.audio-link-target",
        message: `linked visual media item must declare audio: false: ${item.link}`, path,
      });
    }
    if (isNonEmptyString(item.link)) {
      if (linkedTargets.has(item.link)) {
        addFinding(findings, {
          severity: "error", check: "v2.audio-link-duplicate",
          message: `multiple audio items link to ${item.link} (first declared at ${linkedTargets.get(item.link)})`, path,
        });
      } else {
        linkedTargets.set(item.link, path);
      }
    }
  }

  const bgmItems = edit.tracks.flatMap((track, trackIndex) =>
    isRecord(track) && track.lane === "audio" && Array.isArray(track.items)
      ? track.items.flatMap((item, itemIndex) =>
        isRecord(item) && item.role === "bgm" ? [{
          id: item.id, trackIndex, itemIndex, start: item.at, end: item.at + item.duration,
          fadeIn: item.fade_in, fadeOut: item.fade_out,
        }] : [])
      : []
  );
  if (bgmItems.length > 1) {
    const describe = (item) => `${String(item.id)} [${item.start}, ${item.end})`;
    const overlaps = [];
    for (let i = 0; i < bgmItems.length; i += 1) {
      for (let j = i + 1; j < bgmItems.length; j += 1) {
        const start = Math.max(bgmItems[i].start, bgmItems[j].start);
        const end = Math.min(bgmItems[i].end, bgmItems[j].end);
        if (Number.isFinite(start) && Number.isFinite(end) && start < end) {
          const [before, after] = bgmItems[i].start <= bgmItems[j].start
            ? [bgmItems[i], bgmItems[j]] : [bgmItems[j], bgmItems[i]];
          if (!(before.fadeOut > 0) && !(after.fadeIn > 0)) {
            overlaps.push({ label: `${String(before.id)} / ${String(after.id)} [${start}, ${end})`, frames: end - start });
          }
        }
      }
    }
    const exampleSeconds = overlaps.length && isPositiveNumber(fps)
      ? formatNumber(Number((overlaps[0].frames / fps).toFixed(2))) : null;
    if (overlaps.length) addFinding(findings, {
      severity: "warning", check: "v2.audio-bgm-multiple",
      message: `BGM ${bgmItems.map(describe).join('、')}。重なり: ${overlaps.map(overlap => overlap.label).join('、')}。重なった区間は両方の BGM が鳴ります。クロスフェードにするなら、前の item に fade_out（秒）、後の item に fade_in（秒）を付けてください${exampleSeconds !== null ? `（例: 重なり ${formatNumber(overlaps[0].frames)} フレーム = ${exampleSeconds} 秒なら "fade_out": ${exampleSeconds} / "fade_in": ${exampleSeconds}）` : ""}。意図しない重なりなら時間が重ならないように配置してください。（同じトラックの中では重ねられません。別の audio トラックに置いてください）`,
      path: "edit.json#tracks",
    });
  }

  for (const [trackIndex, track] of edit.tracks.entries()) {
    const trackPath = `edit.json#tracks[${trackIndex}]`;
    if (!isRecord(track)) {
      addFinding(findings, {
        severity: "error",
        check: "v2.track-content-exclusive",
        message: "track must be an object",
        path: trackPath,
      });
      continue;
    }
    registerId(trackIds, track.id, `${trackPath}.id`, "track");

    const hasItems = Object.hasOwn(track, "items");
    const hasContent = Object.hasOwn(track, "content");
    if (hasItems === hasContent) {
      addFinding(findings, {
        severity: "error",
        check: "v2.track-content-exclusive",
        message: "track must contain exactly one of items or content",
        path: trackPath,
      });
    }

    if (hasContent && track.lane !== "visual") {
      addFinding(findings, {
        severity: "error",
        check: "v2.lane-source",
        message: "captions content is only compatible with the visual lane",
        path: `${trackPath}.lane`,
      });
    }

    if (hasContent) {
      addFinding(findings, {
        severity: "warning",
        check: "v2.captions-content-deprecated",
        message: "tracks[].content は deprecated です。visual トラックの items[] に字幕の袋グループ item を置いてください（akari migrate で正規化できます）。",
        path: `${trackPath}.content`,
      });
    }

    if (!Array.isArray(track.items)) continue;
    if (track.items.length === 0) {
      addFinding(findings, {
        severity: "info",
        check: "v2.empty-track",
        message: "empty track will be removed by canonical save",
        path: trackPath,
      });
    }
    const intervals = [];
    let previousTimedItem = null;
    for (const [itemIndex, item] of track.items.entries()) {
      const itemPath = `${trackPath}.items[${itemIndex}]`;
      if (!isRecord(item)) continue;
      if (isFiniteNumber(item.at)) {
        if (previousTimedItem && item.at < previousTimedItem.at) {
          addFinding(findings, {
            severity: "warning",
            check: "timeline.items.order",
            message: `item ${String(item.id)} at array position ${itemIndex} has at=${formatNumber(item.at)}, before item ${String(previousTimedItem.id)} at position ${previousTimedItem.index} (at=${formatNumber(previousTimedItem.at)})`,
            path: itemPath,
          });
        }
        previousTimedItem = { id: item.id, index: itemIndex, at: item.at };
      }

      const kind = isRecord(item.source) ? item.source.kind : undefined;
      const compatible = isSourceCompatibleWithLane(track.lane, kind);
      if (!compatible) {
        addFinding(findings, {
          severity: "error",
          check: "v2.lane-source",
          message: `source kind ${String(kind)} is not compatible with lane ${String(track.lane)}`,
          path: `${itemPath}.source.kind`,
        });
      }

      if (Object.hasOwn(item, "mask")) {
        const maskPath = `${itemPath}.mask`;
        if (!isNonEmptyString(item.mask) || !sourceIds.has(item.mask)) {
          addFinding(findings, {
            severity: "error",
            check: "v2.mask-reference",
            message: `mask does not reference sources[].id: ${String(item.mask)}`,
            path: maskPath,
          });
        } else if (!isVideoSourcePath(sourcePaths.get(item.mask))
          && !(kind === "media" && isStillImageSourcePath(sourcePaths.get(item.source.src))
            && /\.png$/iu.test(String(sourcePaths.get(item.mask))))) {
          addFinding(findings, {
            severity: "error",
            check: "v2.mask-video",
            message: `${kind === "media" && isStillImageSourcePath(sourcePaths.get(item.source.src))
              ? "静止画のマスクは PNG または動画を指定してください"
              : "動画のマスクは動画ソースを指定してください"}: ${String(sourcePaths.get(item.mask))}`,
            path: maskPath,
          });
        }
      }

      if (kind === "html" && Object.hasOwn(item.source, "params")) {
        const params = item.source.params;
        const invalidEntry = isRecord(params)
          ? Object.entries(params).find(([, value]) => typeof value !== "string")
          : ["params", params];
        if (invalidEntry) {
          addFinding(findings, {
            severity: "error",
            check: "v2.html-params",
            message: "HTML source params must be an object whose values are strings",
            path: `${itemPath}.source.params${invalidEntry[0] === "params" ? "" : `.${invalidEntry[0]}`}`,
          });
        }
      }

      if (track.lane === "audio") {
        const role = item.role ?? "sfx";
        if (Object.hasOwn(item, "gain_db")
          && (!isFiniteNumber(item.gain_db) || item.gain_db < -60 || item.gain_db > 12)) {
          addFinding(findings, {
            severity: "error",
            check: `audio.${role}.gain-db`,
            message: "gain_db must be a finite number within [-60, 12]",
            path: `${itemPath}.gain_db`,
          });
        }
        validateAudioEnvelopeDeclaration(item, role, item.duration, findings, itemPath, {
          v2: true,
          timeScale: edit.output?.fps,
        });
        if (isRecord(item.source)) {
          validateAudioClipFxDeclaration(item.source, role, findings, itemPath, {
            sourcePath: `${itemPath}.source`,
          });
        }
        validateAudioClipFxDeclaration(item, role, findings, itemPath);
        for (const [field, bgmField] of [["fade_in", "fadeIn"], ["fade_out", "fadeOut"]]) {
          if (!Object.hasOwn(item, field) || (isFiniteNumber(item[field]) && item[field] >= 0)) continue;
          addFinding(findings, {
            severity: "error",
            check: role === "bgm" ? `audio.bgm.${bgmField}` : `audio.sfx.${field}`,
            message: `${field} must be a non-negative finite number`,
            path: `${itemPath}.${field}`,
          });
        }
        if (isRecord(item.source)) {
          if (role === "narration") {
            for (const field of ["in", "out"]) {
              if (!Object.hasOwn(item.source, field)
                || (isFiniteNumber(item.source[field]) && item.source[field] >= 0)) continue;
              addFinding(findings, {
                severity: "error",
                check: "audio.narration.trim",
                message: `${field} must be a non-negative finite number`,
                path: `${itemPath}.source.${field}`,
              });
            }
          }
          if (isFiniteNumber(item.source.in)
            && item.source.in >= 0
            && isFiniteNumber(item.source.out)
            && item.source.out >= 0
            && item.source.out <= item.source.in) {
            addFinding(findings, {
              severity: "error",
              check: role === "narration" ? "audio.narration.trim" : "audio.sfx.in-out",
              message: `${role === "narration" ? "narration" : "sfx"} must satisfy in < out when both are present`,
              path: `${itemPath}.source`,
              range: { start: item.source.in, end: item.source.out },
            });
          }
        }
      }

      // Visual items with duration: 0 represent nothing renderable and remain invalid. Audio
      // items deliberately use 0 as the unresolved-material-duration sentinel when a legacy
      // declaration omits an explicit out point; render-cut resolves that duration from media.
      if (track.lane !== "audio" && Number.isInteger(item.duration) && item.duration === 0) {
        addFinding(findings, {
          severity: "error",
          check: "v2.item-duration",
          message: "item duration must be a positive integer (0 represents nothing on the timeline)",
          path: `${itemPath}.duration`,
        });
      }

      if (Number.isInteger(item.at) && item.at >= 0 && Number.isInteger(item.duration) && item.duration >= 0) {
        const transitionSeconds = isRecord(item.source?.transition_out)
          && isPositiveNumber(item.source.transition_out.duration)
          ? item.source.transition_out.duration : 0;
        intervals.push({
          index: itemIndex,
          start: item.at,
          end: item.at + item.duration,
          transitionFrames: Math.round(transitionSeconds * (edit.output?.fps ?? 0)),
        });
      }
    }

    intervals.sort((left, right) => left.start - right.start || left.index - right.index);
    let furthest = null;
    for (const interval of intervals) {
      const overlap = furthest ? furthest.end - interval.start : 0;
      if (furthest && overlap > 0 && interval.end > interval.start
        && overlap > furthest.transitionFrames) {
        addFinding(findings, {
          severity: "error",
          check: "v2.track-no-overlap",
          message: `item overlaps ${furthest.index} on the same track`,
          path: `${trackPath}.items[${interval.index}]`,
          range: { start: interval.start, end: interval.end },
        });
      }
      if (!furthest || interval.end > furthest.end) furthest = interval;
    }
  }
}

export function validateV2ItemAnchors(edit, captionsState, findings) {
  const captions = toAnchorCaptions(captionsState.value);
  const captionById = new Map(captions.map(caption => [caption.id, caption]));
  const entries = [];
  const visit = (items, parentPath) => {
    if (!Array.isArray(items)) return;
    for (const [index, item] of items.entries()) {
      if (!isRecord(item)) continue;
      const path = `${parentPath}[${index}]`;
      if (Object.hasOwn(item, "anchor")) entries.push({ item, path });
      visit(item.items, `${path}.items`);
    }
  };
  for (const [trackIndex, track] of (Array.isArray(edit.tracks) ? edit.tracks : []).entries()) {
    if (isRecord(track)) visit(track.items, `edit.json#tracks[${trackIndex}].items`);
  }

  for (const { item, path } of entries) {
    const kind = isRecord(item.source) ? item.source.kind : undefined;
    if (kind === "captions" || kind === "caption") {
      addFinding(findings, {
        severity: "error",
        check: "v2.item-anchor-kind",
        message: `source kind ${String(kind)} cannot declare anchor`,
        path: `${path}.anchor`,
      });
      continue;
    }
    const anchor = isRecord(item.anchor) ? item.anchor : {};
    const caption = captionById.get(anchor.caption);
    if (!caption) {
      addFinding(findings, {
        severity: captionsState.exists ? "error" : "warning",
        check: "v2.item-anchor-ref",
        message: captionsState.exists
          ? `anchor.caption does not reference captions.json: ${String(anchor.caption)}`
          : `captions.json is absent; anchor.caption cannot be resolved: ${String(anchor.caption)}`,
        path: `${path}.anchor.caption`,
      });
      continue;
    }
    if (Object.hasOwn(anchor, "range")) {
      const range = isRecord(anchor.range) ? anchor.range : {};
      if (!isFiniteNumber(range.start) || !isFiniteNumber(range.end)
        || range.start < caption.start - EPSILON
        || range.end > caption.end + EPSILON
        || range.end <= range.start) {
        addFinding(findings, {
          severity: "error",
          check: "v2.item-anchor-range",
          message: `anchor range [${String(range.start)}, ${String(range.end)}] must satisfy ${caption.start} <= start < end <= ${caption.end}`,
          path: `${path}.anchor.range`,
        });
      }
    }
  }

  for (const [trackIndex, track] of (Array.isArray(edit.tracks) ? edit.tracks : []).entries()) {
    const inspect = (items, parentPath) => {
      for (const [index, item] of (Array.isArray(items) ? items : []).entries()) {
        if (!isRecord(item)) continue;
        const path = `${parentPath}[${index}]`;
        if (isRecord(item.anchor) && isRecord(item.anchor.attached_by)
          && item.anchor.attached_by.caption !== item.anchor.caption) {
          addFinding(findings, { severity: 'error', check: 'v2.item-attached-by-anchor',
            message: 'anchor.attached_by.caption must match anchor.caption', path: `${path}.anchor.attached_by.caption` });
        }
        inspect(item.items, `${path}.items`);
      }
    };
    if (isRecord(track)) inspect(track.items, `edit.json#tracks[${trackIndex}].items`);
  }

  if (entries.length === 0) return;
  const resolved = resolveItemAnchors(edit, captions);
  const pathById = new Map(entries.map(entry => [entry.item.id, entry.path]));
  for (const change of resolved.changes) {
    addFinding(findings, {
      severity: "warning",
      check: "v2.item-anchor-stale",
      message: `anchor resolves to at=${change.after.at}, duration=${change.after.duration}; cached at=${change.before.at}, duration=${change.before.duration}`,
      path: `${pathById.get(change.id) ?? "edit.json#tracks"}.anchor`,
    });
  }
  for (const warning of resolved.warnings) {
    if (warning.reason !== "removed-range" && warning.reason !== "no-source-segments") continue;
    addFinding(findings, {
      severity: "warning",
      check: "v2.item-anchor-unresolvable",
      message: `anchor interval is not visible on the output timeline (${warning.reason})`,
      path: `${pathById.get(warning.id) ?? "edit.json#tracks"}.anchor`,
    });
  }
}

export async function validateV2ObjectTreeFiles(edit, findings, paths) {
  const entries = [];
  const visit = (items, itemPath) => {
    if (!Array.isArray(items)) return;
    for (const [index, item] of items.entries()) {
      if (!isRecord(item)) continue;
      const path = `${itemPath}[${index}]`;
      entries.push({ item, path });
      visit(item.items, `${path}.items`);
    }
  };
  for (const [trackIndex, track] of (Array.isArray(edit.tracks) ? edit.tracks : []).entries()) {
    if (isRecord(track)) visit(track.items, `edit.json#tracks[${trackIndex}].items`);
  }

  const referencedMotion = new Set();
  for (const { item, path: itemPath } of entries) {
    if (item.source?.kind === "telop" && item.source.baked === undefined) {
      addFinding(findings, {
        severity: "error",
        check: "telop.retired",
        message: "テロップ（ATF）の描画は退役しました。HTML 素材版のテロップに差し替えてください（Lab で配布）。すでに焼いた baked を持つ項目はそのまま再生できます。",
        path: `${itemPath}.source`,
      });
    }
    if (isRecord(item.keyframes) && isNonEmptyString(item.keyframes.path)) {
      referencedMotion.add(item.keyframes.path);
      const filePath = resolve(paths.projectRoot, item.keyframes.path);
      let bag;
      try {
        bag = JSON.parse(await readFile(filePath, "utf8"));
      } catch {
        addFinding(findings, {
          severity: "error",
          check: "v2.keyframes-ref",
          message: `keyframes bag does not exist or is not valid JSON: ${item.keyframes.path}`,
          path: `${itemPath}.keyframes`,
        });
        continue;
      }
      const points = isRecord(bag.items) ? bag.items[item.id] : undefined;
      validateAnimatorRefs(item, points, findings, `${itemPath}.keyframes`);
      if (!Array.isArray(points) || points.length !== item.keyframes.count) {
        addFinding(findings, {
          severity: "error",
          check: "v2.keyframes-ref",
          message: `keyframes count ${String(item.keyframes.count)} does not match bag item count ${Array.isArray(points) ? points.length : "missing"}`,
          path: `${itemPath}.keyframes`,
        });
      }
    }
  }

  let captionsIds;
  const loadCaptionsIds = async () => {
    if (captionsIds !== undefined) return captionsIds;
    captionsIds = new Set();
    try {
      const parsed = JSON.parse(await readFile(paths.captionsPath, "utf8"));
      const rows = Array.isArray(parsed) ? parsed
        : Array.isArray(parsed?.rows) ? parsed.rows
          : Array.isArray(parsed?.captions) ? parsed.captions : [];
      for (const row of rows) if (isRecord(row) && isNonEmptyString(row.id)) captionsIds.add(row.id);
    } catch {
      // Missing captions.json is reported by the existing captions checks. part-ref remains a warning.
    }
    return captionsIds;
  };

  for (const { item, path: itemPath } of entries) {
    if (!isRecord(item.source)) continue;
    const source = item.source;
    if (source.kind === "html" && (isNonEmptyString(source.part) || Array.isArray(source.exclude))) {
      let html = "";
      try {
        html = await readFile(resolve(paths.projectRoot, source.path), "utf8");
      } catch {
        // The existing overlay file check reports the missing file; every requested part is absent here.
      }
      const requested = [
        ...(isNonEmptyString(source.part) ? [source.part] : []),
        ...(Array.isArray(source.exclude) ? source.exclude.filter(isNonEmptyString) : []),
      ];
      for (const id of requested) {
        const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        if (new RegExp(`data-akari-part="${escaped}"`, "u").test(html)) continue;
        addFinding(findings, {
          severity: "warning",
          check: "v2.part-ref",
          message: `HTML part id was not found at string level: ${id}`,
          path: `${itemPath}.source`,
        });
      }
    }
    if (source.kind === "captions" || source.kind === "caption") {
      const ids = await loadCaptionsIds();
      const requested = source.kind === "caption"
        ? [source.id]
        : Array.isArray(source.exclude) ? source.exclude.filter(isNonEmptyString) : [];
      for (const id of requested) {
        if (ids.has(id)) continue;
        addFinding(findings, {
          severity: "warning",
          check: "v2.part-ref",
          message: `captions row id was not found: ${String(id)}`,
          path: `${itemPath}.source`,
        });
      }
    }
  }

  const motionDirectory = join(paths.projectRoot, "motion");
  let motionFiles = [];
  try {
    motionFiles = (await readdir(motionDirectory, { withFileTypes: true }))
      .filter(entry => entry.isFile() && entry.name.endsWith(".json"))
      .map(entry => `motion/${entry.name}`);
  } catch {
    motionFiles = [];
  }
  for (const motionPath of motionFiles) {
    if (referencedMotion.has(motionPath)) continue;
    addFinding(findings, {
      severity: "warning",
      check: "motion.orphan",
      message: `motion bag is not referenced by edit.json: ${motionPath}`,
      path: motionPath,
    });
  }
}

function isVideoSourcePath(value) {
  return isNonEmptyString(value)
    && /\.(?:mp4|m4v|mov|webm|mkv|avi|mpeg|mpg|ogv)(?:[?#].*)?$/iu.test(value);
}

export function validateAudioMaster(value, findings, path) {
  if (value === undefined || value === null) return;
  if (!isRecord(value)) {
    addFinding(findings, { severity: "error", check: "audio.master.structure", message: "master must be an object", path });
    return;
  }
  if (Object.hasOwn(value, "denoise") && !["off", "std", "strong"].includes(value.denoise)) {
    addFinding(findings, { severity: "error", check: "audio.master.denoise", message: "denoise must be off/std/strong", path });
  }
  if (
    Object.hasOwn(value, "loudnorm") &&
    (!isFiniteNumber(value.loudnorm) || value.loudnorm < -70 || value.loudnorm > 0)
  ) {
    addFinding(findings, { severity: "error", check: "audio.master.loudnorm", message: "loudnorm must be a finite number within [-70, 0]", path });
  }
  if (
    Object.hasOwn(value, "true_peak_dbtp") &&
    (!isFiniteNumber(value.true_peak_dbtp) || value.true_peak_dbtp < -9 || value.true_peak_dbtp > 0)
  ) {
    addFinding(findings, { severity: "error", check: "audio.master.true-peak", message: "true_peak_dbtp must be a finite number within [-9, 0]", path });
  }
}

export function validateOutputEncoding(value, findings, path) {
  if (value === undefined) return;
  if (!isRecord(value)) {
    addFinding(findings, { severity: "error", check: "output.encoding.structure", message: "encoding must be an object", path });
    return;
  }
  for (const key of Object.keys(value)) {
    if (key !== "quality" && key !== "encoder") addFinding(findings, { severity: "error", check: "output.encoding.structure", message: `${key} is not defined by output.encoding`, path });
  }
  if (Object.hasOwn(value, "quality") && !["master", "high", "standard", "light"].includes(value.quality)) {
    addFinding(findings, { severity: "error", check: "output.encoding.quality", message: "quality must be master/high/standard/light", path });
  }
  if (Object.hasOwn(value, "encoder") && !["auto", "videotoolbox", "x264"].includes(value.encoder)) {
    addFinding(findings, { severity: "error", check: "output.encoding.encoder", message: "encoder must be auto/videotoolbox/x264", path });
  }
}
