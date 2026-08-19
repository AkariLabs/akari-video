import { freezeDurationSeconds } from "./cut-freeze.mjs";

export function cutSpeed(cut) {
  const value = cut?.speed;
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 1;
}

// docs/contract-2026-07-22-render-basics.md #7 (cuts[].freeze). The frozen hold is *extra*
// time, not a truncation of content, so it grows the cut's own segment duration. Every
// downstream consumer of segmentDuration (predictedDuration, xfade offsets in
// computeCutTimelineOffsets, gap-aware placement in resolveCutSegments/computeVideoRuns)
// inherits the extension from this single spot. packages/edit-lint/src/cut-timeline.mjs has a
// lower-layer copy of this duration logic; update both implementations whenever this changes.
export function segmentDuration(cut) {
  return (cut.out - cut.in) / cutSpeed(cut) + freezeDurationSeconds(cut?.freeze);
}

const EPSILON = 1e-6;

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
  let cursor = 0;
  for (const cut of cuts) {
    const track = Number.isInteger(cut.track) && cut.track >= 0 ? cut.track : 0;
    if (track !== 0) return true;
    const explicitAt = typeof cut.at === "number" && Number.isFinite(cut.at) && cut.at >= 0;
    const start = explicitAt ? cut.at : cursor;
    if (Math.abs(start - cursor) > EPSILON) return true;
    const transitionDuration = typeof cut.transition_out?.duration === "number"
      && Number.isFinite(cut.transition_out.duration) && cut.transition_out.duration > 0
      ? cut.transition_out.duration : 0;
    cursor = start + segmentDuration(cut) - transitionDuration;
  }
  return false;
}

export function computeVideoRuns(segments, outputDuration) {
  const boundarySet = new Set([0, outputDuration]);
  for (const segment of segments) {
    boundarySet.add(segment.start);
    boundarySet.add(segment.end);
  }
  const boundaries = [...boundarySet].sort((a, b) => a - b);
  const pieces = [];
  for (let index = 0; index < boundaries.length - 1; index += 1) {
    const start = boundaries[index];
    const end = boundaries[index + 1];
    if (end - start <= EPSILON) continue;
    const midpoint = (start + end) / 2;
    let winner = null;
    for (const segment of segments) {
      if (
        segment.start <= midpoint
        && segment.end > midpoint
        && (!winner || segment.track > winner.track)
      ) {
        winner = segment;
      }
    }
    pieces.push({ start, end, winner });
  }
  const runs = [];
  for (const piece of pieces) {
    const last = runs[runs.length - 1];
    const sameWinner = last
      && ((last.winner === null && piece.winner === null)
        || (last.winner && piece.winner && last.winner.index === piece.winner.index));
    if (sameWinner && Math.abs(last.end - piece.start) <= EPSILON) {
      last.end = piece.end;
    } else {
      runs.push({ ...piece });
    }
  }
  return runs.map((run) => {
    if (!run.winner) return { kind: "gap", outStart: run.start, outEnd: run.end };
    const speed = cutSpeed(run.winner.cut);
    const srcIn = run.winner.cut.in + (run.start - run.winner.start) * speed;
    const srcOut = run.winner.cut.in + (run.end - run.winner.start) * speed;
    return { kind: "src", outStart: run.start, outEnd: run.end, srcIn, srcOut, cut: run.winner.cut };
  });
}

// cuts[] の各カットについて、合成後タイムライン上の開始位置と尺を返す。
// xfade の重複時間と speed による尺の伸縮は plan.mjs のフィルタグラフと同じ式で扱う。
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
