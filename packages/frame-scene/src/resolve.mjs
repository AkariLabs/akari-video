import { createHash } from 'node:crypto';

const WORLD = { preset: 'white', show: true, light: 'soft', shadows: true, exposure: 1, rot: 0, floor: 'world' };
const JOINTS = new Set('hips spine chest neck head leftUpperArm leftLowerArm leftHand rightUpperArm rightLowerArm rightHand leftUpperLeg leftLowerLeg leftFoot rightUpperLeg rightLowerLeg rightFoot'.split(' '));
const rad = d => d * Math.PI / 180;
const deg = r => r * 180 / Math.PI;
const vector = n => Array.isArray(n) ? n : [n, n, n];
const aspectNumber = value => {
  if (typeof value === 'number' && value > 0) return value;
  const parts = String(value ?? '16:9').split(':').map(Number);
  return parts[0] > 0 && parts[1] > 0 ? parts[0] / parts[1] : 16 / 9;
};
export function focalFov(focalMm = 35, aspect = '16:9') {
  const a = aspectNumber(aspect);
  const vertical = deg(2 * Math.atan(0.5 * 35 / Math.max(a, 1) / focalMm));
  return { vertical, horizontal: deg(2 * Math.atan(Math.tan(rad(vertical) / 2) * a)) };
}
function sizeFor(o, info, warnings) {
  if (o.kind === 'shape' && Array.isArray(o.size)) return o.size.map(Number);
  if (Array.isArray(info?.size_cm)) return info.size_cm;
  warnings.push({ code: 'asset.size.unknown', path: `/objects/${o.id}`, message: `size_cm unknown for ${o.id}` });
  return [0, 0, 0];
}
function objectCenter(o) {
  return [o.at[0], o.at[1] + (o.ground === 'center' ? 0 : o.size_cm[1] / 2), o.at[2]];
}
function targetFor(camera, objects) {
  const look = camera.look;
  if (Array.isArray(look)) return look;
  if (typeof look === 'string') {
    const o = objects.find(v => v.id === look);
    if (o) return objectCenter(o).map((v, i) => v + (camera.offset?.[i] ?? 0));
  }
  const first = objects[0];
  return first ? objectCenter(first) : [0, 100, 0];
}
function cameraResolve(raw, objects) {
  const result = { pos: [0, 140, 300], focal_mm: 35, roll: 0, ...raw };
  result.look = targetFor(result, objects);
  const fov = focalFov(result.focal_mm, result.aspect);
  return { ...result, vFov: fov.vertical, hFov: fov.horizontal };
}
export function resolveScene(doc, sceneId, opts = {}) {
  const scene = doc.scenes?.find(s => s.id === sceneId);
  if (!scene) throw new RangeError(`unknown scene ${sceneId}`);
  const warnings = [];
  const aspect = doc.aspect ?? opts.outputAspect ?? '16:9';
  const rawObjects = (doc.objects ?? []).map(o => ({ ...o, ...(scene.set?.[o.id] ?? {}) }));
  const objects = rawObjects.map(o => {
    const info = opts.assetInfo?.(o.asset ?? o.src);
    const size_cm = sizeFor(o, info, warnings);
    const scale = o.h !== undefined && size_cm[1] > 0 ? o.h / size_cm[1] : vector(o.scale ?? 1);
    const scaled = size_cm.map((n, i) => n * (Array.isArray(scale) ? scale[i] : scale));
    let pose = o.kind === 'human' ? (typeof o.pose === 'string' ? { base: o.pose } : { base: 'stand', ...o.pose }) : undefined;
    if (pose && Array.isArray(info?.poses) && !info.poses.includes(pose.base)) {
      warnings.push({ code: 'pose.base.unknown', path: `/objects/${o.id}/pose`, message: `undeclared pose ${pose.base}` });
      pose = { ...pose, base: 'stand' };
    }
    if (pose?.joints) pose = { ...pose, joints: Object.fromEntries(Object.entries(pose.joints).filter(([joint]) => JOINTS.has(joint))) };
    return { ...o, name: o.name ?? o.id, size_cm: scaled, scale: Array.isArray(scale) ? scale : [scale, scale, scale], at: o.at ?? [0, 0, 0], ground: info?.ground ?? 'bottom-center', front: info?.front ?? '+Z', hidden: o.hidden ?? false, pose };
  });
  const byId = new Map(objects.map(o => [o.id, o]));
  const grounding = new Set();
  const place = o => {
    if (grounding.has(o.id)) return;
    grounding.add(o.id);
    if (o.at.length === 2) {
      const support = o.on ? byId.get(o.on) : undefined;
      if (support && support !== o) place(support);
      const top = support ? support.at[1] + (support.ground === 'center' ? support.size_cm[1] / 2 : support.size_cm[1]) : 0;
      o.at = [o.at[0], top, o.at[1]];
    }
    grounding.delete(o.id);
  };
  objects.forEach(place);
  const cameraRaw = { ...scene.camera, aspect };
  const camera = cameraResolve(cameraRaw, objects);
  for (const o of objects) {
    if (typeof o.facing === 'number') o.ry = o.facing - ({ '+Z': 0, '-Z': 180, '+X': 90, '-X': -90 }[o.front] ?? 0);
    else if (typeof o.facing === 'string') {
      const target = o.facing === 'camera' ? camera.pos : byId.get(o.facing)?.at;
      if (target) {
        const front = { '+Z': 0, '-Z': 180, '+X': 90, '-X': -90 }[o.front] ?? 0;
        o.ry = deg(Math.atan2(target[0] - o.at[0], target[2] - o.at[2])) - front;
      }
    }
    o.rot = o.rot ?? [0, o.ry ?? 0, 0];
    delete o.ry;
    delete o.facing;
    delete o.on;
  }
  const cameraTo = scene.camera_to ? cameraResolve({ ...scene.camera, ...scene.camera_to, aspect }, objects) : undefined;
  return { schema: 'akari.frame-scene.resolved', version: 0, aspect, world: { ...WORLD, ...doc.world, ...scene.world }, objects, scene: { id: scene.id, note: scene.note, camera, camera_to: cameraTo, ease: scene.ease ?? 'inOut', annotations: scene.annotations ?? [] }, warnings };
}
const lerp = (a, b, t) => a + (b - a) * t;
export function cameraAt(resolved, u) {
  if (u < 0 || u > 1) throw new RangeError('u must be 0..1');
  const a = resolved.scene.camera, b = resolved.scene.camera_to ?? a;
  const ease = resolved.scene.ease;
  const t = ease === 'in' ? u * u : ease === 'out' ? 1 - (1 - u) ** 2 : ease === 'linear' ? u : u * u * (3 - 2 * u);
  const result = { ...a };
  for (const key of ['pos', 'look']) result[key] = a[key].map((n, i) => lerp(n, b[key][i], t));
  for (const key of ['focal_mm', 'roll']) result[key] = lerp(a[key], b[key], t);
  const fov = focalFov(result.focal_mm, resolved.aspect);
  result.vFov = fov.vertical; result.hFov = fov.horizontal;
  return result;
}
const ROUNDED_VECTORS = new Set(['at', 'pos', 'look', 'offset', 'size_cm', 'size', 'rot']);
const ROUNDED_SCALARS = new Set(['h', 'w', 'ry', 'roll', 'vFov', 'hFov']);
function normalize(value, key = '', path = []) {
  if (Array.isArray(value)) return value.map(v => normalize(v, key, [...path, key]));
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).filter(k => value[k] !== undefined && k !== 'warnings').sort().map(k => [k, normalize(value[k], k, [...path, key])]));
  if (typeof value === 'number' && !path.includes('annotations') && (ROUNDED_VECTORS.has(key) || ROUNDED_SCALARS.has(key))) return Number(value.toFixed(2));
  return value;
}
export function normalizedResolved(resolved) { return normalize(resolved); }
export function resolvedHash(resolved) { return createHash('sha256').update(JSON.stringify(normalizedResolved(resolved))).digest('hex'); }
