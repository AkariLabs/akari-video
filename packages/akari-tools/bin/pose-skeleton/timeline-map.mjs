import {
  computeCutTimelineOffsets,
  computeVideoRuns,
  cutSpeed,
  needsGapAwareCutTimeline,
  resolveCutSegments,
} from "../../../render-cut/src/cut-timeline.mjs";

const EPSILON = 1e-6;

function matches(cut, sourceId) {
  return sourceId === null || sourceId === undefined ? cut?.src === undefined : cut?.src === sourceId;
}

/** render-cut の cut-timeline を唯一の時間写像として使う。 */
export function sourceCutRuns(cuts, sourceId = null) {
  if (!Array.isArray(cuts) || cuts.length === 0) return [];
  if (!needsGapAwareCutTimeline(cuts)) {
    const offsets = computeCutTimelineOffsets(cuts);
    return cuts.flatMap((cut, index) => {
      if (!matches(cut, sourceId) || !offsets[index]) return [];
      const speed = cutSpeed(cut);
      return [{
        outStart: offsets[index].start,
        outEnd: offsets[index].start + offsets[index].duration,
        srcIn: cut.in,
        srcOut: cut.out,
        speed,
        cut,
      }];
    });
  }
  const segments = resolveCutSegments(cuts);
  const duration = segments.reduce((max, segment) => Math.max(max, segment.end), 0);
  return computeVideoRuns(segments, duration)
    .filter((run) => run.kind === "src" && matches(run.cut, sourceId))
    .map((run) => ({
      outStart: run.outStart,
      outEnd: run.outEnd,
      srcIn: run.srcIn,
      srcOut: run.srcOut,
      speed: cutSpeed(run.cut),
      cut: run.cut,
    }));
}

export function sourceTimeToTimeline(run, sourceT) {
  if (!run || sourceT < run.srcIn - EPSILON || sourceT > run.srcOut + EPSILON) return null;
  const clamped = Math.min(Math.max(sourceT, run.srcIn), run.srcOut);
  return run.outStart + (clamped - run.srcIn) / run.speed;
}
