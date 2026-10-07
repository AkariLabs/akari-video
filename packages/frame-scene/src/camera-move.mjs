export const MOVE_THRESHOLDS = Object.freeze({ translation_cm: 1, angle_deg: 1, distance_cm: 1, orbit_deg: 1 });
const delta = (a, b) => b.map((n, i) => n - a[i]);
const length = a => Math.hypot(...a);
const norm = a => { const n = length(a); return n ? a.map(v => v / n) : [0, 0, 0]; };

export function classifyMove(A, B) {
  const a = A.scene?.camera ?? A, b = B.scene?.camera ?? B;
  const av = delta(a.pos, a.look), bv = delta(b.pos, b.look);
  const motion = delta(a.pos, b.pos);
  const candidates = [];
  const add = (name, strength) => { if (strength >= 1) candidates.push({ name, strength }); };
  const distance = length(av) - length(bv);
  add(distance >= 0 ? 'push-in' : 'pull-out', Math.abs(distance) / MOVE_THRESHOLDS.distance_cm);
  const yawA = Math.atan2(av[0], av[2]), yawB = Math.atan2(bv[0], bv[2]);
  let yaw = (yawB - yawA) * 180 / Math.PI;
  while (yaw > 180) yaw -= 360; while (yaw < -180) yaw += 360;
  const targetMotion = length(delta(a.look, b.look));
  const orbit = targetMotion < MOVE_THRESHOLDS.translation_cm && length(motion) >= MOVE_THRESHOLDS.translation_cm;
  add(orbit ? (yaw > 0 ? 'orbit-right' : 'orbit-left') : (yaw < 0 ? 'pan-right' : 'pan-left'), Math.abs(yaw) / (orbit ? MOVE_THRESHOLDS.orbit_deg : MOVE_THRESHOLDS.angle_deg));
  const pitchA = Math.asin(norm(av)[1]), pitchB = Math.asin(norm(bv)[1]);
  const pitch = (pitchB - pitchA) * 180 / Math.PI;
  add(pitch >= 0 ? 'tilt-up' : 'tilt-down', Math.abs(pitch) / MOVE_THRESHOLDS.angle_deg);
  candidates.sort((x, y) => y.strength - x.strength || x.name.localeCompare(y.name));
  return { move: candidates[0]?.name ?? 'static', also: candidates.slice(1).map(c => c.name) };
}
