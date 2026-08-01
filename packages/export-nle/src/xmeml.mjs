// FCP7 XML (xmeml v5) writer — Premiere Pro 向け。
// 時刻は全て整数フレーム（timebase + ntsc フラグ）。NTSC 系 fps は timebase 30/24/60 +
// ntsc TRUE に落とし、フレーム番号は真の fps で丸める。
// ⚠ BETA: 実 Premiere への取り込みは未確認。特に timeremap（speed）・Basic Motion の
// center 座標系・audiolevels のキーフレームは仕様書と既存輸出物の観察に基づく推定実装。

import { element, document as xmlDocument } from "./xml.mjs";
import { xmemlRate, exactFps } from "./time.mjs";
import { collectBaseDropped } from "./dropped.mjs";
import { collectMediaRefs, isAudioOnlyPath, absoluteMediaPath } from "./media.mjs";
import { cutSpeed, sourcePointToTimeline } from "./edit-model.mjs";
import { pathToFileURL } from "node:url";

const PLACEHOLDER_AUDIO_SECONDS = 3;

// float 演算のノイズ（1.2 * 100 = 120.00000000000001 等）を落として文字列化する。
function num(value) {
  return String(Math.round(value * 1e6) / 1e6);
}

export function buildXmeml(model, { durations, frameDur, totalDuration }) {
  const warnings = [...model.warnings];
  const dropped = collectBaseDropped(model);
  const fps = exactFps(frameDur);
  const rate = xmemlRate(fps);
  const toFrame = (seconds) => Math.round(seconds * fps);
  const rateNode = () => element("rate", {}, [
    element("timebase", {}, [], String(rate.timebase)),
    element("ntsc", {}, [], rate.ntsc ? "TRUE" : "FALSE"),
  ]);

  // --- file 定義（初出でフル定義、以後は id 参照のみ）---------------------------
  const fileIds = new Map();
  const fileDefined = new Set();
  collectMediaRefs(model).forEach((ref, index) => fileIds.set(ref.path, `file-${index + 1}`));
  const fileNode = (path) => {
    const id = fileIds.get(path);
    if (fileDefined.has(id)) return element("file", { id });
    fileDefined.add(id);
    const audioOnly = isAudioOnlyPath(path);
    const known = durations.get(path);
    const children = [
      element("name", {}, [], path.split("/").pop()),
      element("pathurl", {}, [], pathToFileURL(absoluteMediaPath(model.projectRoot, path)).href),
      rateNode(),
    ];
    if (typeof known === "number") children.push(element("duration", {}, [], String(toFrame(known))));
    children.push(element("media", {}, [
      ...(audioOnly ? [] : [element("video", {}, [element("samplecharacteristics", {}, [
        element("width", {}, [], String(Math.round(model.output.width))),
        element("height", {}, [], String(Math.round(model.output.height))),
      ])])]),
      element("audio", {}, [element("samplecharacteristics", {}, [
        element("samplerate", {}, [], "48000"),
        element("depth", {}, [], "16"),
      ])]),
    ]));
    return element("file", { id }, children);
  };

  // --- video tracks -----------------------------------------------------------
  let clipSerial = 0;
  const clipId = () => `clipitem-${clipSerial += 1}`;

  const videoTracks = [];
  const cutTrackIndexes = [...new Set(model.cuts.map((cut) => (Number.isInteger(cut.track) && cut.track >= 0 ? cut.track : 0)))].sort((a, b) => a - b);
  for (const trackIndex of cutTrackIndexes.length > 0 ? cutTrackIndexes : []) {
    const items = [];
    model.cuts.forEach((cut, index) => {
      const cutTrack = Number.isInteger(cut.track) && cut.track >= 0 ? cut.track : 0;
      if (cutTrack !== trackIndex) return;
      const placement = model.placements[index];
      const boundary = !model.gapAware && cut.transition_out && index + 1 < model.cuts.length
        ? cut.transition_out
        : null;
      const visibleDuration = boundary ? placement.duration - boundary.duration : placement.duration;
      items.push(cutClipItem(model, cut, index, placement, visibleDuration, {
        toFrame, rateNode, fileNode, clipId, warnings,
      }));
      if (boundary) {
        const junction = placement.start + visibleDuration;
        items.push(transitionItem(boundary, junction, { toFrame, rateNode }));
        if (boundary.type !== "dissolve") {
          dropped.push({
            field: `cuts[${index}].transition_out.type`,
            reason: `${boundary.type} は Cross Dissolve で近似する`,
            hint: "書き出し先で Dip to Black/White へ差し替える",
          });
        }
      }
    });
    videoTracks.push(element("track", {}, items));
  }
  if (model.gapAware && model.cuts.some((cut) => cut.transition_out)) {
    dropped.push({
      field: "cuts[].transition_out",
      reason: "at / track 指定のあるタイムラインではトランジション境界が隣接に限らないため書き出さない",
      hint: "書き出し先で手動でトランジションを追加する",
    });
  }
  const layerTracks = [...new Set(model.layers.map((layer) => (Number.isInteger(layer.track) && layer.track >= 0 ? layer.track : 0)))].sort((a, b) => a - b);
  for (const trackIndex of layerTracks) {
    const items = model.layers
      .filter((layer) => (Number.isInteger(layer.track) && layer.track >= 0 ? layer.track : 0) === trackIndex)
      .map((layer) => layerClipItem(model, layer, { toFrame, rateNode, fileNode, clipId, warnings }));
    videoTracks.push(element("track", {}, items));
  }

  // --- audio tracks -----------------------------------------------------------
  const audioTracks = [];
  if (model.narration.length > 0) {
    audioTracks.push(element("track", {}, model.narration.map((item) => {
      const duration = durations.get(item.path) ?? placeholder(item.path, "narration", warnings);
      return audioClipItem(item.id, item.path, {
        timelineStart: item.t,
        timelineDuration: duration,
        sourceIn: 0,
        gainDb: item.gain_db,
        fades: null,
      }, { toFrame, rateNode, fileNode, clipId });
    })));
  }
  const sfxTrackIndexes = [...new Set((model.sfx ?? []).map((item) => (Number.isInteger(item.track) && item.track >= 0 ? item.track : 0)))].sort((a, b) => a - b);
  for (const trackIndex of sfxTrackIndexes) {
    const items = (model.sfx ?? [])
      .filter((item) => (Number.isInteger(item.track) && item.track >= 0 ? item.track : 0) === trackIndex)
      .map((item) => {
        const inPoint = typeof item.in === "number" ? item.in : 0;
        const duration = typeof item.out === "number"
          ? item.out - inPoint
          : (durations.get(item.path) ?? placeholder(item.path, "sfx", warnings)) - inPoint;
        return audioClipItem(item.path.split("/").pop(), item.path, {
          timelineStart: item.t,
          timelineDuration: Math.max(duration, 1 / fps),
          sourceIn: inPoint,
          gainDb: item.gain_db,
          fades: null,
        }, { toFrame, rateNode, fileNode, clipId });
      });
    audioTracks.push(element("track", {}, items));
  }
  if (model.bgm) {
    audioTracks.push(element("track", {}, bgmClipItems(model, {
      durations, totalDuration, toFrame, rateNode, fileNode, clipId, warnings, fps,
    })));
  }

  // --- sequence markers（beats / emphasis_words を timeline へ写す）--------------
  const markers = [];
  for (const beat of model.beats) {
    const src = typeof beat.src === "string" ? beat.src : null;
    const mapped = mapAnchor(model, beat.t, src);
    if (mapped === null) {
      dropped.push({ field: `beats[${beat.id}]`, reason: "アンカーがどのカットにも含まれない", hint: "カット範囲外のマーカーは書き出されない" });
      continue;
    }
    markers.push(sequenceMarker(`beat:${beat.kind} (${beat.strength})`, beat.basis ?? "", mapped, null, toFrame));
  }
  for (const word of model.emphasisWords) {
    const src = typeof word.src === "string" ? word.src : null;
    const mappedStart = mapAnchor(model, word.t_start, src);
    if (mappedStart === null) {
      dropped.push({ field: `emphasis_words[${word.id}]`, reason: "アンカーがどのカットにも含まれない", hint: "カット範囲外のマーカーは書き出されない" });
      continue;
    }
    const mappedEnd = mapAnchor(model, word.t_end, src);
    markers.push(sequenceMarker(
      `emphasis:${word.word}`,
      [word.emotion, word.style_hint].filter(Boolean).join(" / "),
      mappedStart,
      mappedEnd,
      toFrame,
    ));
  }

  const sequence = element("sequence", { id: "sequence-1" }, [
    element("name", {}, [], model.projectName),
    element("duration", {}, [], String(toFrame(totalDuration))),
    rateNode(),
    element("media", {}, [
      element("video", {}, [
        element("format", {}, [element("samplecharacteristics", {}, [
          element("width", {}, [], String(Math.round(model.output.width))),
          element("height", {}, [], String(Math.round(model.output.height))),
          element("pixelaspectratio", {}, [], "square"),
          rateNode(),
        ])]),
        ...videoTracks,
      ]),
      element("audio", {}, audioTracks),
    ]),
    element("timecode", {}, [
      rateNode(),
      element("frame", {}, [], "0"),
      element("displayformat", {}, [], rate.ntsc ? "DF" : "NDF"),
    ]),
    ...markers,
  ]);

  const root = element("xmeml", { version: "5" }, [sequence]);
  return { xml: xmlDocument(root, "<!DOCTYPE xmeml>"), dropped, warnings };
}

function cutClipItem(model, cut, index, placement, visibleDuration, context) {
  const { toFrame, rateNode, fileNode, clipId, warnings } = context;
  const speed = cutSpeed(cut);
  const path = model.sources.find((source) => source.id === cut.src)?.path;
  const filters = [];
  if (cut.transform) filters.push(basicMotionFilter(cut.transform, model.output));
  if (typeof cut.opacity === "number" && cut.opacity < 1) filters.push(opacityFilter(cut.opacity));
  if (speed !== 1) {
    // ⚠ 未検証: FCP7 流儀の timeremap 定速。Premiere は speed パラメータ（%）を読む
    warnings.push(`cuts[${index}] speed=${speed} を timeremap 定速で書き出す（未検証）`);
    filters.push(element("filter", {}, [element("effect", {}, [
      element("name", {}, [], "Time Remap"),
      element("effectid", {}, [], "timeremap"),
      element("effectcategory", {}, [], "motion"),
      element("effecttype", {}, [], "motion"),
      element("mediatype", {}, [], "video"),
      element("parameter", {}, [
        element("parameterid", {}, [], "variablespeed"),
        element("name", {}, [], "variablespeed"),
        element("valuemin", {}, [], "0"),
        element("valuemax", {}, [], "1"),
        element("value", {}, [], "0"),
      ]),
      element("parameter", {}, [
        element("parameterid", {}, [], "speed"),
        element("name", {}, [], "speed"),
        element("valuemin", {}, [], "-100000"),
        element("valuemax", {}, [], "100000"),
        element("value", {}, [], num(speed * 100)),
      ]),
    ])]));
  }
  return element("clipitem", { id: clipId() }, [
    element("name", {}, [], `${cut.src} ${index + 1}`),
    element("enabled", {}, [], "TRUE"),
    element("duration", {}, [], String(toFrame(visibleDuration))),
    rateNode(),
    element("start", {}, [], String(toFrame(placement.start))),
    element("end", {}, [], String(toFrame(placement.start + visibleDuration))),
    element("in", {}, [], String(toFrame(cut.in))),
    element("out", {}, [], String(toFrame(cut.in + visibleDuration * speed))),
    fileNode(path),
    ...filters,
  ]);
}

function layerClipItem(model, layer, context) {
  const { toFrame, rateNode, fileNode, clipId, warnings } = context;
  const filters = [];
  if (layer.transform) filters.push(basicMotionFilter(layer.transform, model.output));
  if (typeof layer.opacity === "number" && layer.opacity < 1) filters.push(opacityFilter(layer.opacity));
  if (typeof layer.blend === "string" && layer.blend !== "normal") {
    warnings.push(`layers[${layer.id}] blend=${layer.blend} は xmeml に相互運用表現がなく落ちる（合成モードは書き出し先で再設定）`);
  }
  return element("clipitem", { id: clipId() }, [
    element("name", {}, [], layer.id),
    element("enabled", {}, [], "TRUE"),
    element("duration", {}, [], String(toFrame(layer.duration))),
    rateNode(),
    element("start", {}, [], String(toFrame(layer.t))),
    element("end", {}, [], String(toFrame(layer.t + layer.duration))),
    element("in", {}, [], "0"),
    element("out", {}, [], String(toFrame(layer.duration))),
    fileNode(layer.src),
    ...filters,
  ]);
}

function audioClipItem(name, path, placement, context) {
  const { toFrame, rateNode, fileNode, clipId } = context;
  const filters = [];
  if (placement.fades) {
    filters.push(audioLevelsFilter(null, placement.fades, toFrame));
  } else if (typeof placement.gainDb === "number" && placement.gainDb !== 0) {
    filters.push(audioLevelsFilter(placement.gainDb, null, toFrame));
  }
  return element("clipitem", { id: clipId() }, [
    element("name", {}, [], name),
    element("enabled", {}, [], "TRUE"),
    element("duration", {}, [], String(toFrame(placement.timelineDuration))),
    rateNode(),
    element("start", {}, [], String(toFrame(placement.timelineStart))),
    element("end", {}, [], String(toFrame(placement.timelineStart + placement.timelineDuration))),
    element("in", {}, [], String(toFrame(placement.sourceIn))),
    element("out", {}, [], String(toFrame(placement.sourceIn + placement.timelineDuration))),
    fileNode(path),
    ...filters,
  ]);
}

function bgmClipItems(model, context) {
  const { durations, totalDuration, toFrame, rateNode, fileNode, clipId, warnings, fps } = context;
  const bgm = model.bgm;
  const assetDuration = durations.get(bgm.path);
  const inPoint = typeof bgm.in === "number" ? bgm.in : 0;
  const fadeIn = typeof bgm.fadeIn === "number" ? bgm.fadeIn : 0;
  const fadeOut = typeof bgm.fadeOut === "number" ? bgm.fadeOut : 0;
  const gain = typeof bgm.gain_db === "number" ? bgm.gain_db : 0;
  const pieces = [];
  if (typeof assetDuration === "number" && assetDuration > 0) {
    let covered = 0;
    let first = true;
    while (covered < totalDuration - 1 / fps / 2) {
      const start = first ? Math.min(inPoint, assetDuration) : 0;
      const duration = Math.min(assetDuration - start, totalDuration - covered);
      if (duration <= 0) break;
      pieces.push({ offset: covered, start, duration });
      covered += duration;
      first = false;
    }
  } else {
    warnings.push(`bgm の実尺が不明（ffprobe 不使用/失敗）— ループ展開せず全体尺 1 クリップで書き出す: ${bgm.path}`);
    pieces.push({ offset: 0, start: inPoint, duration: totalDuration });
  }
  return pieces.map((piece, index) => {
    const isFirst = index === 0;
    const isLast = index === pieces.length - 1;
    const keyframes = [];
    if (isFirst && fadeIn > 0) {
      keyframes.push({ at: 0, db: -96 }, { at: Math.min(fadeIn, piece.duration), db: gain });
    }
    if (isLast && fadeOut > 0) {
      keyframes.push({ at: Math.max(0, piece.duration - fadeOut), db: gain }, { at: piece.duration, db: -96 });
    }
    return audioClipItem(
      `bgm${pieces.length > 1 ? ` (loop ${index + 1})` : ""}`,
      bgm.path,
      {
        timelineStart: piece.offset,
        timelineDuration: piece.duration,
        sourceIn: piece.start,
        gainDb: gain,
        fades: keyframes.length > 0 ? { keyframes, gainDb: gain } : null,
      },
      { toFrame, rateNode, fileNode, clipId },
    );
  });
}

// dB → xmeml audiolevels の線形値（1.0 = 0dB）。
function dbToLevel(db) {
  return 10 ** (db / 20);
}

function audioLevelsFilter(gainDb, fades, toFrame) {
  const parameterChildren = [
    element("parameterid", {}, [], "level"),
    element("name", {}, [], "Level"),
    element("valuemin", {}, [], "0"),
    element("valuemax", {}, [], "3.980469"),
  ];
  if (fades) {
    for (const keyframe of fades.keyframes) {
      parameterChildren.push(element("keyframe", {}, [
        element("when", {}, [], String(toFrame(keyframe.at))),
        element("value", {}, [], dbToLevel(keyframe.db).toFixed(6)),
      ]));
    }
  } else {
    parameterChildren.push(element("value", {}, [], dbToLevel(gainDb).toFixed(6)));
  }
  return element("filter", {}, [element("effect", {}, [
    element("name", {}, [], "Audio Levels"),
    element("effectid", {}, [], "audiolevels"),
    element("effectcategory", {}, [], "audiolevels"),
    element("effecttype", {}, [], "audiolevels"),
    element("mediatype", {}, [], "audio"),
    element("parameter", {}, parameterChildren),
  ])]);
}

function basicMotionFilter(transform, output) {
  const x = typeof transform.x === "number" ? transform.x : 0;
  const y = typeof transform.y === "number" ? transform.y : 0;
  const scale = typeof transform.scale === "number" ? transform.scale : 1;
  const rotate = typeof transform.rotate === "number" ? transform.rotate : 0;
  // ⚠ 未検証: center は画面幅/高さで正規化した相対値（Premiere の xmeml 観察に基づく）
  return element("filter", {}, [element("effect", {}, [
    element("name", {}, [], "Basic Motion"),
    element("effectid", {}, [], "basic"),
    element("effectcategory", {}, [], "motion"),
    element("effecttype", {}, [], "motion"),
    element("mediatype", {}, [], "video"),
    element("parameter", {}, [
      element("parameterid", {}, [], "scale"),
      element("name", {}, [], "Scale"),
      element("valuemin", {}, [], "0"),
      element("valuemax", {}, [], "1000"),
      element("value", {}, [], num(scale * 100)),
    ]),
    element("parameter", {}, [
      element("parameterid", {}, [], "rotation"),
      element("name", {}, [], "Rotation"),
      element("valuemin", {}, [], "-8640"),
      element("valuemax", {}, [], "8640"),
      element("value", {}, [], num(rotate)),
    ]),
    element("parameter", {}, [
      element("parameterid", {}, [], "center"),
      element("name", {}, [], "Center"),
      element("value", {}, [
        element("horiz", {}, [], num(x / output.width)),
        element("vert", {}, [], num(y / output.height)),
      ]),
    ]),
  ])]);
}

function opacityFilter(opacity) {
  return element("filter", {}, [element("effect", {}, [
    element("name", {}, [], "Opacity"),
    element("effectid", {}, [], "opacity"),
    element("effectcategory", {}, [], "motion"),
    element("effecttype", {}, [], "motion"),
    element("mediatype", {}, [], "video"),
    element("parameter", {}, [
      element("parameterid", {}, [], "opacity"),
      element("name", {}, [], "opacity"),
      element("valuemin", {}, [], "0"),
      element("valuemax", {}, [], "100"),
      element("value", {}, [], num(opacity * 100)),
    ]),
  ])]);
}

function transitionItem(boundary, junction, { toFrame, rateNode }) {
  const half = boundary.duration / 2;
  return element("transitionitem", {}, [
    rateNode(),
    element("start", {}, [], String(Math.max(0, toFrame(junction - half)))),
    element("end", {}, [], String(toFrame(junction + half))),
    element("alignment", {}, [], "center"),
    element("effect", {}, [
      element("name", {}, [], "Cross Dissolve"),
      element("effectid", {}, [], "Cross Dissolve"),
      element("effectcategory", {}, [], "Dissolve"),
      element("effecttype", {}, [], "transition"),
      element("mediatype", {}, [], "video"),
      element("wipecode", {}, [], "0"),
      element("wipeaccuracy", {}, [], "100"),
      element("startratio", {}, [], "0"),
      element("endratio", {}, [], "1"),
      element("reverse", {}, [], "FALSE"),
    ]),
  ]);
}

function sequenceMarker(name, comment, startSeconds, endSeconds, toFrame) {
  return element("marker", {}, [
    element("comment", {}, [], comment),
    element("name", {}, [], name),
    element("in", {}, [], String(toFrame(startSeconds))),
    element("out", {}, [], endSeconds === null ? "-1" : String(toFrame(endSeconds))),
  ]);
}

// (src, source 秒) アンカー → timeline 秒（xmeml はシーケンスマーカーなので単点写像だけ使う）。
function mapAnchor(model, t, src) {
  return sourcePointToTimeline(t, model.cuts, src);
}

function placeholder(path, role, warnings) {
  warnings.push(`${role} の実尺が不明（ffprobe 不使用/失敗）— ${PLACEHOLDER_AUDIO_SECONDS}s のプレースホルダ尺で書き出す: ${path}`);
  return PLACEHOLDER_AUDIO_SECONDS;
}
