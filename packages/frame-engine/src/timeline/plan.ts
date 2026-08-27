import {
  buildTimelineMap,
  computeCutTrackSegments,
  outputToSource,
  transitionProgressAt
} from '@akari-video/edit-store';
import type { EditCut, TimelineMapResult, TimelineSegment } from '@akari-video/edit-store';
import type {
  EvaluationPlan,
  NativeFrameSource,
  ResolvedCutVisual,
  TimelineTimeUs
} from '../types.js';

export type TimelineSourceRegistry = ReadonlyMap<string, NativeFrameSource>;

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
}

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
  options?: Parameters<typeof buildTimelineMap>[1]
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
  const map = buildTimelineMap(virtualCuts, options);
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
  return { map, cuts: placements, totalDuration: map.totalDuration };
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
): EvaluationPlan['layers'][number] {
  const cut = placement.cut;
  if (!cut.src) throw new Error(`resolved cut ${cutIndex} has no src`);
  const source = sources.get(cut.src);
  if (!source) throw new Error(`no frame source registered for ${cut.src}`);
  const playbackSeconds = playbackSecondsAt(placement, outputSeconds);
  const speed = finite(cut.speed, 1) > 0 ? finite(cut.speed, 1) : 1;
  return {
    id: `cut-${cutIndex}`,
    source,
    sourceTimeUs: Math.round((cut.in + playbackSeconds * speed) * 1e6),
    visual: visualAt(cut, playbackSeconds)
  };
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
    if (!['dissolve', 'fade-black', 'fade-white', 'reveal-down', 'reveal-up'].includes(window.type)) {
      throw new Error(`unsupported transition type: ${window.type}`);
    }
    return {
      timeUs,
      layers: [
        layerFromPlacement(timeline.cuts[outgoingIndex]!, outgoingIndex, outputSeconds, sources),
        layerFromPlacement(timeline.cuts[incomingIndex]!, incomingIndex, outputSeconds, sources)
      ],
      transition: {
        type: window.type as 'dissolve' | 'fade-black' | 'fade-white' | 'reveal-down' | 'reveal-up',
        progress: transitionProgressAt(window, outputSeconds)
      },
      output
    };
  }
  const resolved = outputToSource(timeline.map.segments, outputSeconds);
  const cutIndex = resolved.segment?.cutIndex;
  const layers = resolved.segment?.kind === 'src' && cutIndex != null
    ? [layerFromPlacement(timeline.cuts[cutIndex]!, cutIndex, outputSeconds, sources)]
    : [];
  return { timeUs, layers, transition: { type: 'hard-cut', progress: 0 }, output };
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
  const layers = resolved.segment?.kind === 'src' && resolved.sourceT != null
    ? [legacyLayerFromSegment(resolved.segment, resolved.sourceT, sources)]
    : [];
  return { timeUs, layers, transition: { type: 'hard-cut', progress: 0 }, output };
}

function legacyLayerFromSegment(
  segment: TimelineSegment,
  sourceSeconds: number,
  sources: TimelineSourceRegistry
): EvaluationPlan['layers'][number] {
  if (!segment.src) throw new Error(`resolved cut ${segment.cutIndex ?? 'unknown'} has no src`);
  const source = sources.get(segment.src);
  if (!source) throw new Error(`no frame source registered for ${segment.src}`);
  return {
    id: `cut-${segment.cutIndex ?? 'unknown'}`,
    source,
    sourceTimeUs: Math.round(sourceSeconds * 1e6),
    visual: DEFAULT_VISUAL
  };
}
