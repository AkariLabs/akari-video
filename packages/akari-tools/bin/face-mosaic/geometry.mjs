const EPSILON = 1e-9;
const FOREHEAD_STEPS = 12;
const RESAMPLED_POINTS = 32;

function finitePoint(point) {
  return Array.isArray(point) && point.length === 2
    && Number.isFinite(Number(point[0])) && Number.isFinite(Number(point[1]));
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function distance(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

/** Perimeter-resample a closed polygon to a stable number of points for pointwise smoothing. */
export function resampleClosedPolygon(points, count = RESAMPLED_POINTS) {
  const ring = points.filter(finitePoint).map(([x, y]) => [Number(x), Number(y)]);
  if (ring.length > 1 && distance(ring[0], ring[ring.length - 1]) <= EPSILON) ring.pop();
  if (ring.length < 3 || count < 3) return [];
  const lengths = ring.map((point, index) => distance(point, ring[(index + 1) % ring.length]));
  const perimeter = lengths.reduce((sum, value) => sum + value, 0);
  if (!(perimeter > EPSILON)) return [];
  const result = [];
  let edge = 0;
  let edgeStartDistance = 0;
  for (let index = 0; index < count; index += 1) {
    const target = perimeter * index / count;
    while (edge < ring.length - 1 && edgeStartDistance + lengths[edge] < target) {
      edgeStartDistance += lengths[edge];
      edge += 1;
    }
    const from = ring[edge];
    const to = ring[(edge + 1) % ring.length];
    const ratio = lengths[edge] <= EPSILON ? 0 : (target - edgeStartDistance) / lengths[edge];
    result.push([from[0] + (to[0] - from[0]) * ratio, from[1] + (to[1] - from[1]) * ratio]);
  }
  result.push([...result[0]]);
  return result;
}

/**
 * Close Vision's jaw-only faceContour with a deterministic forehead arc.
 * The quadratic control point is solved so its midpoint lands on `topY`; eyes determine topY,
 * while the face bbox provides a stable fallback. Returned points are normalized and closed.
 */
export function completeFacePolygon(detection, { foreheadSteps = FOREHEAD_STEPS, outputPoints = RESAMPLED_POINTS } = {}) {
  const contour = detection?.landmarks?.face_contour;
  const box = detection?.box;
  if (!Array.isArray(contour) || contour.length < 3 || !contour.every(finitePoint)) return [];
  if (!Array.isArray(box) || box.length !== 4 || !box.every((value) => Number.isFinite(Number(value)))) return [];

  const [boxX, boxY, boxW, boxH] = box.map(Number);
  const first = contour[0].map(Number);
  const last = contour[contour.length - 1].map(Number);
  const eyePoints = [
    ...(Array.isArray(detection.landmarks.left_eye) ? detection.landmarks.left_eye : []),
    ...(Array.isArray(detection.landmarks.right_eye) ? detection.landmarks.right_eye : []),
  ].filter(finitePoint);
  const eyebrowPoints = [
    ...(Array.isArray(detection.landmarks.left_eyebrow) ? detection.landmarks.left_eyebrow : []),
    ...(Array.isArray(detection.landmarks.right_eyebrow) ? detection.landmarks.right_eyebrow : []),
  ].filter(finitePoint);
  const eyeY = eyePoints.length > 0 ? mean(eyePoints.map((point) => Number(point[1]))) : boxY + boxH * 0.38;
  const browY = eyebrowPoints.length > 0 ? mean(eyebrowPoints.map((point) => Number(point[1]))) : null;
  const landmarkTopY = browY === null ? eyeY - boxH * 0.3 : browY - boxH * 0.18;
  const desiredTopY = clamp(Math.min(boxY + boxH * 0.08, landmarkTopY), 0, 1);
  const controlX = clamp(boxX + boxW / 2, 0, 1);
  // Quadratic Bezier at u=.5: .25*last + .5*control + .25*first = desiredTop.
  const controlY = clamp(2 * desiredTopY - 0.5 * (last[1] + first[1]), -0.5, 1);
  const arc = [];
  for (let index = 1; index <= foreheadSteps; index += 1) {
    const u = index / (foreheadSteps + 1);
    const inv = 1 - u;
    arc.push([
      clamp(inv * inv * last[0] + 2 * inv * u * controlX + u * u * first[0], 0, 1),
      clamp(inv * inv * last[1] + 2 * inv * u * controlY + u * u * first[1], 0, 1),
    ]);
  }
  return resampleClosedPolygon([...contour.map(([x, y]) => [Number(x), Number(y)]), ...arc], outputPoints);
}

export function polygonBounds(points) {
  const ring = points.filter(finitePoint);
  if (ring.length === 0) return null;
  const xs = ring.map((point) => Number(point[0]));
  const ys = ring.map((point) => Number(point[1]));
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return {
    x: minX,
    y: minY,
    w: maxX - minX,
    h: maxY - minY,
    cx: (minX + maxX) / 2,
    cy: (minY + maxY) / 2,
    side: Math.max(maxX - minX, maxY - minY),
  };
}

export function interpolatePolygon(a, b, ratio) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return a ?? b ?? [];
  const u = clamp(ratio, 0, 1);
  return a.map((point, index) => [
    point[0] + (b[index][0] - point[0]) * u,
    point[1] + (b[index][1] - point[1]) * u,
  ]);
}

export const FACE_GEOMETRY_DEFAULTS = { foreheadSteps: FOREHEAD_STEPS, outputPoints: RESAMPLED_POINTS };
