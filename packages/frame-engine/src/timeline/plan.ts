import {
  buildTimelineMap,
  computeCutTrackSegments,
  DEFAULT_CUT_ADJACENCY_FPS,
  isStillImageSourcePath,
  outputToSource,
  transitionProgressAt
} from '@akari-video/edit-store';
import { isTransitionType } from '@akari-video/edit-store';
import type { EditCut, TimelineMapResult, TimelineSegment } from '@akari-video/edit-store';
import type {
  EvaluationPlan,
  NativeFrameSource,
  ResolvedCutVisual,
  ResolvedLayerBlendMode,
  StillImageSource,
  TimelineTimeUs
} from '../types.js';
import { computeLayerKeyframesVisual, type LayerKeyframe } from './layer-visual.js';

export type TimelineSourceRegistry = ReadonlyMap<string, NativeFrameSource | StillImageSource>;

export interface CutFramingKeyframe {
  t: number;
  scale: number;
  cx?: number;
  cy?: number;
}

export interface FrameEngineCut extends Omit<EditCut, 'transitionOut'> {
  transitionOut?: EditCut['transitionOut'];
  transition_out?: EditCut['transitionOut'];
  framing?: {
    crop?: { x: number; y: number; w: number; h: number };
    keyframes?: readonly CutFramingKeyframe[];
  };
  freeze?: { at_sec: number; duration_sec: number } | null;
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
  opacity?: number;
  blend?: ResolvedLayerBlendMode;
}

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
}

export interface ResolvedTimelinePlan {
  readonly map: TimelineMapResult;
  readonly cuts: readonly ResolvedCutPlacement[];
  readonly totalDuration: number;
  readonly layers: readonly FrameEngineLayer[];
  readonly maskSources: ReadonlyMap<string, string | null>;
  readonly warn: (message: string) => void;
  readonly fps: number;
}

/**
 * cuts[].track の z 既定。v2 の tracks[] は配列順 = z 順（後ろが前面）で、内部モデルは cuts の
 * track ref を配列順に採番するため、番号が大きいトラックほど前面に置く。edit-store の
 * buildTimelineMap 既定（-track = 番号が小さいほど前面）は逆向きで、GPU / OSR の書き出しが
 * 2 本目以降の visual トラックの映像クリップを無言で落としていた（issue #31）。シェルの
 * プレビューは同じ向きを明示しており（akari-preview-open-handler.ts）、呼び出し側が options.trackZ を
 * 渡せば従来どおりそちらが優先される。
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

function normalizeTransition(cut: FrameEngineCut): EditCut['transitionOut'] {
  return cut.transition_out ?? cut.transitionOut;
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
  const { layers = [], maskResolver, onWarning, ...timelineOptions } = options;
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
    return {
      cut,
      at: segment.at,
      end: segment.end,
      playbackDuration,
      freezeAt,
      freezeDuration
    };
  });
  const visibleLayers = layers.filter(layer => layer.kind !== 'filter');
  const warned = new Set<string>();
  const warn = (message: string) => {
    if (warned.has(message)) return;
    warned.add(message);
    onWarning?.(message);
  };
  const maskSources = new Map<string, string | null>();
  for (const layer of visibleLayers) {
    if (!layer.src || layer.mask !== undefined || maskSources.has(layer.src)) continue;
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

function visualAt(cut: FrameEngineCut, playbackSeconds: number): ResolvedCutVisual {
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
  return {
    framing,
    transform: {
      x: finite(cut.transform?.x, 0),
      y: finite(cut.transform?.y, 0),
      scale: Math.max(Number.EPSILON, finite(cut.transform?.scale, 1)),
      rotateDegrees: finite(cut.transform?.rotate, 0)
    },
    opacity: clamp(finite(cut.opacity, 1), 0, 1)
  };
}

function layerFromPlacement(
  placement: ResolvedCutPlacement,
  cutIndex: number,
  outputSeconds: number,
  sources: TimelineSourceRegistry
): EvaluationPlan['base'][number] {
  const cut = placement.cut;
  if (!cut.src) throw new Error(`resolved cut ${cutIndex} has no src`);
  const source = sources.get(cut.src);
  const playbackSeconds = playbackSecondsAt(placement, outputSeconds);
  const image = stillImageBaseLayer(source, cut.src, `cut-${cutIndex}`, visualAt(cut, playbackSeconds));
  if (image) return image;
  if (!source || !('decode' in source)) throw new Error(`no video frame source registered for ${cut.src}`);
  const speed = finite(cut.speed, 1) > 0 ? finite(cut.speed, 1) : 1;
  return {
    id: `cut-${cutIndex}`,
    source,
    sourceTimeUs: Math.round((cut.in + playbackSeconds * speed) * 1e6),
    visual: visualAt(cut, playbackSeconds)
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

function resolvedCompositeLayers(
  timeline: ResolvedTimelinePlan,
  timeUs: TimelineTimeUs,
  sources: TimelineSourceRegistry
): EvaluationPlan['layers'] {
  const seconds = timeUs / 1e6;
  const resolved: EvaluationPlan['layers'][number][] = [];
  timeline.layers.forEach((layer, index) => {
    if (!isLayerActiveAt(layer, timeUs, timeline.fps) || !layer.src) return;
    const source = sources.get(layer.src);
    if (!source) throw new Error(`no layer source registered for ${layer.src}`);
    const localSeconds = Math.max(0, seconds - finite(layer.t, 0));
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
    const blend = BLENDS.has(layer.blend ?? 'normal') ? (layer.blend ?? 'normal') : 'normal';
    const id = String(layer.id ?? `layer-${index}`);
    const common = {
      id, visual,
      blend, opacity: clamp(finite(layer.opacity, 1), 0, 1)
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
      base: [
        layerFromPlacement(timeline.cuts[outgoingIndex]!, outgoingIndex, outputSeconds, sources),
        layerFromPlacement(timeline.cuts[incomingIndex]!, incomingIndex, outputSeconds, sources)
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
    ? [layerFromPlacement(timeline.cuts[cutIndex]!, cutIndex, outputSeconds, sources)]
    : [];
  return { timeUs, base, layers: resolvedCompositeLayers(timeline, timeUs, sources), transition: { type: 'hard-cut', progress: 0 }, output };
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
