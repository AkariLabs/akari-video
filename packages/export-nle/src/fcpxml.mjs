// FCPXML 1.11 writer — Final Cut Pro / DaVinci Resolve 向け。
//
// 構造: spine 直下に全尺の gap を 1 つ置き、その connected 要素として
//   lane 1  : カット列（nested spine — トランジションを置けるのは storyline だけ）
//   lane 2+ : layers（アルファ付き mov / PinP 実映像）
//   lane -1..: narration / sfx / bgm
// gap は start=0 の等速なので、connected 要素の offset = timeline 秒がそのまま成立する。
//
// xfade は「前カットの可視尺を重複分だけ詰めて突き合わせ、境界を跨ぐ transition 要素を置く」
// 近似で書く（AKARI レンダは全重複 xfade。カット点と後続の同期は保存、境界内のフレームは近似）。
// ⚠ BETA: 実 FCP / Resolve への取り込みは未確認。特に timeMap（speed）・adjust-blend の
// mode 名・adjust-volume のフェードキーフレームは仕様書ベースの推定実装。

import { element, document as xmlDocument } from "./xml.mjs";
import { fcpTime, fcpFrameDuration, toFrames } from "./time.mjs";
import { collectBaseDropped } from "./dropped.mjs";
import { collectMediaRefs, mediaFileUrl, isAudioOnlyPath } from "./media.mjs";
import { cutSpeed } from "./edit-model.mjs";

const PLACEHOLDER_AUDIO_SECONDS = 3;

export function buildFcpxml(model, { durations, frameDur, totalDuration }) {
  const warnings = [...model.warnings];
  const dropped = collectBaseDropped(model);
  const fd = frameDur;
  const t = (seconds) => fcpTime(seconds, fd);
  const halfFrame = fd.numerator / fd.denominator / 2;

  // --- resources -------------------------------------------------------------
  const formatId = "r1";
  const assetIds = new Map();
  const assetNodes = [];
  const refs = collectMediaRefs(model);
  refs.forEach((ref, index) => {
    const id = `a${index + 1}`;
    assetIds.set(ref.path, id);
    const audioOnly = isAudioOnlyPath(ref.path);
    const duration = durations.get(ref.path) ?? fallbackAssetDuration(model, ref, totalDuration);
    assetNodes.push(
      element(
        "asset",
        {
          id,
          name: ref.path.split("/").pop(),
          start: "0s",
          duration: t(duration),
          hasVideo: audioOnly ? undefined : "1",
          format: audioOnly ? undefined : formatId,
          hasAudio: "1",
          audioSources: "1",
          audioChannels: "2",
        },
        [element("media-rep", { kind: "original-media", src: mediaFileUrl(model.projectRoot, ref.path) })],
      ),
    );
  });

  const resources = element("resources", {}, [
    element("format", {
      id: formatId,
      name: `FFVideoFormat${model.output.height}p`,
      frameDuration: fcpFrameDuration(fd),
      width: String(Math.round(model.output.width)),
      height: String(Math.round(model.output.height)),
      colorSpace: "1-1-1 (Rec. 709)",
    }),
    ...assetNodes,
  ]);

  // --- カット列（lane 1）------------------------------------------------------
  const gapChildren = [];
  const looseMode = model.gapAware;
  if (looseMode && model.cuts.some((cut) => cut.transition_out)) {
    dropped.push({
      field: "cuts[].transition_out",
      reason: "at / track 指定のあるタイムラインではトランジション境界が隣接に限らないため書き出さない",
      hint: "書き出し先で手動でトランジションを追加する",
    });
  }

  const beatTargets = mapAnchorsToCuts(model, warnings, dropped);

  if (model.cuts.length > 0 && !looseMode) {
    const spineItems = [];
    let cursor = 0;
    model.cuts.forEach((cut, index) => {
      const placement = model.placements[index];
      const boundary = cut.transition_out && index + 1 < model.cuts.length
        ? cut.transition_out
        : null;
      const visibleDuration = boundary
        ? placement.duration - boundary.duration
        : placement.duration;
      if (placement.start - cursor > halfFrame) {
        spineItems.push(element("gap", {
          name: "Gap",
          offset: t(cursor),
          start: "0s",
          duration: t(placement.start - cursor),
        }));
      }
      spineItems.push(cutClipNode(model, cut, index, placement, visibleDuration, t, assetIds, beatTargets, fd));
      cursor = placement.start + visibleDuration;
      if (boundary) {
        const junction = placement.start + visibleDuration;
        spineItems.push(element("transition", {
          name: transitionName(boundary.type),
          offset: t(Math.max(placement.start, junction - boundary.duration / 2)),
          duration: t(boundary.duration),
        }));
        if (boundary.type !== "dissolve") {
          dropped.push({
            field: `cuts[${index}].transition_out.type`,
            reason: `${boundary.type} は FCPXML の既定トランジション（cross dissolve）で近似する`,
            hint: "書き出し先で dip to color へ差し替える",
          });
        }
      }
    });
    gapChildren.push(element("spine", { lane: "1", offset: "0s" }, spineItems));
  } else if (model.cuts.length > 0) {
    // gap-aware（at / track 指定あり）: 各カットを connected clip として絶対配置する
    model.cuts.forEach((cut, index) => {
      const placement = model.placements[index];
      const lane = 1 + (Number.isInteger(cut.track) && cut.track >= 0 ? cut.track : 0);
      gapChildren.push(cutClipNode(
        model, cut, index, placement, placement.duration, t, assetIds, beatTargets, fd,
        { lane: String(lane), offset: t(placement.start) },
      ));
    });
  }

  // --- layers（lane 2+）-------------------------------------------------------
  const layerLaneBase = 1 + Math.max(1, ...model.cuts.map((cut) => 1 + (cut.track ?? 0)));
  model.layers.forEach((layer, index) => {
    const lane = layerLaneBase + (Number.isInteger(layer.track) && layer.track >= 0 ? layer.track : 0);
    const children = [];
    if (layer.transform) children.push(transformNode(layer.transform));
    const blend = blendNode(layer.opacity, layer.blend, warnings);
    if (blend) children.push(blend);
    gapChildren.push(element("asset-clip", {
      ref: assetIds.get(layer.src),
      lane: String(lane),
      offset: t(layer.t),
      name: layer.id ?? `layer-${index + 1}`,
      start: "0s",
      duration: t(layer.duration),
    }, children));
  });

  // --- audio（lane -1..）------------------------------------------------------
  const sfxTracks = (model.sfx ?? []).map((item) => (Number.isInteger(item.track) && item.track >= 0 ? item.track : 0));
  const maxSfxTrack = sfxTracks.length > 0 ? Math.max(...sfxTracks) : -1;
  const bgmLane = -(3 + maxSfxTrack);

  for (const item of model.narration) {
    const duration = durations.get(item.path) ?? placeholderDuration(item.path, "narration", warnings);
    gapChildren.push(audioClipNode(assetIds.get(item.path), {
      lane: "-1",
      offset: t(item.t),
      name: item.id,
      start: "0s",
      duration: t(duration),
      audioRole: "dialogue",
    }, item.gain_db, t));
  }
  for (const item of model.sfx ?? []) {
    const inPoint = typeof item.in === "number" ? item.in : 0;
    const known = typeof item.out === "number"
      ? item.out - inPoint
      : (durations.get(item.path) ?? placeholderDuration(item.path, "sfx", warnings)) - inPoint;
    const track = Number.isInteger(item.track) && item.track >= 0 ? item.track : 0;
    gapChildren.push(audioClipNode(assetIds.get(item.path), {
      lane: String(-2 - track),
      offset: t(item.t),
      name: item.path.split("/").pop(),
      start: t(inPoint),
      duration: t(Math.max(known, fd.numerator / fd.denominator)),
      audioRole: "effects",
    }, item.gain_db, t));
  }
  if (model.bgm) {
    emitBgmClips(model, gapChildren, { durations, t, totalDuration, bgmLane, assetIds, warnings, fd });
  }

  // --- 全体 -------------------------------------------------------------------
  const gap = element("gap", {
    name: "AKARI Timeline",
    offset: "0s",
    start: "0s",
    duration: t(totalDuration),
  }, gapChildren);

  const root = element("fcpxml", { version: "1.11" }, [
    resources,
    element("library", {}, [
      element("event", { name: "AKARI Export" }, [
        element("project", { name: model.projectName }, [
          element("sequence", {
            format: formatId,
            duration: t(totalDuration),
            tcStart: "0s",
            tcFormat: "NDF",
            audioLayout: "stereo",
            audioRate: "48k",
          }, [element("spine", {}, [gap])]),
        ]),
      ]),
    ]),
  ]);

  return { xml: xmlDocument(root, "<!DOCTYPE fcpxml>"), dropped, warnings };
}

function cutClipNode(model, cut, index, placement, visibleDuration, t, assetIds, beatTargets, fd, extraAttrs = {}) {
  const children = [];
  const speed = cutSpeed(cut);
  if (speed !== 1) {
    // ⚠ 未検証: 等速リタイムを 2 点の timeMap で表現する（time=クリップ内時間 / value=素材時間）
    children.push(element("timeMap", {}, [
      element("timept", { time: t(cut.in), value: t(cut.in), interp: "smooth2" }),
      element("timept", {
        time: t(cut.in + visibleDuration),
        value: t(cut.in + visibleDuration * speed),
        interp: "smooth2",
      }),
    ]));
  }
  if (cut.transform) children.push(transformNode(cut.transform));
  const blend = blendNode(cut.opacity, null, null);
  if (blend) children.push(blend);
  for (const marker of beatTargets.get(index) ?? []) {
    children.push(element("marker", {
      start: t(marker.start),
      duration: t(Math.max(marker.duration, fd.numerator / fd.denominator)),
      value: marker.value,
      note: marker.note || undefined,
    }));
  }
  return element("asset-clip", {
    ref: assetIds.get(sourcePath(model, cut.src)),
    offset: t(placement.start),
    name: `${cut.src} ${index + 1}`,
    start: t(cut.in),
    duration: t(visibleDuration),
    ...extraAttrs,
  }, children);
}

// beats / emphasis_words は (src, source 秒) アンカー。カット内側の時刻はクリップの
// ローカル時間 = 素材時間なので、含むカットのクリップへそのまま marker として付ける。
function mapAnchorsToCuts(model, warnings, dropped) {
  const targets = new Map();
  const attach = (anchorStart, anchorEnd, src, value, note, field) => {
    const index = model.cuts.findIndex((cut) =>
      (src === null || cut.src === src) && anchorStart >= cut.in && anchorStart < cut.out);
    if (index === -1) {
      dropped.push({ field, reason: "アンカーがどのカットにも含まれない", hint: "カット範囲外のマーカーは書き出されない" });
      return;
    }
    if (!targets.has(index)) targets.set(index, []);
    targets.get(index).push({
      start: anchorStart,
      duration: Math.max(0, anchorEnd - anchorStart),
      value,
      note,
    });
  };
  for (const beat of model.beats) {
    const src = typeof beat.src === "string" ? beat.src : (model.version === 0 ? null : null);
    attach(beat.t, beat.t, src, `beat:${beat.kind} (${beat.strength})`, beat.basis ?? "", `beats[${beat.id}]`);
  }
  for (const word of model.emphasisWords) {
    const src = typeof word.src === "string" ? word.src : null;
    const note = [word.emotion, word.style_hint].filter(Boolean).join(" / ");
    attach(word.t_start, word.t_end, src, `emphasis:${word.word}`, note, `emphasis_words[${word.id}]`);
  }
  return targets;
}

function emitBgmClips(model, gapChildren, { durations, t, totalDuration, bgmLane, assetIds, warnings, fd }) {
  const bgm = model.bgm;
  const assetDuration = durations.get(bgm.path);
  const inPoint = typeof bgm.in === "number" ? bgm.in : 0;
  const fadeIn = typeof bgm.fadeIn === "number" ? bgm.fadeIn : 0;
  const fadeOut = typeof bgm.fadeOut === "number" ? bgm.fadeOut : 0;
  const pieces = [];
  if (typeof assetDuration === "number" && assetDuration > 0) {
    // タイムライン全体尺までループ展開（AKARI レンダのループ意味論の実体化）
    let covered = 0;
    let first = true;
    while (covered < totalDuration - fd.numerator / fd.denominator / 2) {
      const start = first ? Math.min(inPoint, assetDuration) : 0;
      const available = assetDuration - start;
      const duration = Math.min(available, totalDuration - covered);
      if (duration <= 0) break;
      pieces.push({ offset: covered, start, duration });
      covered += duration;
      first = false;
    }
  } else {
    warnings.push(`bgm の実尺が不明（ffprobe 不使用/失敗）— ループ展開せず全体尺 1 クリップで書き出す: ${bgm.path}`);
    pieces.push({ offset: 0, start: inPoint, duration: totalDuration });
  }
  pieces.forEach((piece, index) => {
    const isFirst = index === 0;
    const isLast = index === pieces.length - 1;
    const gain = typeof bgm.gain_db === "number" ? bgm.gain_db : 0;
    const children = [];
    const fadeKeyframes = [];
    if (isFirst && fadeIn > 0) {
      fadeKeyframes.push({ time: 0, value: -96 }, { time: Math.min(fadeIn, piece.duration), value: gain });
    }
    if (isLast && fadeOut > 0) {
      fadeKeyframes.push(
        { time: Math.max(0, piece.duration - fadeOut), value: gain },
        { time: piece.duration, value: -96 },
      );
    }
    if (fadeKeyframes.length > 0) {
      // ⚠ 未検証: フェードを adjust-volume の keyframeAnimation で表現する
      children.push(element("adjust-volume", {}, [
        element("param", { name: "amount" }, [
          element("keyframeAnimation", {}, fadeKeyframes.map((keyframe) =>
            element("keyframe", { time: t(keyframe.time), value: `${keyframe.value}dB` }))),
        ]),
      ]));
    } else if (gain !== 0) {
      children.push(element("adjust-volume", { amount: `${gain}dB` }));
    }
    gapChildren.push(element("asset-clip", {
      ref: assetIds.get(bgm.path),
      lane: String(bgmLane),
      offset: t(piece.offset),
      name: `bgm${pieces.length > 1 ? ` (loop ${index + 1})` : ""}`,
      start: t(piece.start),
      duration: t(piece.duration),
      audioRole: "music",
    }, children));
  });
}

function audioClipNode(ref, attrs, gainDb, t) {
  const children = [];
  if (typeof gainDb === "number" && gainDb !== 0) {
    children.push(element("adjust-volume", { amount: `${gainDb}dB` }));
  }
  return element("asset-clip", { ref, ...attrs }, children);
}

function transformNode(transform) {
  const x = typeof transform.x === "number" ? transform.x : 0;
  const y = typeof transform.y === "number" ? transform.y : 0;
  const scale = typeof transform.scale === "number" ? transform.scale : 1;
  const rotate = typeof transform.rotate === "number" ? transform.rotate : 0;
  // ⚠ 未検証: position の単位は AKARI の px 値をそのまま書く（FCP 側の座標系差は取り込み時要確認）
  return element("adjust-transform", {
    position: `${x} ${y}`,
    scale: `${scale} ${scale}`,
    rotation: String(rotate),
  });
}

function blendNode(opacity, blendMode, warnings) {
  const hasOpacity = typeof opacity === "number" && opacity < 1;
  const hasMode = typeof blendMode === "string" && blendMode !== "normal";
  if (!hasOpacity && !hasMode) return null;
  if (hasMode) {
    warnings?.push(`blend mode "${blendMode}" は FCPXML の mode 名へそのまま書く（未検証・取り込み側で無視される可能性あり）`);
  }
  return element("adjust-blend", {
    amount: hasOpacity ? String(opacity) : "1",
    mode: hasMode ? blendMode : undefined,
  });
}

function transitionName(type) {
  // FCPXML は子要素なしの transition が既定の cross dissolve になる。
  // fade-black / fade-white は名前だけ変えて cross dissolve 近似（dropped で明示）。
  if (type === "fade-black") return "Fade To Black (approximated)";
  if (type === "fade-white") return "Fade To White (approximated)";
  return "Cross Dissolve";
}

function sourcePath(model, srcId) {
  return model.sources.find((source) => source.id === srcId)?.path;
}

function fallbackAssetDuration(model, ref, totalDuration) {
  if (ref.roles.has("source")) {
    const sourceIds = model.sources.filter((s) => s.path === ref.path).map((s) => s.id);
    const outs = model.cuts.filter((cut) => sourceIds.includes(cut.src)).map((cut) => cut.out);
    if (outs.length > 0) return Math.max(...outs);
  }
  if (ref.roles.has("layer")) {
    const durations = model.layers.filter((layer) => layer.src === ref.path).map((layer) => layer.duration);
    if (durations.length > 0) return Math.max(...durations);
  }
  if (ref.roles.has("bgm")) return totalDuration;
  return PLACEHOLDER_AUDIO_SECONDS;
}

function placeholderDuration(path, role, warnings) {
  warnings.push(`${role} の実尺が不明（ffprobe 不使用/失敗）— ${PLACEHOLDER_AUDIO_SECONDS}s のプレースホルダ尺で書き出す: ${path}`);
  return PLACEHOLDER_AUDIO_SECONDS;
}
