export interface CaptionMotionSlot {
  id: string;
  durationSec?: number;
  duration_sec?: number;
  ease?: string;
  amp?: number;
}

export interface CaptionMotionDeclaration {
  in?: CaptionMotionSlot;
  loop?: CaptionMotionSlot;
  out?: CaptionMotionSlot;
}

export interface CaptionMotionState {
  opacity: number;
  translateX: number;
  translateY: number;
  scaleX: number;
  scaleY: number;
  rotateDeg: number;
}

interface MotionPoint {
  at: number;
  opacity?: number;
  xEm?: number;
  yEm?: number;
  xPercent?: number;
  yPercent?: number;
  scaleX?: number;
  scaleY?: number;
  rotateDeg?: number;
}

export interface CaptionSpriteMotion {
  keyframes: readonly MotionPoint[];
}

const identity = (): CaptionMotionState => ({
  opacity: 1,
  translateX: 0,
  translateY: 0,
  scaleX: 1,
  scaleY: 1,
  rotateDeg: 0
});

const motion = (...keyframes: MotionPoint[]): CaptionSpriteMotion => ({ keyframes });
const fromTo = (from: Omit<MotionPoint, 'at'>, to: Omit<MotionPoint, 'at'> = {}): CaptionSpriteMotion =>
  motion({ at: 0, ...from }, { at: 1, ...(Object.keys(from).some((key) => key !== 'opacity')
    ? { xEm: 0, yEm: 0, scaleX: 1, scaleY: 1, rotateDeg: 0 } : {}), ...to });

export const CAPTION_SPRITE_MOTIONS: Record<string, CaptionSpriteMotion> = {
  'fade-in-out': fromTo({ opacity: 0 }),
  'soft-fade': fromTo({ opacity: 0, scaleX: 1.04, scaleY: 1.04 }),
  'fade-up': fromTo({ opacity: 0, yEm: 0.6 }),
  'fade-down': fromTo({ opacity: 0, yEm: -0.6 }),
  'cinematic-fade': fromTo({ opacity: 0, scaleX: 0.94, scaleY: 0.94 }),
  'slide-left': fromTo({ opacity: 0, xEm: 1.2 }),
  'slide-right': fromTo({ opacity: 0, xEm: -1.2 }),
  'slide-up': fromTo({ opacity: 0, yEm: 1.2 }),
  'slide-down': fromTo({ opacity: 0, yEm: -1.2 }),
  'rise-soft': fromTo({ opacity: 0, yEm: 0.35, scaleX: 0.98, scaleY: 0.98 }),
  'drop-in': motion(
    { at: 0, opacity: 0, yEm: -1.6 },
    { at: 0.7, opacity: 1, yEm: 0.12 },
    { at: 1, opacity: 1 }
  ),
  'zoom-in-out': fromTo({ opacity: 0, scaleX: 0.6, scaleY: 0.6 }),
  'zoom-pop': motion(
    { at: 0, opacity: 0, scaleX: 0.4, scaleY: 0.4 },
    { at: 0.7, opacity: 1, scaleX: 1.12, scaleY: 1.12 },
    { at: 1, opacity: 1 }
  ),
  'zoom-pulse': motion(
    { at: 0, opacity: 0, scaleX: 0.7, scaleY: 0.7 },
    { at: 0.55, opacity: 1, scaleX: 1.06, scaleY: 1.06 },
    { at: 1, opacity: 1 }
  ),
  pop: motion(
    { at: 0, opacity: 0, scaleX: 0.5, scaleY: 0.5 },
    { at: 0.65, opacity: 1, scaleX: 1.18, scaleY: 1.18 },
    { at: 1, opacity: 1 }
  ),
  bounce: motion(
    { at: 0, opacity: 0, yEm: -1.2 },
    { at: 0.55, opacity: 1, yEm: 0.22 },
    { at: 0.75, yEm: -0.1 },
    { at: 1, opacity: 1 }
  ),
  'squash-pop': motion(
    { at: 0, opacity: 0, scaleX: 1.4, scaleY: 0.4 },
    { at: 0.6, opacity: 1, scaleX: 0.92, scaleY: 1.1 },
    { at: 1, opacity: 1 }
  ),
  'stretch-in': motion(
    { at: 0, opacity: 0, scaleX: 0.2 },
    { at: 0.7, opacity: 1, scaleX: 1.08 },
    { at: 1, opacity: 1 }
  ),
  stomp: motion(
    { at: 0, opacity: 0, scaleX: 1.9, scaleY: 1.9 },
    { at: 0.6, opacity: 1, scaleX: 0.96, scaleY: 0.96 },
    { at: 1, opacity: 1 }
  ),
  snap: motion(
    { at: 0, opacity: 0, rotateDeg: -6, scaleX: 0.8, scaleY: 0.8 },
    { at: 0.7, opacity: 1, rotateDeg: 2, scaleX: 1.04, scaleY: 1.04 },
    { at: 1, opacity: 1 }
  ),
  'rotate-in': fromTo({ opacity: 0, rotateDeg: -12, scaleX: 0.9, scaleY: 0.9 }),
  'spin-in': fromTo({ opacity: 0, rotateDeg: -180, scaleX: 0.5, scaleY: 0.5 }),
  'roll-in': fromTo({ opacity: 0, xEm: -2, rotateDeg: -120 }),
  'spiral-in': fromTo({ opacity: 0, rotateDeg: 240, scaleX: 0.2, scaleY: 0.2 }),
  shake: motion(
    { at: 0, xEm: 0 }, { at: 0.2, xEm: -0.16 }, { at: 0.4, xEm: 0.14 },
    { at: 0.6, xEm: -0.1 }, { at: 0.8, xEm: 0.06 }, { at: 1, xEm: 0 }
  ),
  jitter: motion(
    { at: 0, xEm: 0, yEm: 0 }, { at: 0.25, xEm: 0.05, yEm: -0.04 },
    { at: 0.5, xEm: -0.05, yEm: 0.04 }, { at: 0.75, xEm: 0.03, yEm: 0.05 }, { at: 1, xEm: 0, yEm: 0 }
  ),
  flash: motion(
    { at: 0, opacity: 0 }, { at: 0.3, opacity: 1 }, { at: 0.45, opacity: 0.2 },
    { at: 0.6, opacity: 1 }, { at: 0.75, opacity: 0.5 }, { at: 1, opacity: 1 }
  ),
  heartbeat: motion(
    { at: 0, scaleX: 1, scaleY: 1 }, { at: 0.25, scaleX: 1.12, scaleY: 1.12 }, { at: 0.45, scaleX: 1, scaleY: 1 },
    { at: 0.65, scaleX: 1.08, scaleY: 1.08 }, { at: 1, scaleX: 1, scaleY: 1 }
  ),
  wobble: motion({ at: 0, rotateDeg: -1.6 }, { at: 0.5, rotateDeg: 1.6 }, { at: 1, rotateDeg: -1.6 }),
  float: motion({ at: 0, yEm: 0 }, { at: 0.5, yEm: -0.22 }, { at: 1, yEm: 0 }),
  breath: motion(
    { at: 0, opacity: 1, scaleX: 1, scaleY: 1 }, { at: 0.5, opacity: 0.92, scaleX: 1.03, scaleY: 1.03 },
    { at: 1, opacity: 1, scaleX: 1, scaleY: 1 }
  ),
  'neon-flicker': motion(
    { at: 0, opacity: 1 }, { at: 0.08, opacity: 0.6 }, { at: 0.12, opacity: 1 },
    { at: 0.4, opacity: 0.85 }, { at: 0.44, opacity: 1 }, { at: 0.7, opacity: 0.4 },
    { at: 0.74, opacity: 1 }, { at: 1, opacity: 1 }
  ),
  hologram: motion(
    { at: 0, opacity: 1, xEm: 0 }, { at: 0.3, opacity: 0.75, xEm: 0.03 },
    { at: 0.6, opacity: 0.9, xEm: -0.03 }, { at: 1, opacity: 1, xEm: 0 }
  ),
  'retro-flicker': motion(
    { at: 0, opacity: 1 }, { at: 0.25, opacity: 0.7 }, { at: 0.5, opacity: 1 },
    { at: 0.75, opacity: 0.8 }, { at: 1, opacity: 1 }
  ),
  'caption-rise': fromTo({ opacity: 0, yEm: 0.5 }),
  'news-ticker': fromTo({ xPercent: 1 }, { xPercent: -1 }),
  'marquee-left': fromTo({ xPercent: 1 }, { xPercent: -1 }),
  'crawl-up': fromTo({ yPercent: 1 }, { yPercent: -1 })
};

const unsupported = new Set([
  'push-left', 'push-right', 'push-up', 'push-down', 'typewriter', 'wipe-left', 'wipe-right',
  'glitch', 'swing'
]);

const easeCurves: Record<string, readonly [number, number, number, number] | null> = {
  linear: null,
  ease: [0.25, 0.1, 0.25, 1],
  'ease-in': [0.42, 0, 1, 1],
  'ease-out': [0, 0, 0.58, 1],
  'ease-in-out': [0.42, 0, 0.58, 1]
};
const ampScaleAtStart = new Set(['soft-fade', 'cinematic-fade', 'zoom-in-out', 'stomp']);
const ampScaleAtOvershoot = new Set(['zoom-pop', 'stretch-in']);

export function isCaptionMotionSupported(declaration: CaptionMotionDeclaration | null): { supported: boolean; unsupported: string[] } {
  if (!declaration) return { supported: true, unsupported: [] };
  const ids = ['in', 'loop', 'out'].flatMap((kind) => {
    const slot = declaration[kind as keyof CaptionMotionDeclaration];
    if (!slot?.id) return [];
    return unsupported.has(slot.id) || !Object.hasOwn(CAPTION_SPRITE_MOTIONS, slot.id) ? [slot.id] : [];
  });
  return { supported: ids.length === 0, unsupported: [...new Set(ids)] };
}

export function captionMotionAt(
  declaration: CaptionMotionDeclaration | null,
  localSeconds: number,
  cueDurationSec: number,
  emPx: number,
  plateWidthPx = 20 * emPx,
  plateHeightPx = 20 * emPx
): CaptionMotionState {
  const local = Math.max(0, finiteNumber(localSeconds, 0));
  const cueDuration = Math.max(0, finiteNumber(cueDurationSec, 0));
  const em = Math.max(0, finiteNumber(emPx, 0));
  if (!declaration || (!declaration.in && !declaration.loop && !declaration.out)) {
    const progress = Math.max(0, Math.min(1, local / 0.18));
    const eased = applyEase(progress, 'ease-out');
    return {
      ...identity(),
      opacity: eased,
      translateY: 0.18 * em * (1 - eased)
    };
  }
  const support = isCaptionMotionSupported(declaration);
  if (!support.supported) throw new Error(`unsupported caption motion: ${support.unsupported.join(', ')}`);
  const state = identity();
  // CSS exposes one custom property on the plate, shared by all three recipes.
  const ampValue = [declaration.in, declaration.loop, declaration.out]
    .find((slot) => slot?.amp !== undefined)?.amp;
  const amp = Number.isFinite(ampValue) ? Number(ampValue) : 1;
  if (declaration.in) {
    const duration = slotDuration(declaration.in, cueDuration, 0.6);
    applySlot(state, declaration.in, Math.min(1, local / duration), em, amp, plateWidthPx, plateHeightPx);
  }
  if (declaration.loop) {
    const period = positiveDuration(declaration.loop.durationSec ?? declaration.loop.duration_sec, 1.6);
    applySlot(state, declaration.loop, (local % period) / period, em, amp, plateWidthPx, plateHeightPx, 'linear');
  }
  if (declaration.out) {
    const duration = slotDuration(declaration.out, cueDuration, 0.6);
    const delay = Math.max(0, cueDuration - duration);
    if (local >= delay) applySlot(state, declaration.out, 1 - Math.min(1, (local - delay) / duration), em, amp, plateWidthPx, plateHeightPx);
  }
  return state;
}

function slotDuration(slot: CaptionMotionSlot, cueDuration: number, fallback: number): number {
  return Math.min(positiveDuration(slot.durationSec ?? slot.duration_sec, fallback), Math.max(0.05, cueDuration));
}

function positiveDuration(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && Number(value) > 0 ? Number(value) : fallback;
}

function applySlot(state: CaptionMotionState, slot: CaptionMotionSlot, progress: number, emPx: number,
  amp: number, plateWidthPx: number, plateHeightPx: number, ease = slot.ease ?? 'ease-out'): void {
  const recipe = CAPTION_SPRITE_MOTIONS[slot.id];
  if (!recipe || recipe.keyframes.length === 0) throw new Error(`unsupported caption motion: ${slot.id}`);
  const directed = Math.max(0, Math.min(1, progress));
  const points = recipe.keyframes;
  const underlying = { ...state };
  const opacity = propertyInterval(points, (point) => point.opacity !== undefined, directed, ease);
  if (opacity) state.opacity = lerp(
    opacity.left.opacity ?? underlying.opacity,
    opacity.right.opacity ?? underlying.opacity,
    opacity.fraction
  );
  const transform = propertyInterval(points, hasTransform, directed, ease);
  if (!transform) return;
  const a = hasTransform(transform.left)
    ? pointState(transform.left, slot.id, emPx, amp, plateWidthPx, plateHeightPx) : underlying;
  const b = hasTransform(transform.right)
    ? pointState(transform.right, slot.id, emPx, amp, plateWidthPx, plateHeightPx) : underlying;
  state.translateX = lerp(a.translateX, b.translateX, transform.fraction);
  state.translateY = lerp(a.translateY, b.translateY, transform.fraction);
  state.scaleX = lerp(a.scaleX, b.scaleX, transform.fraction);
  state.scaleY = lerp(a.scaleY, b.scaleY, transform.fraction);
  state.rotateDeg = lerp(a.rotateDeg, b.rotateDeg, transform.fraction);
}

function propertyInterval(points: readonly MotionPoint[], hasProperty: (point: MotionPoint) => boolean,
  directed: number, ease: string): { left: MotionPoint; right: MotionPoint; fraction: number } | null {
  const selected = points.filter(hasProperty);
  if (selected.length === 0) return null;
  // A missing endpoint gets an implicit keyframe from the value below this animation.
  // Missing interior keyframes do not create intervals for this property.
  if (selected[0]!.at > 0) selected.unshift({ at: 0 });
  if (selected.at(-1)!.at < 1) selected.push({ at: 1 });
  let left = selected[0]!;
  let right = selected.at(-1)!;
  for (let index = 1; index < selected.length; index += 1) {
    if (directed <= selected[index]!.at) {
      left = selected[index - 1]!;
      right = selected[index]!;
      break;
    }
  }
  const span = right.at - left.at;
  return { left, right, fraction: span <= 0 ? 0 : applyEase((directed - left.at) / span, ease) };
}

function hasTransform(point: MotionPoint): boolean {
  return point.xEm !== undefined || point.yEm !== undefined || point.xPercent !== undefined
    || point.yPercent !== undefined || point.scaleX !== undefined || point.scaleY !== undefined
    || point.rotateDeg !== undefined;
}

function pointState(point: MotionPoint, id: string, emPx: number, amp: number,
  plateWidthPx: number, plateHeightPx: number): CaptionMotionState {
  const ampScale = ampScaleAtStart.has(id) && point.at === 0
    || ampScaleAtOvershoot.has(id) && point.at === 0.7
    || id === 'zoom-pulse' && point.at === 0.55
    || id === 'pop' && point.at === 0.65
    || id === 'heartbeat' && (point.at === 0.25 || point.at === 0.65)
    || id === 'breath' && point.at === 0.5;
  const scale = (value: number) => ampScale ? 1 + (value - 1) * amp : value;
  return {
    opacity: point.opacity ?? 1,
    translateX: (point.xEm ?? 0) * emPx * amp + (point.xPercent ?? 0) * plateWidthPx,
    translateY: (point.yEm ?? 0) * emPx * amp + (point.yPercent ?? 0) * plateHeightPx,
    scaleX: scale(point.scaleX ?? 1),
    scaleY: scale(point.scaleY ?? point.scaleX ?? 1),
    rotateDeg: (point.rotateDeg ?? 0) * amp
  };
}

function applyEase(progress: number, name: string): number {
  const curve = Object.hasOwn(easeCurves, name) ? easeCurves[name] : easeCurves['ease-out'];
  if (!curve) return progress;
  return cubicBezierAt(progress, ...curve);
}

export function cubicBezierAt(x: number, x1: number, y1: number, x2: number, y2: number): number {
  const sample = (t: number, a: number, b: number) => {
    const inverse = 1 - t;
    return 3 * inverse * inverse * t * a + 3 * inverse * t * t * b + t * t * t;
  };
  const derivative = (t: number, a: number, b: number) =>
    3 * (1 - t) * (1 - t) * a + 6 * (1 - t) * t * (b - a) + 3 * t * t * (1 - b);
  let t = Math.max(0, Math.min(1, x));
  for (let iteration = 0; iteration < 16; iteration += 1) {
    const delta = sample(t, x1, x2) - x;
    if (Math.abs(delta) <= 1e-7) break;
    const slope = derivative(t, x1, x2);
    if (Math.abs(slope) < 1e-7) break;
    t = Math.max(0, Math.min(1, t - delta / slope));
  }
  return sample(t, y1, y2);
}

function lerp(left: number, right: number, progress: number): number {
  return left + (right - left) * Math.max(0, Math.min(1, progress));
}

function finiteNumber(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

export {
  buildCaptionWordTiles,
  captionMeasurementsEqual,
  captionRevealGroupStateAt,
  captionWordTextureRect,
  captionWordStateAt
} from './caption-words.js';
export type {
  CaptionWordRect,
  CaptionWordRole,
  CaptionWordState,
  CaptionWordTile,
  CaptionWordTileMeasurement,
  CaptionWordTileToken,
  CaptionWordTiming
} from './caption-words.js';
