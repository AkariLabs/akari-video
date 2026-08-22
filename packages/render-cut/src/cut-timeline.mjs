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

// P0 2026-08-21 render-path-unification (MAJOR-3 fix, Codex review): a boundary's *declared*
// transition_out.duration is only trustworthy for placing the NEXT cut when that cut has no
// explicit `at` (today's implicit, cursor-based placement) or when its explicit `at` exactly
// reproduces the position that duration implies. When the following cut instead declares an
// `at` that lands strictly between "no overlap at all" and "the declared duration's own
// overlap" -- i.e. a real but shorter-than-declared overlap -- the declaration and the timeline
// disagree about how much blend time is actually available. Before this fix, that disagreement
// routed the WHOLE cuts array to the gap-aware engine (buildGapAwareMultiSourceCutCommand in
// plan.mjs), which has no concept of transition_out at all: it silently produced a zero-frame
// hard cut, permanently dropped the shortfall's worth of the incoming cut's own [in,out) content
// (its winner-take-all compositor only ever plays each cut from its own declared `at` onward),
// and let both cuts' full, untrimmed audio overlap audibly across the boundary (verified via a
// real render: declared 1s dissolve / 0.5s actual overlap produced an instant red-to-blue cut
// with zero blended frames anywhere, cut2's first 0.5s of source silently skipped, and both
// clips' audio summed across [2.5s,3.0s) -- see packages/render-cut/test/cut-timeline.test.mjs).
// This derives, from the two adjacent cuts' own declared fields only (segment duration from
// in/out/speed/freeze, position from at) -- no positional guessing, no engine-selection change --
// the duration that can actually be rendered at each boundary: clamped down to the real overlap
// only when explicit `at` implies strictly less than declared, left untouched in every other case
// (implicit `at`, an exact match, more overlap than declared, or no overlap/a genuine gap all
// keep exactly today's routing/behavior, including still correctly routing to the gap-aware
// engine when appropriate). packages/edit-lint/src/cut-timeline.mjs has a lower-layer copy of
// this same logic (isDeclaredTransitionOverlap in edit-lint.mjs); keep both in sync.
export function effectiveTransitionDurations(cuts) {
  if (!Array.isArray(cuts) || cuts.length === 0) return [];
  const effective = [];
  let start = 0;
  for (let index = 0; index < cuts.length; index += 1) {
    const cut = cuts[index];
    const explicitAt = typeof cut.at === "number" && Number.isFinite(cut.at) && cut.at >= 0;
    if (explicitAt) start = cut.at;
    const end = start + segmentDuration(cut);
    const declared = typeof cut.transition_out?.duration === "number"
      && Number.isFinite(cut.transition_out.duration) && cut.transition_out.duration > 0
      ? cut.transition_out.duration : 0;
    let duration = declared;
    const next = cuts[index + 1];
    if (declared > 0 && next) {
      const nextExplicitAt = typeof next.at === "number" && Number.isFinite(next.at) && next.at >= 0;
      if (nextExplicitAt) {
        const availableOverlap = end - next.at;
        if (availableOverlap > EPSILON && availableOverlap < declared - EPSILON) {
          duration = availableOverlap;
        }
      }
    }
    effective.push(duration);
    start = end - duration;
  }
  return effective;
}

export function needsGapAwareCutTimeline(cuts) {
  if (!Array.isArray(cuts) || cuts.length === 0) return false;
  const durations = effectiveTransitionDurations(cuts);
  let cursor = 0;
  for (let index = 0; index < cuts.length; index += 1) {
    const cut = cuts[index];
    const track = Number.isInteger(cut.track) && cut.track >= 0 ? cut.track : 0;
    if (track !== 0) return true;
    const explicitAt = typeof cut.at === "number" && Number.isFinite(cut.at) && cut.at >= 0;
    const start = explicitAt ? cut.at : cursor;
    if (Math.abs(start - cursor) > EPSILON) return true;
    cursor = start + segmentDuration(cut) - durations[index];
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
  const durations = effectiveTransitionDurations(cuts);
  const offsets = [];
  let start = 0;
  let duration = segmentDuration(cuts[0]);
  offsets.push({ start, duration });
  for (let index = 1; index < cuts.length; index += 1) {
    start = start + duration - durations[index - 1];
    duration = segmentDuration(cuts[index]);
    offsets.push({ start, duration });
  }
  return offsets;
}
