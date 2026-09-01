function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function isUsablePerspectiveShape(perspective) {
  if (!perspective || typeof perspective !== "object" || Array.isArray(perspective)) return false;
  const corners = perspective.corners;
  return Array.isArray(corners) && corners.length === 4
    && corners.every((corner) => Array.isArray(corner) && corner.length === 2
      && isFiniteNumber(corner[0]) && isFiniteNumber(corner[1]));
}

export function filterQuadCornersAt(layer, localT) {
  const points = Array.isArray(layer?.keyframes)
    ? layer.keyframes
      .filter((point) => point && typeof point === "object"
        && isFiniteNumber(point.t) && point.t >= 0
        && isUsablePerspectiveShape(point.perspective))
      .slice()
      .sort((a, b) => a.t - b.t)
    : [];

  if (points.length === 0) return layer?.perspective?.corners;
  if (points.length === 1) return points[0].perspective.corners;
  if (localT <= points[0].t) return points[0].perspective.corners;
  const last = points[points.length - 1];
  if (localT >= last.t) return last.perspective.corners;

  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index];
    const end = points[index + 1];
    if (localT < start.t || localT > end.t) continue;
    const span = end.t - start.t;
    if (!(span > 0)) return end.perspective.corners;
    const u = (localT - start.t) / span;
    // Region-filter v0 intentionally interpolates linearly. keyframes[].easing is ignored here.
    return start.perspective.corners.map((corner, cornerIndex) => [
      corner[0] + (end.perspective.corners[cornerIndex][0] - corner[0]) * u,
      corner[1] + (end.perspective.corners[cornerIndex][1] - corner[1]) * u,
    ]);
  }

  return last.perspective.corners;
}

export function rasterizeQuadMaskFrame(corners, maskWidth, maskHeight) {
  const width = Math.max(0, Math.trunc(maskWidth));
  const height = Math.max(0, Math.trunc(maskHeight));
  const frame = new Uint8Array(width * height);
  if (width === 0 || height === 0 || !Array.isArray(corners) || corners.length !== 4) return frame;

  // Input order is TL, TR, BL, BR. Scanline filling needs a circular polygon order.
  const circular = [corners[0], corners[1], corners[3], corners[2]].map((corner) => [
    Number(corner?.[0]) * width,
    Number(corner?.[1]) * height,
  ]);
  if (!circular.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y))) return frame;

  const xs = circular.map(([x]) => x);
  const ys = circular.map(([, y]) => y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const firstRow = Math.max(0, Math.ceil(minY - 0.5));
  const lastRowExclusive = Math.min(height, Math.ceil(maxY - 0.5));
  if (firstRow >= lastRowExclusive || maxX <= 0 || minX >= width) return frame;

  for (let y = firstRow; y < lastRowExclusive; y += 1) {
    const scanY = y + 0.5;
    const intersections = [];
    for (let edge = 0; edge < circular.length; edge += 1) {
      const [x1, y1] = circular[edge];
      const [x2, y2] = circular[(edge + 1) % circular.length];
      if ((y1 > scanY) === (y2 > scanY)) continue;
      intersections.push(x1 + ((scanY - y1) * (x2 - x1)) / (y2 - y1));
    }
    intersections.sort((a, b) => a - b);
    for (let pair = 0; pair + 1 < intersections.length; pair += 2) {
      const startX = Math.max(0, Math.ceil(intersections[pair] - 0.5));
      const endX = Math.min(width, Math.ceil(intersections[pair + 1] - 0.5));
      if (startX < endX) frame.fill(255, y * width + startX, y * width + endX);
    }
  }

  return frame;
}
