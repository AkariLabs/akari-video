import { cubicBezierAt } from './caption-motion.js';
import type { CaptionWordTileToken } from './caption-words.js';

export type AnimatorBasis = 'chars' | 'words' | 'lines' | 'segments';
export type AnimatorShape = 'ramp' | 'ramp-down' | 'triangle' | 'round' | 'smooth' | 'square';
export interface AnimatorParams { offset: number; start: number; end: number }
export interface ResolvedAnimator extends AnimatorParams {
  id: string;
  basis: Exclude<AnimatorBasis, 'segments'>;
  shape: AnimatorShape;
  randomize?: { seed: number };
  amount: { x: number; y: number; scale: number; rotate: number; opacity: number; letterSpacing: number; blur: number };
  ease: string;
}
export type AnimatorParamsById = Readonly<Record<string, AnimatorParams>>;
export interface CaptionAnimatorState {
  translateX: number;
  translateY: number;
  scale: number;
  rotateDeg: number;
  /** Add to 1, then clamp to [0, 1] in the consumer before multiplying item opacity. */
  opacityDelta: number;
  letterSpacing: number;
  blurPx: number;
}

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const number = (value: unknown, fallback = 0): number => finite(value) ? value : fallback;
const clamp = (value: number, min = 0, max = 1): number => Math.max(min, Math.min(max, value));
const shapes = new Set<string>(['ramp', 'ramp-down', 'triangle', 'round', 'smooth', 'square']);
const bases = new Set<string>(['chars', 'words', 'lines', 'segments']);

/** Normalize once per item. Unbounded amounts retain their finite values; only opacity has a schema range. */
export function normalizeAnimators(raw: unknown, warn?: (code: string, message: string) => void): ResolvedAnimator[] {
  if (!Array.isArray(raw)) return [];
  const resolved = new Map<string, ResolvedAnimator>();
  for (const value of raw) {
    if (!record(value) || typeof value.id !== 'string' || !value.id.trim()) continue;
    const shape = value.shape ?? 'ramp';
    const basis = value.basis ?? 'chars';
    if (typeof shape !== 'string' || !shapes.has(shape)) {
      warn?.('animator.unknown-shape', `animator ${value.id}: unknown shape ${String(shape)}; ignored`);
      continue;
    }
    if (typeof basis !== 'string' || !bases.has(basis)) {
      warn?.('animator.unknown-basis', `animator ${value.id}: unknown basis ${String(basis)}; ignored`);
      continue;
    }
    if (basis === 'segments') warn?.('animator.segments-fallback', `animator ${value.id}: segments uses words in v1`);
    if (resolved.has(value.id)) {
      warn?.('animator.duplicate-id', `animator ${value.id}: duplicate id; last declaration wins`);
      resolved.delete(value.id);
    }
    const amount = record(value.amount) ? value.amount : {};
    resolved.set(value.id, {
      id: value.id, basis: basis === 'segments' ? 'words' : basis as ResolvedAnimator['basis'],
      shape: shape as AnimatorShape,
      start: clamp(number(value.start)), end: clamp(number(value.end, 1)),
      offset: clamp(number(value.offset), -1, 1),
      ...(record(value.randomize) && finite(value.randomize.seed) && Number.isInteger(value.randomize.seed)
        ? { randomize: { seed: value.randomize.seed } } : {}),
      amount: {
        x: number(amount.x), y: number(amount.y), scale: number(amount.scale), rotate: number(amount.rotate),
        opacity: clamp(number(amount.opacity), -1, 1), letterSpacing: number(amount.letterSpacing), blur: number(amount.blur),
      },
      ease: typeof value.ease === 'string' ? value.ease : 'linear',
    });
  }
  return [...resolved.values()];
}

/** Easing for an incoming keyframe interval or selector weight; unknown names are linear. */
export function animatorEase(w: number, name = 'linear'): number {
  const v = clamp(number(w));
  if (v === 0 || v === 1) return v;
  switch (name) {
    case 'hold': return 0;
    case 'ease-in-out':
    case 'in-out-cubic': return v < 0.5 ? 4 * v ** 3 : 1 - (-2 * v + 2) ** 3 / 2;
    case 'in-quad': return v * v;
    case 'out-quad': return 1 - (1 - v) ** 2;
    case 'in-out-quad': return v < 0.5 ? 2 * v * v : 1 - (-2 * v + 2) ** 2 / 2;
    case 'in-cubic': return v ** 3;
    case 'out-cubic': return 1 - (1 - v) ** 3;
    case 'in-quart': return v ** 4;
    case 'out-quart': return 1 - (1 - v) ** 4;
    case 'in-out-quart': return v < 0.5 ? 8 * v ** 4 : 1 - (-2 * v + 2) ** 4 / 2;
    case 'in-expo': return 2 ** (10 * v - 10);
    case 'out-expo': return 1 - 2 ** (-10 * v);
    case 'in-out-expo': return v < 0.5 ? 2 ** (20 * v - 10) / 2 : (2 - 2 ** (-20 * v + 10)) / 2;
    case 'in-back': return 2.70158 * v ** 3 - 1.70158 * v ** 2;
    case 'out-back': return 1 + 2.70158 * (v - 1) ** 3 + 1.70158 * (v - 1) ** 2;
    case 'in-out-back': {
      const c = 1.70158 * 1.525;
      return v < 0.5 ? (2 * v) ** 2 * ((c + 1) * 2 * v - c) / 2
        : ((2 * v - 2) ** 2 * ((c + 1) * (2 * v - 2) + c) + 2) / 2;
    }
    case 'out-bounce': {
      if (v < 1 / 2.75) return 7.5625 * v * v;
      if (v < 2 / 2.75) return 7.5625 * (v - 1.5 / 2.75) ** 2 + 0.75;
      if (v < 2.5 / 2.75) return 7.5625 * (v - 2.25 / 2.75) ** 2 + 0.9375;
      return 7.5625 * (v - 2.625 / 2.75) ** 2 + 0.984375;
    }
    case 'out-elastic': return 2 ** (-10 * v) * Math.sin((10 * v - 0.75) * (2 * Math.PI / 3)) + 1;
    default: {
      const match = /^cubic-bezier\(([^)]+)\)$/i.exec(name);
      const curve = match?.[1]?.split(',').map(part => part.trim() === '' ? NaN : Number(part));
      if (!curve || curve.length !== 4 || !curve.every(Number.isFinite)) return v;
      const [x1, y1, x2, y2] = curve as [number, number, number, number];
      if (x1 < 0 || x1 > 1 || x2 < 0 || x2 > 1) return v;
      return cubicBezierAt(v, x1, y1, x2, y2);
    }
  }
}

function easingFor(point: Record<string, unknown>, id: string, leaf: keyof AnimatorParams): string {
  if (typeof point.easing === 'string') return point.easing;
  if (!record(point.easing)) return 'linear';
  for (const key of [`animator.${id}.${leaf}`, `animator.${id}`, 'animator']) {
    if (typeof point.easing[key] === 'string') return point.easing[key] as string;
  }
  return 'linear';
}

/** Input t is item-relative integer frames (not the seconds used by projected layer keyframes). */
export function animatorParamsAt(
  animators: readonly ResolvedAnimator[], keyframes: unknown, localSeconds: number, fps: number,
): AnimatorParamsById {
  const points = Array.isArray(keyframes) ? keyframes.filter((p): p is Record<string, unknown> =>
    record(p) && finite(p.t) && Number.isInteger(p.t) && p.t >= 0).slice().sort((a, b) => number(a.t) - number(b.t)) : [];
  const frame = number(localSeconds) * (finite(fps) && fps > 0 ? fps : 30);
  return Object.fromEntries(animators.map(animator => {
    const params: AnimatorParams = { offset: animator.offset, start: animator.start, end: animator.end };
    for (const leaf of ['offset', 'start', 'end'] as const) {
      const entries = points.map(point => {
        const value = record(point.animator) && Object.hasOwn(point.animator, animator.id) ? point.animator[animator.id] : undefined;
        return { point, value: record(value) && finite(value[leaf]) ? clamp(value[leaf], leaf === 'offset' ? -1 : 0, 1) : undefined };
      });
      const declared = entries.filter((entry): entry is { point: Record<string, unknown>; value: number } => entry.value !== undefined);
      if (points.length < 2 || declared.length === 0) continue;
      // Sparse endpoints hold the most recent declaration; they do not bridge unrelated points.
      const previous = declared.filter(entry => number(entry.point.t) <= frame).at(-1);
      let value = (previous ?? declared[0]!).value;
      if (frame > number(points[0]!.t)) {
        for (let i = 1; i < entries.length; i++) {
          const left = entries[i - 1]!;
          const right = entries[i]!;
          if (frame >= number(right.point.t)) continue;
          if (left.value === undefined || right.value === undefined) break;
          const k = animatorEase((frame - number(left.point.t)) / (number(right.point.t) - number(left.point.t)), easingFor(right.point, animator.id, leaf));
          value = left.value + (right.value - left.value) * k;
          break;
        }
      }
      params[leaf] = clamp(value, leaf === 'offset' ? -1 : 0, 1);
    }
    return [animator.id, params];
  }));
}

/** Fisher-Yates driven by a 32-bit integer avalanche hash; no global random state. */
export function animatorUnitOrder(count: number, seed?: number): number[] {
  const order = Array.from({ length: Math.max(0, Math.floor(number(count))) }, (_, i) => i);
  if (seed === undefined) return order;
  let state = number(seed) >>> 0;
  for (let i = order.length - 1; i > 0; i--) {
    state = (state + 0x9e3779b9) >>> 0;
    let hash = Math.imul(state ^ (state >>> 16), 0x21f0aaad);
    hash = Math.imul(hash ^ (hash >>> 15), 0x735a2d97);
    const j = ((hash ^ (hash >>> 15)) >>> 0) % (i + 1);
    [order[i], order[j]] = [order[j]!, order[i]!];
  }
  return order;
}

/** Each call evaluates one basis's unit. Consumers group animators by basis before composing tile states. */
export function captionAnimatorStateAt(
  animators: readonly ResolvedAnimator[] | null | undefined, params: AnimatorParamsById | null | undefined,
  unitIndex: number, count: number, outputWidth: number,
): CaptionAnimatorState {
  const state: CaptionAnimatorState = { translateX: 0, translateY: 0, scale: 1, rotateDeg: 0, opacityDelta: 0, letterSpacing: 0, blurPx: 0 };
  if (!Number.isInteger(count) || count <= 0 || !Number.isInteger(unitIndex) || unitIndex < 0 || unitIndex >= count) return state;
  const px = Math.max(0, number(outputWidth, 1920)) / 1920;
  for (const animator of animators ?? []) {
    const p = params && Object.hasOwn(params, animator.id) ? params[animator.id]! : animator;
    const s = p.start + p.offset;
    const e = p.end + p.offset;
    if (s >= e) continue;
    const rank = animator.randomize ? animatorUnitOrder(count, animator.randomize.seed)[unitIndex]! : unitIndex;
    const pos = (rank + 0.5) / count;
    const ramp = clamp((pos - s) / (e - s));
    let w: number;
    switch (animator.shape) {
      case 'ramp-down': w = 1 - ramp; break;
      case 'triangle': w = 1 - Math.abs(2 * ramp - 1); break;
      case 'round': w = ramp === 0 || ramp === 1 ? 0 : Math.sin(Math.PI * ramp); break;
      case 'smooth': w = ramp * ramp * (3 - 2 * ramp); break;
      case 'square': w = s <= pos && pos < e ? 1 : 0; break;
      default: w = ramp;
    }
    const k = animatorEase(w, animator.ease);
    state.translateX += animator.amount.x * k * px;
    state.translateY += animator.amount.y * k * px;
    state.scale *= 1 + animator.amount.scale * k;
    state.rotateDeg += animator.amount.rotate * k;
    state.opacityDelta += animator.amount.opacity * k;
    state.letterSpacing += animator.amount.letterSpacing * k * px;
    state.blurPx += animator.amount.blur * k * px;
  }
  return state;
}

/** Dense indices in token encounter order. segments warnings are emitted by normalizeAnimators. */
export function animatorUnitsOf(basis: AnimatorBasis, tokens: readonly CaptionWordTileToken[]): {
  count: number; unitIndexOf(token: CaptionWordTileToken): number;
} {
  const units = new Map<number | CaptionWordTileToken, number>();
  const indices = new Map<CaptionWordTileToken, number>();
  for (const token of tokens) {
    const key = basis === 'lines' ? token.lineIndex : basis === 'chars' ? token.charIndex ?? token
      : token.wordIndex ?? token.tokenIndex ?? token;
    if (!units.has(key)) units.set(key, units.size);
    indices.set(token, units.get(key)!);
  }
  return { count: units.size, unitIndexOf: token => indices.get(token) ?? -1 };
}
