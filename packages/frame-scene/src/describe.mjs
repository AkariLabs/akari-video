const dot = (a, b) => a.reduce((sum, n, i) => sum + n * b[i], 0);
const sub = (a, b) => a.map((n, i) => n - b[i]);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = a => { const n = Math.hypot(...a); return n ? a.map(v => v / n) : [0, 0, 0]; };
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const round = n => Number(n.toFixed(3));
// Row-major 4x4 matrices. JS Number arithmetic keeps the projection in f64.
const mul4 = (a, b) => Array.from({ length: 16 }, (_, k) => {
  const row = Math.floor(k / 4), col = k % 4;
  return Array.from({ length: 4 }, (_, i) => a[row * 4 + i] * b[i * 4 + col]).reduce((x, y) => x + y, 0);
});
const transform4 = (m, p) => Array.from({ length: 4 }, (_, row) =>
  m[row * 4] * p[0] + m[row * 4 + 1] * p[1] + m[row * 4 + 2] * p[2] + m[row * 4 + 3] * p[3]);

export function describe(resolved, { assetInfo } = {}) {
  const camera = resolved.scene.camera;
  const forward = unit(sub(camera.look, camera.pos));
  let right = unit(cross(forward, [0, 1, 0]));
  let up = unit(cross(right, forward));
  const roll = (camera.roll ?? 0) * Math.PI / 180;
  const r = right.map((n, i) => n * Math.cos(roll) + up[i] * Math.sin(roll));
  up = up.map((n, i) => n * Math.cos(roll) - right[i] * Math.sin(roll)); right = r;
  const aspect = typeof resolved.aspect === 'number' ? resolved.aspect : (() => { const [w, h] = String(resolved.aspect).split(':').map(Number); return w / h; })();
  const tanV = Math.tan(camera.vFov * Math.PI / 360);
  const tanH = tanV * aspect;
  const view = [
    ...right, -dot(right, camera.pos),
    ...up, -dot(up, camera.pos),
    ...forward, -dot(forward, camera.pos),
    0, 0, 0, 1
  ];
  const perspective = [
    1 / tanH, 0, 0, 0,
    0, 1 / tanV, 0, 0,
    0, 0, 1, 0,
    0, 0, 1, 0
  ];
  const viewProjection = mul4(perspective, view);
  const objects = [];
  for (const o of resolved.objects) {
    const info = assetInfo?.(o.asset ?? o.src);
    const size = o.size_cm?.some(Boolean) ? o.size_cm : info?.size_cm ?? [0, 0, 0];
    const center = [o.at[0], o.at[1] + (o.ground === 'center' ? 0 : size[1] / 2), o.at[2]];
    if (o.hidden || !size.some(Boolean)) { objects.push({ id: o.id, name: o.name, inFrame: false, croppedByFrame: false, box: null, distance_cm: Math.hypot(...sub(camera.pos, center)) }); continue; }
    const corners = [];
    for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) {
      const point = [center[0] + x * size[0] / 2, center[1] + y * size[1] / 2, center[2] + z * size[2] / 2];
      const clip = transform4(viewProjection, [...point, 1]);
      if (clip[3] > 0.01) corners.push([clip[0] / clip[3], clip[1] / clip[3]]);
    }
    if (!corners.length) { objects.push({ id: o.id, name: o.name, inFrame: false, croppedByFrame: false, box: null, distance_cm: Math.hypot(...sub(camera.pos, center)) }); continue; }
    const xs = corners.map(p => p[0]), ys = corners.map(p => p[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const a = clamp(x0, -1, 1), b = clamp(x1, -1, 1), c = clamp(y0, -1, 1), d = clamp(y1, -1, 1);
    const inFrame = a < b && c < d;
    objects.push({ id: o.id, name: o.name, inFrame, croppedByFrame: inFrame && (x0 < -1 || x1 > 1 || y0 < -1 || y1 > 1 || corners.length < 8), box: inFrame ? { x: round((a + 1) / 2), y: round((1 - d) / 2), w: round((b - a) / 2), h: round((d - c) / 2) } : null, distance_cm: round(Math.hypot(...sub(camera.pos, center))) });
  }
  const findings = [];
  for (const o of objects) {
    if (resolved.objects.find(source => source.id === o.id)?.hidden) continue;
    if (!o.inFrame) findings.push({ type: 'offscreen', objects: [o.id] });
    else if (o.croppedByFrame) findings.push({ type: 'clipped', objects: [o.id] });
  }
  for (let i = 0; i < objects.length; i++) for (let j = i + 1; j < objects.length; j++) {
    const a = objects[i].box, b = objects[j].box;
    if (!a || !b) continue;
    const area = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
    if (area > 0.5 * Math.min(a.w * a.h, b.w * b.h)) findings.push({ type: 'overlap', objects: [objects[i].id, objects[j].id] });
  }
  const annotations = [];
  for (const annotation of resolved.scene.annotations ?? []) {
    if (!annotation.anchor) { annotations.push(annotation); continue; }
    const target = objects.find(o => o.id === annotation.anchor.object);
    if (!target?.box) {
      findings.push({ type: 'anchor.unresolved', objects: [annotation.anchor.object], annotation: annotation.id });
      continue;
    }
    annotations.push({ ...annotation, anchorPoint: { x: round(target.box.x + target.box.w / 2), y: round(target.box.y + target.box.h / 2) } });
  }
  return { objects, annotations, findings };
}
