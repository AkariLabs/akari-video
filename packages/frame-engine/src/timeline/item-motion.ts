/** Item motion uses frame counts for spans and output-local seconds for evaluation. */
export const MOTION_IN_OUT_PRESETS = ['fade', 'slide-up', 'slide-down', 'slide-left', 'slide-right', 'scale', 'wipe'] as const;
export const MOTION_LOOP_PRESETS = ['pulse', 'float', 'spin'] as const;

export interface MotionV0 {
  in?: { preset: string; duration: number; ease?: string; amount?: number };
  out?: { preset: string; duration: number; ease?: string; amount?: number };
  loop?: { preset: string; period: number; ease?: string; amount?: number };
}

export interface MotionVisual {
  dx: number;
  dy: number;
  scale: number;
  rotate: number;
  opacity: number;
  reveal?: { x: number; y: number; w: number; h: number };
}

const inOutPresets: ReadonlySet<string> = new Set(MOTION_IN_OUT_PRESETS);
const loopPresets: ReadonlySet<string> = new Set(MOTION_LOOP_PRESETS);
const unit = (u: number): number => Math.max(0, Math.min(1, u));
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const identity = (): MotionVisual => ({ dx: 0, dy: 0, scale: 1, rotate: 0, opacity: 1 });

function bounce(u: number): number {
  const n = 7.5625;
  const d = 2.75;
  if (u < 1 / d) return n * u * u;
  if (u < 2 / d) return n * (u - 1.5 / d) ** 2 + 0.75;
  if (u < 2.5 / d) return n * (u - 2.25 / d) ** 2 + 0.9375;
  return n * (u - 2.625 / d) ** 2 + 0.984375;
}

/** Easing may overshoot; only opacity and reveal are clamped by their consumers. */
export function easeValue(name: string | undefined, u: number): number {
  u = unit(u);
  if (name === 'hold') return u < 1 ? 0 : 1;
  if (u === 0 || u === 1) return u;
  const polynomial = /^(in|out|in-out)-(quad|cubic|quart)$/.exec(name ?? '');
  if (polynomial) {
    const power = polynomial[2] === 'quad' ? 2 : polynomial[2] === 'cubic' ? 3 : 4;
    if (polynomial[1] === 'in') return u ** power;
    if (polynomial[1] === 'out') return 1 - (1 - u) ** power;
    return u < 0.5 ? (2 * u) ** power / 2 : 1 - (2 * (1 - u)) ** power / 2;
  }
  const back = 1.70158;
  switch (name) {
    case 'ease-in-out': return u < 0.5 ? 4 * u ** 3 : 1 - (-2 * u + 2) ** 3 / 2;
    case 'in-expo': return 2 ** (10 * u - 10);
    case 'out-expo': return 1 - 2 ** (-10 * u);
    case 'in-out-expo': return u < 0.5 ? 2 ** (20 * u - 10) / 2 : (2 - 2 ** (-20 * u + 10)) / 2;
    case 'in-back': return (back + 1) * u ** 3 - back * u ** 2;
    case 'out-back': return 1 + (back + 1) * (u - 1) ** 3 + back * (u - 1) ** 2;
    case 'in-out-back': {
      const c = back * 1.525;
      return u < 0.5
        ? (2 * u) ** 2 * ((c + 1) * 2 * u - c) / 2
        : ((2 * u - 2) ** 2 * ((c + 1) * (2 * u - 2) + c) + 2) / 2;
    }
    case 'out-bounce': return bounce(u);
    case 'out-elastic': return 2 ** (-10 * u) * Math.sin((10 * u - 0.75) * (2 * Math.PI / 3)) + 1;
  }
  const bezier = /^cubic-bezier\(\s*([^,]+),\s*([^,]+),\s*([^,]+),\s*([^,]+)\s*\)$/.exec(name ?? '');
  if (bezier) {
    const values = bezier.slice(1).map(value => value.trim() ? Number(value) : NaN);
    const [x1, y1, x2, y2] = values as [number, number, number, number];
    if (values.every(Number.isFinite) && x1 >= 0 && x1 <= 1 && x2 >= 0 && x2 <= 1) {
      const coordinate = (t: number, a: number, b: number): number =>
        3 * (1 - t) ** 2 * t * a + 3 * (1 - t) * t * t * b + t ** 3;
      let low = 0;
      let high = 1;
      // Solve x(t)=u, then evaluate y(t); bisection also handles flat endpoint tangents.
      for (let iteration = 0; iteration < 48; iteration += 1) {
        const t = (low + high) / 2;
        if (coordinate(t, x1, x2) < u) low = t;
        else high = t;
      }
      return coordinate((low + high) / 2, y1, y2);
    }
  }
  return u;
}

function compose(target: MotionVisual, effect: MotionVisual): void {
  target.dx += effect.dx;
  target.dy += effect.dy;
  target.scale *= effect.scale;
  target.rotate += effect.rotate;
  target.opacity *= effect.opacity;
  if (effect.reveal) {
    const a = target.reveal ?? { x: 0, y: 0, w: 1, h: 1 };
    const b = effect.reveal;
    const x = Math.max(a.x, b.x);
    const y = Math.max(a.y, b.y);
    target.reveal = { x, y, w: Math.max(0, Math.min(a.x + a.w, b.x + b.w) - x),
      h: Math.max(0, Math.min(a.y + a.h, b.y + b.h) - y) };
  }
}

/** A valid declaration holds its endpoint outside its span; absent/invalid declarations return null. */
export function motionVisualAt(
  motion: MotionV0 | null | undefined,
  localSeconds: number,
  itemDurationSeconds: number,
  fps: number
): MotionVisual | null {
  if (!motion || !finite(localSeconds) || !finite(itemDurationSeconds)
    || itemDurationSeconds <= 0 || !finite(fps) || fps <= 0) return null;
  const result = identity();
  let applied = false;
  for (const seat of ['in', 'out'] as const) {
    const entry = motion[seat];
    if (!entry || !inOutPresets.has(entry.preset) || !finite(entry.duration) || entry.duration <= 0) continue;
    const span = entry.duration / fps;
    if (!finite(span) || span <= 0) continue;
    applied = true;
    const progress = seat === 'in' ? localSeconds / span : 1 - (itemDurationSeconds - localSeconds) / span;
    const eased = easeValue(entry.ease, progress);
    const hidden = seat === 'in' ? 1 - eased : eased;
    const amount = finite(entry.amount) ? entry.amount : entry.preset === 'scale' ? 0.2 : 40;
    const effect = identity();
    switch (entry.preset) {
      case 'fade': effect.opacity = unit(1 - hidden); break;
      case 'slide-up': effect.dy = hidden * amount; break;
      case 'slide-down': effect.dy = -hidden * amount; break;
      case 'slide-left': effect.dx = hidden * amount; break;
      case 'slide-right': effect.dx = -hidden * amount; break;
      case 'scale': effect.scale = 1 - hidden * amount; break;
      case 'wipe': effect.reveal = { x: 0, y: 0, w: unit(1 - hidden), h: 1 }; break;
    }
    compose(result, effect);
  }
  const loop = motion.loop;
  if (loop && loopPresets.has(loop.preset) && finite(loop.period) && loop.period > 0) {
    const span = loop.period / fps;
    if (finite(span) && span > 0) {
      applied = true;
      const phase = easeValue(loop.ease, ((localSeconds % span + span) % span) / span);
      const amount = finite(loop.amount) ? loop.amount : loop.preset === 'pulse' ? 0.05 : loop.preset === 'float' ? 6 : 1;
      const effect = identity();
      if (loop.preset === 'pulse') effect.scale = 1 + amount * Math.sin(2 * Math.PI * phase);
      if (loop.preset === 'float') effect.dy = amount * Math.sin(2 * Math.PI * phase);
      if (loop.preset === 'spin') effect.rotate = 360 * phase * amount;
      compose(result, effect);
    }
  }
  return applied ? result : null;
}
