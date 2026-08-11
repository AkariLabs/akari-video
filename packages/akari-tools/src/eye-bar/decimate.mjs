// decimate.mjs — キーフレーム間引き（決定論・引数固定）。points は出力タイムライン秒 t 昇順の
// { t, x, y, rotate, scale, boundary? } の配列（boundary は「欠測ホールド/縮小の境界点なので
// 間引かず必ず残す」フラグ — build-layer.mjs が付ける）。どちらの方式でも points[0] /
// points[last] / boundary 点は必ず残す。

const EPSILON = 1e-9;

function alwaysKeep(point) {
  return Boolean(point?.boundary);
}

/**
 * 等間隔間引き: 直前に残した点から intervalSeconds 以上離れたら残す。
 */
export function decimateByInterval(points, intervalSeconds) {
  if (points.length <= 2) return points.slice();
  const interval = Math.max(EPSILON, intervalSeconds);
  const kept = [points[0]];
  let lastKeptT = points[0].t;
  for (let i = 1; i < points.length - 1; i += 1) {
    const point = points[i];
    if (alwaysKeep(point) || point.t - lastKeptT >= interval) {
      kept.push(point);
      lastKeptT = point.t;
    }
  }
  const last = points[points.length - 1];
  if (kept[kept.length - 1].t < last.t - EPSILON) kept.push(last);
  return kept;
}

/**
 * 変化量閾値間引き: 直前に残した点から位置（px）・角度（度）・scale（比率）のいずれかが
 * 閾値を超えて変化したら残す。
 */
export function decimateByThreshold(points, { posPx = 4, angleDeg = 2, scaleRatio = 0.03 } = {}) {
  if (points.length <= 2) return points.slice();
  const kept = [points[0]];
  let last = points[0];
  for (let i = 1; i < points.length - 1; i += 1) {
    const point = points[i];
    const dPos = Math.hypot(point.x - last.x, point.y - last.y);
    const dAngle = Math.abs(point.rotate - last.rotate);
    const dScale = last.scale > 0 ? Math.abs(point.scale - last.scale) / last.scale : 0;
    if (alwaysKeep(point) || dPos >= posPx || dAngle >= angleDeg || dScale >= scaleRatio) {
      kept.push(point);
      last = point;
    }
  }
  const finalPoint = points[points.length - 1];
  if (kept[kept.length - 1].t < finalPoint.t - EPSILON) kept.push(finalPoint);
  return kept;
}

export function decimatePoints(points, options) {
  const mode = options?.mode ?? "interval";
  if (mode === "threshold") return decimateByThreshold(points, options?.threshold);
  return decimateByInterval(points, options?.intervalSeconds ?? 0.2);
}
