// edit.json v0/v1 を読み込み、書き出し器が使う正規化モデルへ落とす。
// タイムライン意味論（speed / at / xfade 重複 / 字幕の source 秒アンカー）の正本は
// packages/render-cut/src/cut-timeline.mjs と captions.mjs。本ファイルはその最小移植で、
// render-cut 側が変わったらここも追随する（依存を持たないのは、render-cut が
// hyperframes / puppeteer-core を引き込むため。ドリフト検知は契約文書の責務）。

import { readFileSync, statSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";

export function cutSpeed(cut) {
  const value = cut?.speed;
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 1;
}

export function segmentDuration(cut) {
  return (cut.out - cut.in) / cutSpeed(cut);
}

const EPSILON = 1e-6;

// render-cut/src/cut-timeline.mjs resolveCutSegments と同意味論:
// track ごとのカーソルへ追記し、有効な at があれば上書きする。
export function resolveCutSegments(cuts) {
  const cursorByTrack = new Map();
  const segments = [];
  cuts.forEach((cut, index) => {
    const hasValidTrack = Number.isInteger(cut.track) && cut.track >= 0;
    const track = hasValidTrack ? cut.track : 0;
    const duration = segmentDuration(cut);
    const cursor = cursorByTrack.get(track) ?? 0;
    const hasValidAt = typeof cut.at === "number" && Number.isFinite(cut.at) && cut.at >= 0;
    const start = hasValidAt ? cut.at : cursor;
    const end = start + duration;
    cursorByTrack.set(track, end);
    segments.push({ index, cut, track, start, end });
  });
  return segments;
}

export function needsGapAwareCutTimeline(cuts) {
  if (!Array.isArray(cuts) || cuts.length === 0) return false;
  const segments = resolveCutSegments(cuts);
  let cursor = 0;
  for (const segment of segments) {
    if (segment.track !== 0) return true;
    if (Math.abs(segment.start - cursor) > EPSILON) return true;
    cursor = segment.end;
  }
  return false;
}

// render-cut/src/cut-timeline.mjs computeCutTimelineOffsets と同意味論:
// 逐次連結で、xfade（transition_out）の重複時間だけ次カットの開始を前倒しする。
export function computeCutTimelineOffsets(cuts) {
  if (!Array.isArray(cuts) || cuts.length === 0) return [];
  const offsets = [];
  let start = 0;
  let duration = segmentDuration(cuts[0]);
  offsets.push({ start, duration });
  for (let index = 1; index < cuts.length; index += 1) {
    const boundary = cuts[index - 1].transition_out;
    const transitionDuration = boundary ? boundary.duration : 0;
    start = start + duration - transitionDuration;
    duration = segmentDuration(cuts[index]);
    offsets.push({ start, duration });
  }
  return offsets;
}

// render-cut/src/captions.mjs computeCaptionRanges の最小移植（linearTimeline=false 固定）。
// captions / beats / emphasis_words の時刻は timeline 秒ではなく (src, source 秒) アンカー。
export function sourceRangeToTimelineRanges(start, end, cuts, sourceId = null) {
  if (!Array.isArray(cuts) || cuts.length === 0) {
    return [{ start, duration: end - start, sourceStart: start, sourceEnd: end }];
  }
  const offsets = computeCutTimelineOffsets(cuts);
  const ranges = [];
  for (const [index, cut] of cuts.entries()) {
    if (sourceId !== null && cut.src !== sourceId) continue;
    const overlapStart = Math.max(start, cut.in);
    const overlapEnd = Math.min(end, cut.out);
    if (overlapEnd > overlapStart) {
      const speed = cutSpeed(cut);
      ranges.push({
        start: offsets[index].start + (overlapStart - cut.in) / speed,
        duration: (overlapEnd - overlapStart) / speed,
        sourceStart: overlapStart,
        sourceEnd: overlapEnd,
      });
    }
  }
  return ranges;
}

// source 秒の 1 点 t を timeline 秒へ写す。どのカットにも含まれなければ null。
export function sourcePointToTimeline(t, cuts, sourceId = null) {
  const ranges = sourceRangeToTimelineRanges(t, t + EPSILON, cuts, sourceId);
  return ranges.length > 0 ? ranges[0].start : null;
}

export function loadEditFile(inputPath) {
  const absolute = resolve(inputPath);
  const stats = statSync(absolute);
  const editPath = stats.isDirectory() ? resolve(absolute, "edit.json") : absolute;
  const projectRoot = dirname(editPath);
  const edit = JSON.parse(readFileSync(editPath, "utf8"));
  return { edit, editPath, projectRoot };
}

export const V0_SOURCE_ID = "source";

// v0/v1 の差（source 単数 / sources 配列 + cuts[].src）を吸収した正規化モデル。
export function normalizeEdit(edit, projectRoot) {
  const warnings = [];
  const version = edit.version;
  if (version !== 0 && version !== 1) {
    throw new Error(`edit.json version が 0/1 ではない: ${JSON.stringify(version)}`);
  }
  const sources = version === 0
    ? [{ id: V0_SOURCE_ID, path: edit.source.path, chroma_key: edit.source.chroma_key ?? null }]
    : edit.sources.map((source) => ({
        id: source.id,
        path: source.path,
        chroma_key: source.chroma_key ?? null,
      }));
  const cuts = (edit.cuts ?? []).map((cut) => (
    version === 0 ? { ...cut, src: V0_SOURCE_ID } : { ...cut }
  ));
  for (const cut of cuts) {
    if (!sources.some((source) => source.id === cut.src)) {
      warnings.push(`cuts[].src "${cut.src}" が sources に見つからない — 参照整合は edit-lint の責務、書き出しは続行`);
    }
  }
  const gapAware = needsGapAwareCutTimeline(cuts);
  const placements = gapAware
    ? resolveCutSegments(cuts).map(({ start, end }) => ({ start, duration: end - start }))
    : computeCutTimelineOffsets(cuts);
  const audio = edit.audio ?? {};
  return {
    version,
    projectRoot,
    projectName: basename(projectRoot),
    output: edit.output,
    sources,
    cuts,
    placements,
    gapAware,
    layers: edit.layers ?? [],
    narration: audio.narration ?? [],
    bgm: audio.bgm ?? null,
    sfx: audio.sfx ?? [],
    master: audio.master ?? null,
    beats: edit.beats ?? [],
    emphasisWords: edit.emphasis_words ?? [],
    direction: edit.direction ?? null,
    warnings,
  };
}

// カット末尾・layers・sfx から合成尺を出す（render-cut/src/content-duration.mjs 相当の縮約。
// narration / bgm は probe 結果があれば呼び出し側が拡張する）。
export function baseTimelineDuration(model) {
  let end = 0;
  for (const placement of model.placements) {
    end = Math.max(end, placement.start + placement.duration);
  }
  for (const layer of model.layers) {
    if (typeof layer.t === "number" && typeof layer.duration === "number") {
      end = Math.max(end, layer.t + layer.duration);
    }
  }
  for (const item of model.sfx ?? []) {
    if (typeof item.t !== "number") continue;
    const inPoint = typeof item.in === "number" ? item.in : 0;
    if (typeof item.out === "number" && item.out > inPoint) {
      end = Math.max(end, item.t + (item.out - inPoint));
    }
  }
  return end;
}
