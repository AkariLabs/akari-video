import {
  buildTimelineMap,
  computeCutTrackSegments,
  DEFAULT_CUT_ADJACENCY_FPS,
  isStillImageSourcePath,
  outputToSource,
  transitionProgressAt
} from '@akari-video/edit-store';
import { isTransitionType } from '@akari-video/edit-store';
import type { AdjustV1, EditCut, TimelineMapResult, TimelineSegment } from '@akari-video/edit-store';
import type {
  EvaluationPlan,
  NativeFrameSource,
  ResolvedCutVisual,
  ResolvedFilter,
  ResolvedLayerBlendMode,
  StillImageSource,
  TimelineTimeUs
} from '../types.js';
import type { ParsedCubeLut } from '../look/cube.js';
import { bakeItemAdjustLut, isItemAdjustIdentity } from '../adjust/bake.js';
import { normalizeAdjustFx, type ResolvedAdjustFx } from '../adjust/fx.js';
import { computeLayerKeyframesVisual, type LayerKeyframe } from './layer-visual.js';
import { motionVisualAt, type MotionV0, type MotionVisual } from './item-motion.js';

export type TimelineSourceRegistry = ReadonlyMap<string, NativeFrameSource | StillImageSource>;

export interface CutFramingKeyframe {
  t: number;
  scale: number;
  cx?: number;
  cy?: number;
}

export interface FrameEngineAdjust extends Omit<AdjustV1, 'lut'> {
  lut?: { lut: ParsedCubeLut; intensity?: number } | null;
}

export interface FrameEngineCut extends Omit<EditCut, 'transitionOut' | 'adjust'> {
  transitionOut?: EditCut['transitionOut'];
  transition_out?: EditCut['transitionOut'];
  framing?: {
    crop?: { x: number; y: number; w: number; h: number };
    keyframes?: readonly CutFramingKeyframe[];
  };
  freeze?: { at_sec: number; duration_sec: number } | null;
  id?: string;
  /**
   * layer-style visual of a v2 media item (issue #39). edit-store's buildV2VisualItem projects
   * items[].crop / perspective / keyframes onto the cut declaration; keyframes[].t is already in seconds
   * and is read as **output-local seconds** (outputSeconds − placement.at — it keeps advancing while a
   * freeze holds the picture, the same clock as the legacy trimmed stream `t`).
   */
  crop?: { x: number; y: number; w: number; h: number };
  keyframes?: readonly LayerKeyframe[];
  motion?: MotionV0;
  perspective?: { corners: readonly (readonly [number, number])[] };
  adjust?: FrameEngineAdjust;
}

export interface FrameEngineLayer {
  id?: string;
  t: number;
  duration: number;
  kind?: 'video' | 'baked' | 'filter' | 'matte';
  src?: string;
  mask?: string;
  transform?: { x?: number; y?: number; scale?: number; rotate?: number };
  crop?: { x: number; y: number; w: number; h: number };
  perspective?: { corners: readonly (readonly [number, number])[] };
  keyframes?: readonly LayerKeyframe[];
  motion?: MotionV0;
  opacity?: number;
  blend?: ResolvedLayerBlendMode;
  adjust?: FrameEngineAdjust;
  filter?:
    | { type: 'invert' }
    | { type: 'saturation'; value: number }
    | { type: 'lut'; lut: import('../look/cube.js').ParsedCubeLut; intensity?: number };
}

const KNOWN_CUT_KEY_LIST = [
  'in', 'out', 'src', 'transform', 'opacity', 'speed', 'transitionOut', 'at', 'track',
  'transition_out', 'framing', 'freeze', 'id', 'crop', 'keyframes', 'perspective', 'adjust', 'motion', 'animator', 'audio', 'mute'
] as const;

const KNOWN_LAYER_KEY_LIST = [
  'id', 't', 'duration', 'kind', 'src', 'mask', 'transform', 'crop', 'perspective',
  'keyframes', 'opacity', 'blend', 'filter', 'adjust', 'motion', 'animator'
] as const;

const KNOWN_KEYFRAME_KEY_LIST = [
  't', 'transform', 'crop', 'perspective', 'opacity', 'easing', 'animator'
] as const;

/** Exact declaration inventories plus animator, which is recognized but ignored on non-text items. */
export const KNOWN_CUT_KEYS: ReadonlySet<keyof FrameEngineCut | 'animator'> = new Set(KNOWN_CUT_KEY_LIST);
export const KNOWN_LAYER_KEYS: ReadonlySet<keyof FrameEngineLayer | 'animator'> = new Set(KNOWN_LAYER_KEY_LIST);
export const KNOWN_KEYFRAME_KEYS: ReadonlySet<keyof LayerKeyframe | 'animator'> = new Set(KNOWN_KEYFRAME_KEY_LIST);

type ExactKeys<T, Keys extends PropertyKey> =
  Exclude<keyof T, Keys> extends never
    ? Exclude<Keys, keyof T> extends never ? true : false
    : false;
type Assert<T extends true> = T;
type _KnownCutKeysAreExact = Assert<ExactKeys<FrameEngineCut & { animator?: unknown }, typeof KNOWN_CUT_KEY_LIST[number]>>;
type _KnownLayerKeysAreExact = Assert<ExactKeys<FrameEngineLayer & { animator?: unknown }, typeof KNOWN_LAYER_KEY_LIST[number]>>;
type _KnownKeyframeKeysAreExact = Assert<ExactKeys<LayerKeyframe & { animator?: unknown }, typeof KNOWN_KEYFRAME_KEY_LIST[number]>>;

export interface BuildResolvedTimelinePlanOptions extends NonNullable<Parameters<typeof buildTimelineMap>[1]> {
  layers?: readonly FrameEngineLayer[];
  maskResolver?: (colorSrc: string) => string | null | undefined;
  onWarning?: (message: string) => void;
}

interface ResolvedCutPlacement {
  cut: FrameEngineCut;
  at: number;
  end: number;
  playbackDuration: number;
  freezeAt: number | null;
  freezeDuration: number;
  adjustLut?: ParsedCubeLut;
  adjustFx?: ResolvedAdjustFx[];
}

export interface ResolvedTimelinePlan {
  readonly map: TimelineMapResult;
  readonly cuts: readonly ResolvedCutPlacement[];
  readonly totalDuration: number;
  readonly layers: readonly FrameEngineLayer[];
  readonly layerAdjustLuts: readonly (ParsedCubeLut | undefined)[];
  readonly layerAdjustFx?: readonly (ResolvedAdjustFx[] | undefined)[];
  readonly maskSources: ReadonlyMap<string, string | null>;
  readonly warn: (message: string) => void;
  readonly fps: number;
}

/**
 * cuts[].track の z 既定。v2 の tracks[] は配列順 = z 順（後ろが前面）で、内部モデルは cuts の
 * track ref を配列順に採番するため、番号が大きいトラックほど前面に置く。edit-store の
 * buildTimelineMap 既定（-track = 番号が小さいほど前面）は逆向きで、GPU / OSR の書き出しが
 * 2 本目以降の visual トラックの映像クリップを無言で落としていた（issue #31）。シェルの
 * タイムライン UI（akari-preview-open-handler.ts の buildTimelineMap 直呼び）は同じ向きを明示しており、
 * frame-engine へ cuts を渡す 4 消費者（gpu / osr / preview-server / シェルのプレビュー）は本既定に依る。
 * 呼び出し側が options.trackZ を渡せば従来どおりそちらが優先される。
 */
const DEFAULT_TRACK_Z = (track: number): number => track;

const DEFAULT_VISUAL: ResolvedCutVisual = {
  framing: { x: 0, y: 0, width: 1, height: 1, scale: 1, centerX: 0.5, centerY: 0.5 },
  transform: { x: 0, y: 0, scale: 1, rotateDegrees: 0 },
  opacity: 1
};

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

/** Resolve the effective item adjustment and bake it once for the timeline plan. */
export function resolveAdjustLut(adjust: FrameEngineAdjust | null | undefined): ParsedCubeLut | undefined {
  if (!adjust) return undefined;
  const userLut = adjust.sections?.lut === false ? undefined : adjust.lut?.lut;
  const view: AdjustV1 = {
    ...adjust,
    lut: userLut ? { lut: 'resolved', intensity: adjust.lut?.intensity } : null,
  };
  return isItemAdjustIdentity(view) ? undefined : bakeItemAdjustLut(view, userLut);
}

/** Resolve spatial effects separately from the color LUT, once per plan. */
export function resolveAdjustFx(
  adjust: FrameEngineAdjust | null | undefined,
  warnings: string[] = []
): ResolvedAdjustFx[] | undefined {
  const fx = normalizeAdjustFx(adjust?.fx, adjust?.sections, warnings);
  return fx.length ? fx : undefined;
}

function normalizeTransition(cut: FrameEngineCut): EditCut['transitionOut'] {
  return cut.transition_out ?? cut.transitionOut;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object';
}

function usableKeyframeCount(keyframes: FrameEngineCut['keyframes']): number {
  return Array.isArray(keyframes)
    ? keyframes.filter(point => Boolean(point) && typeof point === 'object' && Number.isFinite(point.t) && point.t >= 0).length
    : 0;
}

/**
 * issue #39: a cut declaring `crop`, `perspective`, or two or more usable keyframes is drawn with the
 * layer-style geometry (natural source size × scale, crop window, box-centered rotate) — the same rule
 * the shell preview (`cutHasLayerStyleVisual`) and legacy render-cut (`hasCutLayerStyleVisual`) use.
 * transform / opacity alone keep the fit-basis path untouched.
 */
export function hasCutLayerStyleVisual(cut: Pick<FrameEngineCut, 'crop' | 'perspective' | 'keyframes' | 'motion'>): boolean {
  return isRecord(cut.crop) || isRecord(cut.perspective) || usableKeyframeCount(cut.keyframes) >= 2
    || cut.motion?.in?.preset === 'wipe' || cut.motion?.out?.preset === 'wipe';
}

function cutDeclaresPerspective(cut: FrameEngineCut): boolean {
  return isRecord(cut.perspective) || (Array.isArray(cut.keyframes)
    && cut.keyframes.some(point => Boolean(point) && typeof point === 'object' && isRecord(point.perspective)));
}

function warnUnknownFields(
  value: object,
  label: string,
  knownKeys: ReadonlySet<PropertyKey>,
  warn: (message: string) => void
): void {
  if (knownKeys !== KNOWN_KEYFRAME_KEYS && (Object.hasOwn(value, 'animator')
      || ('keyframes' in value && Array.isArray(value.keyframes)
        && value.keyframes.some(point => isRecord(point) && Object.hasOwn(point, 'animator'))))) {
    warn(`${label}: animator is ignored on non-text items (see packages/schemas/engine-capabilities.json)`);
  }
  for (const key of Object.keys(value)) {
    if (knownKeys.has(key)) continue;
    warn(`${label}: field "${key}" is not consumed by the frame-engine (see packages/schemas/engine-capabilities.json)`);
  }
}

function warnUnknownKeyframes(
  keyframes: readonly LayerKeyframe[] | undefined,
  owner: string,
  warn: (message: string) => void
): void {
  if (!Array.isArray(keyframes)) return;
  keyframes.forEach((keyframe, index) => {
    if (!keyframe || typeof keyframe !== 'object') return;
    warnUnknownFields(keyframe, `${owner} keyframe ${index}`, KNOWN_KEYFRAME_KEYS, warn);
  });
}

/**
 * Extends edit-store's resolved timeline with the non-linear freeze mapping.
 * The virtual source range expands the edit-store cursor before transitions are resolved;
 * source time is corrected back to forward/hold/forward when a frame is evaluated.
 */
export function buildResolvedTimelinePlan(
  cuts: readonly FrameEngineCut[],
  options: BuildResolvedTimelinePlanOptions = {}
): ResolvedTimelinePlan {
  const { layers = [], maskResolver, onWarning, ...timelineOptions } = options;
  const warned = new Set<string>();
  const warn = (message: string) => {
    if (warned.has(message)) return;
    warned.add(message);
    onWarning?.(message);
  };
  const itemFx = (adjust: FrameEngineAdjust | undefined, owner: string) => {
    const warnings: string[] = [];
    const fx = resolveAdjustFx(adjust, warnings);
    warnings.forEach(message => warn(owner + ': ' + message));
    return fx;
  };
  cuts.forEach((cut, index) => {
    const id = String(cut.id ?? `cut-${index}`);
    warnUnknownFields(cut, `cut ${id}`, KNOWN_CUT_KEYS, warn);
    warnUnknownKeyframes(cut.keyframes, `cut ${id}`, warn);
  });
  layers.forEach((layer, index) => {
    const id = String(layer.id ?? `layer-${index}`);
    warnUnknownFields(layer, `layer ${id}`, KNOWN_LAYER_KEYS, warn);
    warnUnknownKeyframes(layer.keyframes, `layer ${id}`, warn);
  });
  if (cuts.some(cut => cut.freeze && (cut.at !== undefined || cut.track !== undefined))) {
    throw new Error('freeze with explicit at/track is not supported by the sequential cuts timeline');
  }
  const virtualCuts: EditCut[] = cuts.map(cut => {
    const speed = finite(cut.speed, 1) > 0 ? finite(cut.speed, 1) : 1;
    const freezeDuration = Math.max(0, finite(cut.freeze?.duration_sec, 0));
    return {
      ...cut,
      out: cut.out + freezeDuration * speed,
      transitionOut: normalizeTransition(cut)
    };
  });
  const map = buildTimelineMap(virtualCuts, { trackZ: DEFAULT_TRACK_Z, ...timelineOptions });
  const trackSegments = computeCutTrackSegments(virtualCuts);
  const placements = cuts.map((cut, index): ResolvedCutPlacement => {
    const segment = trackSegments[index];
    if (!segment) throw new Error(`timeline did not resolve cut ${index}`);
    const speed = finite(cut.speed, 1) > 0 ? finite(cut.speed, 1) : 1;
    const playbackDuration = Math.max(0, cut.out - cut.in) / speed;
    const freezeDuration = Math.max(0, finite(cut.freeze?.duration_sec, 0));
    const freezeAt = cut.freeze
      ? clamp(finite(cut.freeze.at_sec, 0), 0, playbackDuration)
      : null;
    const adjustLut = resolveAdjustLut(cut.adjust);
    const adjustFx = itemFx(cut.adjust, `cut ${cut.id ?? `cut-${index}`}`);
    return {
      cut,
      at: segment.at,
      end: segment.end,
      playbackDuration,
      freezeAt,
      freezeDuration,
      ...(adjustLut ? { adjustLut } : {}),
      ...(adjustFx ? { adjustFx } : {})
    };
  });
  const visibleLayers = layers;
  const layerAdjustLuts = visibleLayers.map(layer => resolveAdjustLut(layer.adjust));
  const layerAdjustFx = visibleLayers.map((layer, index) => itemFx(layer.adjust, `layer ${layer.id ?? `layer-${index}`}`));
  // issue #39: perspective is out of scope for the base path; never drop it silently.
  cuts.forEach((cut, index) => {
    if (!cutDeclaresPerspective(cut)) return;
    warn(`cut ${cut.id ?? `cut-${index}`}: perspective is not applied by the frame-engine base path yet (issue #39)`);
  });
  const maskSources = new Map<string, string | null>();
  for (const layer of visibleLayers) {
    if (layer.kind === 'filter' || !layer.src || layer.mask !== undefined || maskSources.has(layer.src)) continue;
    if (isStillImageSourcePath(layer.src)) {
      if (layer.kind === 'matte') warn(`mask ignored for still image layer ${layer.id ?? layer.src}`);
      maskSources.set(layer.src, null);
      continue;
    }
    if (!maskResolver) {
      maskSources.set(layer.src, null);
      continue;
    }
    try {
      maskSources.set(layer.src, maskResolver(layer.src) ?? null);
    } catch (error) {
      warn(`mask resolver failed for ${layer.src}: ${error instanceof Error ? error.message : String(error)}`);
      maskSources.set(layer.src, null);
    }
  }
  // 総尺は cuts の終端と layers の終端の大きい方（edit-store の visualContentEndSeconds と同じ定義）。
  // cuts が空で layers だけの時間軸（同一トラック内の重なりで全 media アイテムが layers へ退避した
  // 場合など）で総尺 0 になると、書き出しランタイムは全コマを t=0 に丸めて layers を評価できない。
  const layersEnd = visibleLayers.reduce((maximum, layer) =>
    Math.max(maximum, finite(layer.t, 0) + Math.max(0, finite(layer.duration, 0))), 0);
  return {
    map, cuts: placements, totalDuration: Math.max(map.totalDuration, layersEnd),
    layers: visibleLayers,
    layerAdjustLuts,
    ...(layerAdjustFx.some(Boolean) ? { layerAdjustFx } : {}),
    maskSources,
    warn,
    fps: finite(options.fps, DEFAULT_CUT_ADJACENCY_FPS) > 0
      ? finite(options.fps, DEFAULT_CUT_ADJACENCY_FPS) : DEFAULT_CUT_ADJACENCY_FPS
  };
}

export function isLayerActiveAt(layer: Pick<FrameEngineLayer, 't' | 'duration'>, timeUs: TimelineTimeUs, fps: number): boolean {
  const frame = Math.floor((timeUs / 1e6) * fps + 1e-9);
  const startFrame = Math.max(0, Math.ceil(finite(layer.t, 0) * fps - 1e-6));
  const endFrame = Math.max(startFrame, Math.ceil((finite(layer.t, 0) + Math.max(0, finite(layer.duration, 0))) * fps - 1e-6));
  return frame >= startFrame && frame < endFrame;
}

function playbackSecondsAt(placement: ResolvedCutPlacement, outputSeconds: number): number {
  const local = clamp(outputSeconds - placement.at, 0, placement.playbackDuration + placement.freezeDuration);
  if (placement.freezeAt == null || placement.freezeDuration <= 0) {
    return Math.min(local, placement.playbackDuration);
  }
  if (local <= placement.freezeAt) return local;
  if (local <= placement.freezeAt + placement.freezeDuration) return placement.freezeAt;
  return Math.min(placement.playbackDuration, local - placement.freezeDuration);
}

function interpolateFraming(
  keyframes: readonly CutFramingKeyframe[],
  playbackSeconds: number
): { scale: number; centerX: number; centerY: number } {
  const usable = keyframes
    .filter(point => Number.isFinite(point.t) && Number.isFinite(point.scale))
    .slice()
    .sort((left, right) => left.t - right.t);
  if (usable.length === 0) return { scale: 1, centerX: 0.5, centerY: 0.5 };
  const first = usable[0]!;
  const last = usable[usable.length - 1]!;
  let left = first;
  let right = first;
  if (playbackSeconds >= last.t) {
    left = last;
    right = last;
  } else if (playbackSeconds > first.t) {
    for (let index = 1; index < usable.length; index += 1) {
      const candidate = usable[index]!;
      if (playbackSeconds <= candidate.t) {
        left = usable[index - 1]!;
        right = candidate;
        break;
      }
    }
  }
  const amount = right.t > left.t ? clamp((playbackSeconds - left.t) / (right.t - left.t), 0, 1) : 0;
  const lerp = (a: number, b: number) => a + (b - a) * amount;
  return {
    scale: Math.max(1, lerp(finite(left.scale, 1), finite(right.scale, 1))),
    centerX: clamp(lerp(finite(left.cx, 0.5), finite(right.cx, 0.5)), 0, 1),
    centerY: clamp(lerp(finite(left.cy, 0.5), finite(right.cy, 0.5)), 0, 1)
  };
}

/**
 * layer-style（issue #39）: keyframes を出力ローカル秒で評価し、宣言のある property だけ静的値
 * （cut.crop / cut.transform / cut.opacity）へ上書きする。perspective は読まない（build 時に warn 済み）。
 */
function layerStyleVisualAt(cut: FrameEngineCut, localSeconds: number): ResolvedCutVisual {
  const animated = computeLayerKeyframesVisual(cut.keyframes, localSeconds);
  const staticCrop = cut.crop ?? { x: 0, y: 0, w: 1, h: 1 };
  const crop = animated?.crop ?? {
    x: finite(staticCrop.x, 0),
    y: finite(staticCrop.y, 0),
    width: finite(staticCrop.w, 1),
    height: finite(staticCrop.h, 1)
  };
  const width = clamp(crop.width, Number.EPSILON, 1);
  const height = clamp(crop.height, Number.EPSILON, 1);
  const transform = animated?.transform ?? {
    x: finite(cut.transform?.x, 0),
    y: finite(cut.transform?.y, 0),
    scale: finite(cut.transform?.scale, 1),
    rotateDegrees: finite(cut.transform?.rotate, 0)
  };
  return {
    framing: DEFAULT_VISUAL.framing,
    transform: {
      x: transform.x,
      y: transform.y,
      scale: Math.max(Number.EPSILON, transform.scale),
      rotateDegrees: transform.rotateDegrees
    },
    opacity: clamp(animated?.opacity ?? finite(cut.opacity, 1), 0, 1),
    layerStyle: {
      crop: { x: clamp(crop.x, 0, 1 - width), y: clamp(crop.y, 0, 1 - height), width, height }
    }
  };
}

function motionTransform(transform: ResolvedCutVisual['transform'], motion: MotionVisual): ResolvedCutVisual['transform'] {
  return {
    x: transform.x + motion.dx, y: transform.y + motion.dy,
    scale: transform.scale * motion.scale, rotateDegrees: transform.rotateDegrees + motion.rotate
  };
}

/** Reveal coordinates are relative to the already resolved crop window. */
function motionCrop(
  crop: { x: number; y: number; width: number; height: number },
  reveal: NonNullable<MotionVisual['reveal']>
): typeof crop {
  return {
    x: crop.x + crop.width * reveal.x, y: crop.y + crop.height * reveal.y,
    // Keep downstream geometry nondegenerate; motionOpacity preserves a closed wipe's transparency.
    width: Math.max(Number.EPSILON, crop.width * reveal.w),
    height: Math.max(Number.EPSILON, crop.height * reveal.h)
  };
}

function motionOpacity(opacity: number, motion: MotionVisual): number {
  // Geometry consumers may clamp a zero crop to epsilon. A closed wipe must remain fully transparent.
  return motion.reveal && (motion.reveal.w === 0 || motion.reveal.h === 0) ? 0 : opacity * motion.opacity;
}

function cutMotionVisual(visual: ResolvedCutVisual, motion: MotionVisual | null): ResolvedCutVisual {
  if (!motion) return visual;
  return {
    ...visual,
    transform: motionTransform(visual.transform, motion),
    opacity: motionOpacity(visual.opacity, motion),
    ...(visual.layerStyle && motion.reveal
      ? { layerStyle: { ...visual.layerStyle, crop: motionCrop(visual.layerStyle.crop, motion.reveal) } } : {})
  };
}

function visualAt(
  cut: FrameEngineCut,
  playbackSeconds: number,
  localSeconds: number,
  fps: number,
  adjustLut?: ParsedCubeLut,
  adjustFx?: ResolvedAdjustFx[]
): ResolvedCutVisual {
  const speed = finite(cut.speed, 1) > 0 ? finite(cut.speed, 1) : 1;
  const motion = motionVisualAt(cut.motion, localSeconds, (cut.out - cut.in) / speed, fps);
  if (hasCutLayerStyleVisual(cut)) {
    const visual = cutMotionVisual(layerStyleVisualAt(cut, localSeconds), motion);
    return { ...visual, ...(adjustLut ? { adjustLut } : {}), ...(adjustFx ? { adjustFx } : {}) };
  }
  let framing = DEFAULT_VISUAL.framing;
  const keyframes = cut.framing?.keyframes;
  if (keyframes && keyframes.length > 0) {
    const zoom = interpolateFraming(keyframes, playbackSeconds);
    const width = 1 / zoom.scale;
    const height = 1 / zoom.scale;
    framing = {
      x: clamp(zoom.centerX - width / 2, 0, 1 - width),
      y: clamp(zoom.centerY - height / 2, 0, 1 - height),
      width,
      height,
      ...zoom
    };
  } else if (cut.framing?.crop) {
    const crop = cut.framing.crop;
    const width = clamp(finite(crop.w, 1), Number.EPSILON, 1);
    const height = clamp(finite(crop.h, 1), Number.EPSILON, 1);
    framing = {
      x: clamp(finite(crop.x, 0), 0, 1 - width),
      y: clamp(finite(crop.y, 0), 0, 1 - height),
      width,
      height,
      scale: Math.max(1 / width, 1 / height),
      centerX: clamp(finite(crop.x, 0) + width / 2, 0, 1),
      centerY: clamp(finite(crop.y, 0) + height / 2, 0, 1)
    };
  }
  const visual: ResolvedCutVisual = {
    framing,
    transform: {
      x: finite(cut.transform?.x, 0),
      y: finite(cut.transform?.y, 0),
      scale: Math.max(Number.EPSILON, finite(cut.transform?.scale, 1)),
      rotateDegrees: finite(cut.transform?.rotate, 0)
    },
    opacity: clamp(finite(cut.opacity, 1), 0, 1)
  };
  const composed = cutMotionVisual(visual, motion);
  return { ...composed, ...(adjustLut ? { adjustLut } : {}), ...(adjustFx ? { adjustFx } : {}) };
}

function layerFromPlacement(
  placement: ResolvedCutPlacement,
  cutIndex: number,
  outputSeconds: number,
  sources: TimelineSourceRegistry,
  fps: number
): EvaluationPlan['base'][number] {
  const cut = placement.cut;
  if (!cut.src) throw new Error(`resolved cut ${cutIndex} has no src`);
  const source = sources.get(cut.src);
  const playbackSeconds = playbackSecondsAt(placement, outputSeconds);
  // 出力ローカル秒: freeze で絵が止まっている間も進む（layer-style keyframes の時計）。
  const localSeconds = Math.max(0, outputSeconds - placement.at);
  const visual = visualAt(cut, playbackSeconds, localSeconds, fps, placement.adjustLut, placement.adjustFx);
  const image = stillImageBaseLayer(source, cut.src, `cut-${cutIndex}`, visual);
  if (image) return image;
  if (!source || !('decode' in source)) throw new Error(`no video frame source registered for ${cut.src}`);
  const speed = finite(cut.speed, 1) > 0 ? finite(cut.speed, 1) : 1;
  return {
    id: `cut-${cutIndex}`,
    source,
    sourceTimeUs: Math.round((cut.in + playbackSeconds * speed) * 1e6),
    visual
  };
}

/**
 * 静止画ソースが登録されていればそれを base 層として返す（issue #30）。レジストリの型で判定するので、
 * 呼び出し側（GPU / OSR / プレビュー）が拡張子で CachedStillImageSource を登録した素材だけが対象。
 * 静止画には「ソース時刻」が無く、at / duration / transform / crop / keyframes は動画 cut と同じに効く。
 */
function stillImageBaseLayer(
  source: NativeFrameSource | StillImageSource | undefined,
  src: string,
  id: string,
  visual: ResolvedCutVisual
): EvaluationPlan['base'][number] | null {
  if (!source || 'decode' in source) return null;
  if (!('load' in source)) throw new Error(`no video frame source registered for ${src}`);
  return { kind: 'image', id, image: source, sourceTimeUs: 0, visual };
}

const BLENDS = new Set<ResolvedLayerBlendMode>([
  'normal', 'screen', 'multiply', 'add', 'difference', 'darken', 'lighten', 'overlay', 'hardlight', 'softlight'
]);

const FULL_FRAME_CORNERS = Object.freeze([
  Object.freeze([0, 0]), Object.freeze([1, 0]),
  Object.freeze([0, 1]), Object.freeze([1, 1])
]) as unknown as readonly [
  readonly [number, number], readonly [number, number],
  readonly [number, number], readonly [number, number]
];

type FilterCorners = ReturnType<typeof filterQuadCornersAt>;

function cornersOf(value: unknown): FilterCorners | null {
  if (!value || typeof value !== 'object') return null;
  const corners = (value as { corners?: unknown }).corners;
  return Array.isArray(corners) && corners.length === 4 && corners.every(corner =>
    Array.isArray(corner) && corner.length === 2 && corner.every(Number.isFinite))
    ? corners as unknown as FilterCorners : null;
}

/** Region-filter v0 intentionally ignores easing and matches legacy filterQuadCornersAt. */
export function filterQuadCornersAt(
  layer: Pick<FrameEngineLayer, 'perspective' | 'keyframes'>,
  localT: number
): readonly [
  readonly [number, number], readonly [number, number],
  readonly [number, number], readonly [number, number]
] {
  const points = Array.isArray(layer.keyframes)
    ? layer.keyframes.filter(point => point && Number.isFinite(point.t) && point.t >= 0
      && cornersOf(point.perspective)).slice().sort((a, b) => a.t - b.t)
    : [];
  if (points.length === 0) return cornersOf(layer.perspective) ?? FULL_FRAME_CORNERS;
  if (points.length === 1) return cornersOf(points[0]!.perspective)!;
  if (localT <= points[0]!.t) return cornersOf(points[0]!.perspective)!;
  const last = points[points.length - 1]!;
  if (localT >= last.t) return cornersOf(last.perspective)!;
  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index]!;
    const end = points[index + 1]!;
    if (localT < start.t || localT > end.t) continue;
    const span = end.t - start.t;
    if (!(span > 0)) return cornersOf(end.perspective)!;
    const u = (localT - start.t) / span;
    const startCorners = cornersOf(start.perspective)!;
    const endCorners = cornersOf(end.perspective)!;
    return startCorners.map((corner, cornerIndex) => [
      corner[0] + (endCorners[cornerIndex]![0] - corner[0]) * u,
      corner[1] + (endCorners[cornerIndex]![1] - corner[1]) * u
    ]) as unknown as FilterCorners;
  }
  return cornersOf(last.perspective)!;
}

function validFilter(value: FrameEngineLayer['filter']): value is ResolvedFilter {
  if (!value || typeof value !== 'object') return false;
  if (value.type === 'invert') return true;
  if (value.type === 'saturation') return Number.isFinite(value.value) && value.value >= 0 && value.value <= 3;
  if (value.type === 'lut') return Boolean(value.lut && typeof value.lut === 'object')
    && (value.intensity === undefined || Number.isFinite(value.intensity));
  return false;
}

function resolvedCompositeLayers(
  timeline: ResolvedTimelinePlan,
  timeUs: TimelineTimeUs,
  sources: TimelineSourceRegistry
): EvaluationPlan['layers'] {
  const seconds = timeUs / 1e6;
  const resolved: EvaluationPlan['layers'][number][] = [];
  timeline.layers.forEach((layer, index) => {
    if (!isLayerActiveAt(layer, timeUs, timeline.fps)) return;
    const localSeconds = Math.max(0, seconds - finite(layer.t, 0));
    const id = String(layer.id ?? `layer-${index}`);
    if (layer.kind === 'filter') {
      if (!validFilter(layer.filter)) {
        timeline.warn(`filter layer ${id} has no supported filter; skipping`);
        return;
      }
      resolved.push({
        id,
        kind: 'filter',
        filter: layer.filter,
        corners: filterQuadCornersAt(layer, localSeconds),
        opacity: clamp(finite(layer.opacity, 1), 0, 1)
      });
      return;
    }
    if (!layer.src) {
      timeline.warn(`layer ${id}: src is missing; skipping`);
      return;
    }
    const source = sources.get(layer.src);
    if (!source) throw new Error(`no layer source registered for ${layer.src}`);
    const animated = computeLayerKeyframesVisual(layer.keyframes, localSeconds);
    const staticCrop = layer.crop ?? { x: 0, y: 0, w: 1, h: 1 };
    const staticTransform = layer.transform ?? {};
    const visual = {
      crop: animated?.crop ?? {
        x: clamp(finite(staticCrop.x, 0), 0, 1),
        y: clamp(finite(staticCrop.y, 0), 0, 1),
        width: clamp(finite(staticCrop.w, 1), Number.EPSILON, 1),
        height: clamp(finite(staticCrop.h, 1), Number.EPSILON, 1)
      },
      perspective: animated?.perspective ?? (layer.perspective ?? null),
      transform: animated?.transform ?? {
        x: finite(staticTransform.x, 0), y: finite(staticTransform.y, 0),
        scale: Math.max(Number.EPSILON, finite(staticTransform.scale, 1)),
        rotateDegrees: finite(staticTransform.rotate, 0)
      }
    };
    visual.crop.width = clamp(visual.crop.width, Number.EPSILON, 1);
    visual.crop.height = clamp(visual.crop.height, Number.EPSILON, 1);
    visual.crop.x = clamp(visual.crop.x, 0, 1 - visual.crop.width);
    visual.crop.y = clamp(visual.crop.y, 0, 1 - visual.crop.height);
    const motion = motionVisualAt(layer.motion, localSeconds, layer.duration, timeline.fps);
    let opacity = clamp(animated?.opacity ?? finite(layer.opacity, 1), 0, 1);
    if (motion) {
      visual.transform = motionTransform(visual.transform, motion);
      if (motion.reveal) visual.crop = motionCrop(visual.crop, motion.reveal);
      opacity = motionOpacity(opacity, motion);
    }
    const blend = BLENDS.has(layer.blend ?? 'normal') ? (layer.blend ?? 'normal') : 'normal';
    const adjustLut = timeline.layerAdjustLuts[index];
    const adjustFx = timeline.layerAdjustFx?.[index];
    const common = {
      id, visual,
      blend, opacity,
      ...(adjustLut ? { adjustLut } : {}),
      ...(adjustFx ? { adjustFx } : {})
    };
    if (isStillImageSourcePath(layer.src)) {
      if (layer.mask || layer.kind === 'matte') timeline.warn(`mask ignored for still image layer ${id}`);
      if (!('load' in source)) throw new Error(`no still image source registered for ${layer.src}`);
      resolved.push({ ...common, kind: 'image', image: source, mask: null });
      return;
    }
    if (!('decode' in source)) throw new Error(`no video frame source registered for ${layer.src}`);
    const sourceTimeUs = Math.round(localSeconds * 1e6);
    const maskSrc = layer.mask ?? timeline.maskSources.get(layer.src) ?? null;
    let mask = null;
    if (maskSrc) {
      const maskSource = sources.get(maskSrc);
      if (maskSource && 'decode' in maskSource) {
        mask = { kind: 'greyscale' as const, source: maskSource, sourceTimeUs };
      } else {
        timeline.warn(`no mask source registered for ${maskSrc}; layer ${id} will render without a mask`);
      }
    } else if (layer.kind === 'matte') {
      timeline.warn(`matte layer ${id} has no usable mask; rendering the color layer without a mask`);
    }
    resolved.push({
      ...common,
      kind: mask ? 'matte' : 'video',
      source,
      sourceTimeUs,
      mask
    });
  });
  return resolved;
}

export function evaluationPlanFromResolvedTimeline(
  timeline: ResolvedTimelinePlan,
  timeUs: TimelineTimeUs,
  sources: TimelineSourceRegistry,
  output: EvaluationPlan['output']
): EvaluationPlan {
  const outputSeconds = timeUs / 1e6;
  // One rounding rule for preview and both export paths, independent of source playback.
  const frameIndex = Number.isFinite(timeline.fps) && timeline.fps > 0
    ? Math.max(0, Math.round(outputSeconds * timeline.fps)) : 0;
  const window = timeline.map.transitionWindows.find(candidate =>
    outputSeconds >= candidate.start && outputSeconds <= candidate.end
  );
  if (window) {
    const outgoingIndex = window.outgoing.cutIndex;
    const incomingIndex = window.incoming.cutIndex;
    if (outgoingIndex == null || incomingIndex == null) throw new Error('transition has no source cuts');
    if (!isTransitionType(window.type)) {
      throw new Error(`unsupported transition type: ${window.type}`);
    }
    return {
      timeUs,
      frameIndex,
      base: [
        layerFromPlacement(timeline.cuts[outgoingIndex]!, outgoingIndex, outputSeconds, sources, timeline.fps),
        layerFromPlacement(timeline.cuts[incomingIndex]!, incomingIndex, outputSeconds, sources, timeline.fps)
      ],
      layers: resolvedCompositeLayers(timeline, timeUs, sources),
      transition: {
        type: window.type,
        progress: transitionProgressAt(window, outputSeconds)
      },
      output
    };
  }
  const resolved = outputToSource(timeline.map.segments, outputSeconds);
  const cutIndex = resolved.segment?.cutIndex;
  const base = resolved.segment?.kind === 'src' && cutIndex != null
    ? [layerFromPlacement(timeline.cuts[cutIndex]!, cutIndex, outputSeconds, sources, timeline.fps)]
    : [];
  return { timeUs, frameIndex, base, layers: resolvedCompositeLayers(timeline, timeUs, sources), transition: { type: 'hard-cut', progress: 0 }, output };
}

/** Backward-compatible hard-cut adapter for callers that already own a TimelineMapResult. */
export function evaluationPlanFromTimelineMap(
  timelineMap: TimelineMapResult,
  timeUs: TimelineTimeUs,
  sources: TimelineSourceRegistry,
  output: EvaluationPlan['output']
): EvaluationPlan {
  const outputSeconds = timeUs / 1e6;
  const resolved = outputToSource(timelineMap.segments, outputSeconds);
  const base = resolved.segment?.kind === 'src' && resolved.sourceT != null
    ? [legacyLayerFromSegment(resolved.segment, resolved.sourceT, sources)]
    : [];
  return { timeUs, base, layers: [], transition: { type: 'hard-cut', progress: 0 }, output };
}

function legacyLayerFromSegment(
  segment: TimelineSegment,
  sourceSeconds: number,
  sources: TimelineSourceRegistry
): EvaluationPlan['base'][number] {
  if (!segment.src) throw new Error(`resolved cut ${segment.cutIndex ?? 'unknown'} has no src`);
  const source = sources.get(segment.src);
  const image = stillImageBaseLayer(source, segment.src, `cut-${segment.cutIndex ?? 'unknown'}`, DEFAULT_VISUAL);
  if (image) return image;
  if (!source || !('decode' in source)) throw new Error(`no video frame source registered for ${segment.src}`);
  return {
    id: `cut-${segment.cutIndex ?? 'unknown'}`,
    source,
    sourceTimeUs: Math.round(sourceSeconds * 1e6),
    visual: DEFAULT_VISUAL
  };
}
