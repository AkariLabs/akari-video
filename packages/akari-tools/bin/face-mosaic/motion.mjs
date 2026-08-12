import { completeFacePolygon, interpolatePolygon, polygonBounds } from "./geometry.mjs";

export const MOTION_DEFAULTS = {
  smoothWindow: 9,
  minMovePx: 14,
  minScaleDelta: 0.06,
  forceInterval: 1.5,
};

function round(value, digits = 6) {
  return Number(value.toFixed(digits));
}

function geometryOf(point) {
  const bounds = polygonBounds(point.polygon);
  return { ...point, ...bounds };
}

/** Extract one deterministic face index and split at every missing detection. */
export function extractVisibleSegments(track, { faceIndex = 0 } = {}) {
  if (track?.kind !== "face-landmarks" || !Array.isArray(track.samples)) return [];
  const segments = [];
  let current = [];
  for (const sample of track.samples) {
    const detections = Array.isArray(sample?.detections) ? sample.detections : [];
    const sorted = detections.slice().sort((a, b) => {
      const ac = Number(a?.box?.[0] ?? 0) + Number(a?.box?.[2] ?? 0) / 2;
      const bc = Number(b?.box?.[0] ?? 0) + Number(b?.box?.[2] ?? 0) / 2;
      return ac - bc;
    });
    const polygon = completeFacePolygon(sorted[faceIndex]);
    if (!Number.isFinite(Number(sample?.t)) || polygon.length === 0) {
      if (current.length > 0) segments.push(current);
      current = [];
      continue;
    }
    current.push(geometryOf({ t: Number(sample.t), polygon }));
  }
  if (current.length > 0) segments.push(current);
  return segments;
}

/** Centered moving average, confined to one detection-contiguous segment. */
export function smoothSegment(points, window = MOTION_DEFAULTS.smoothWindow) {
  const radius = Math.floor(Math.max(1, Math.round(window)) / 2);
  return points.map((point, index) => {
    const from = Math.max(0, index - radius);
    const to = Math.min(points.length, index + radius + 1);
    const slice = points.slice(from, to);
    const polygon = point.polygon.map((_, pointIndex) => [
      slice.reduce((sum, item) => sum + item.polygon[pointIndex][0], 0) / slice.length,
      slice.reduce((sum, item) => sum + item.polygon[pointIndex][1], 0) / slice.length,
    ]);
    return geometryOf({ t: point.t, polygon });
  });
}

/** Threshold decimation with forced refresh; the first and last point are always retained. */
export function decimateMotionPoints(points, {
  minMovePx = MOTION_DEFAULTS.minMovePx,
  minScaleDelta = MOTION_DEFAULTS.minScaleDelta,
  forceInterval = MOTION_DEFAULTS.forceInterval,
  sourceWidth = 1,
  sourceHeight = 1,
} = {}) {
  if (points.length <= 2) return points.slice();
  const kept = [points[0]];
  for (const point of points.slice(1, -1)) {
    const last = kept[kept.length - 1];
    const move = Math.hypot((point.cx - last.cx) * sourceWidth, (point.cy - last.cy) * sourceHeight);
    const scaleDelta = last.side > 0 ? Math.abs(point.side - last.side) / last.side : Infinity;
    if (move >= minMovePx || scaleDelta >= minScaleDelta || point.t - last.t >= forceInterval) kept.push(point);
  }
  const end = points[points.length - 1];
  if (kept[kept.length - 1] !== end) kept.push(end);
  return kept;
}

export function samplePointAt(points, t) {
  if (points.length === 0) return null;
  if (t <= points[0].t) return points[0];
  if (t >= points[points.length - 1].t) return points[points.length - 1];
  let hi = 1;
  while (hi < points.length && points[hi].t < t) hi += 1;
  const a = points[hi - 1];
  const b = points[hi];
  const ratio = b.t === a.t ? 0 : (t - a.t) / (b.t - a.t);
  return geometryOf({ t, polygon: interpolatePolygon(a.polygon, b.polygon, ratio) });
}

export function sliceSegment(points, start, end) {
  if (!(end > start) || points.length === 0) return [];
  const result = [samplePointAt(points, start)];
  for (const point of points) if (point.t > start && point.t < end) result.push(point);
  result.push(samplePointAt(points, end));
  return result.filter(Boolean).map((point) => ({ ...point, t: round(point.t) }));
}

export function interpolateScalar(points, t, field) {
  if (points.length === 0) return 0;
  if (t <= points[0].t) return points[0][field];
  if (t >= points[points.length - 1].t) return points[points.length - 1][field];
  let hi = 1;
  while (hi < points.length && points[hi].t < t) hi += 1;
  const a = points[hi - 1];
  const b = points[hi];
  const ratio = b.t === a.t ? 0 : (t - a.t) / (b.t - a.t);
  return a[field] + (b[field] - a[field]) * ratio;
}
