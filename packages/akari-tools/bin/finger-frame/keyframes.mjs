// finger-frame: turns one (activation interval, hand samples) pair into the
// `layers[].keyframes[].perspective` points task.md §5/§6 describes -- corner ordering (with
// cross-sample temporal stability), degenerate-sample skipping, decimation to a fixed keyframe
// cadence (ffmpeg re-splits perspective into its own time windows regardless -- see
// packages/render-cut/src/layer-keyframes.mjs's PERSPECTIVE_SEGMENTS_PER_SECOND -- so emitting
// denser points than that buys no extra fidelity, only a bigger edit.json and more ffmpeg
// sub-layers), and the source-frame -> canvas-frame remap.
import { orderCornersFromPoints } from "./corners.mjs";

// Matches render-cut/src/layer-keyframes.mjs's own PERSPECTIVE_SEGMENTS_PER_SECOND default (not
// imported -- that constant is not exported, and this module's default is independently
// justifiable from the same reasoning: no point emitting keyframes denser than ffmpeg's own
// perspective time-window split will resample anyway).
export const DEFAULT_MAX_POINTS_PER_SEC = 4;

// handSamples: hand-metrics.mjs output (ascending t), NOT yet clipped to the interval.
// interval: { startT, endT } in the SAME (source) time axis as handSamples[].t.
// letterboxTransform: (sourcePoint) => canvasPoint (timeline-map.mjs's letterboxContainTransform).
// mapTimelineTime: (sourceT) => timelineT (timeline-map.mjs's mapSourceTimeToTimeline, pre-bound
//   to the specific cut/cutStart this interval was clipped against).
// Returns [{ t /* timeline seconds */, corners /* [TL,TR,BL,BR] canvas-normalized */ }, ...],
// length >= 2 whenever at least one usable sample exists in range (padded by holding the last
// usable corner set through to the interval's own end otherwise), or [] if NO sample in range had
// two fully-formed, non-degenerate hands (caller should drop the whole occurrence and warn).
export function buildCornerKeyframes(handSamples, interval, {
  letterboxTransform,
  mapTimelineTime,
  maxPointsPerSec = DEFAULT_MAX_POINTS_PER_SEC,
}) {
  const inRange = (handSamples ?? [])
    .filter((sample) => sample.t >= interval.startT && sample.t <= interval.endT);

  // Pass 1 (dense, source time): resolve corners for every usable sample, chaining
  // previousRing across samples (including across skipped/degenerate ones -- the chain continues
  // from the last GOOD ring, not from the immediately-preceding raw sample) so temporal-stability
  // matching isn't reset by a single noisy/degenerate frame in the middle of a real gesture.
  const dense = [];
  let previousRing = null;
  for (const sample of inRange) {
    if (!sample.left || !sample.right) continue;
    const points = [sample.left.thumb, sample.left.index, sample.right.thumb, sample.right.index];
    const { corners, ring } = orderCornersFromPoints(points, previousRing);
    if (!corners) continue; // (near-)degenerate quad -- treat like a missing detection, skip
    previousRing = ring;
    dense.push({ sourceT: sample.t, corners });
  }
  if (dense.length === 0) return [];

  // Pass 2 (decimate, timeline time): keep the first and last dense points unconditionally (they
  // anchor the interval's own visible boundary shape), and otherwise only keep a point once at
  // least 1/maxPointsPerSec timeline-seconds have elapsed since the last kept one.
  const minSpacing = maxPointsPerSec > 0 ? 1 / maxPointsPerSec : 0;
  const kept = [dense[0]];
  let lastKeptTimelineT = mapTimelineTime(dense[0].sourceT);
  for (let index = 1; index < dense.length - 1; index += 1) {
    const timelineT = mapTimelineTime(dense[index].sourceT);
    if (timelineT - lastKeptTimelineT >= minSpacing) {
      kept.push(dense[index]);
      lastKeptTimelineT = timelineT;
    }
  }
  if (dense.length > 1) kept.push(dense[dense.length - 1]);

  // Map to timeline time + canvas space, dropping any accidental exact-t duplicate produced by
  // decimation collapsing onto the same kept boundary point.
  const points = [];
  for (const point of kept) {
    const t = mapTimelineTime(point.sourceT);
    if (points.length && Math.abs(points[points.length - 1].t - t) < 1e-9) continue;
    points.push({ t, corners: point.corners.map((corner) => letterboxTransform(corner)) });
  }

  // layerItem.keyframes requires >= 2 points (#layerKeyframe). A single-sample activation (a very
  // brief open that only one hand-pose sample fell inside) would otherwise emit just one point --
  // hold that same corner set through to the interval's own mapped end instead of dropping the
  // occurrence entirely.
  if (points.length === 1) {
    const endTimelineT = mapTimelineTime(interval.endT);
    const t = endTimelineT - points[0].t > 1e-9 ? endTimelineT : points[0].t + 1e-3;
    points.push({ t, corners: points[0].corners });
  }
  return points;
}
