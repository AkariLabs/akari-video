import type { EvaluationPlan } from '../types.js';
import {
  evaluationPlanFromResolvedTimeline,
  type ResolvedTimelinePlan,
  type TimelineSourceRegistry,
} from '../timeline/plan.js';

export interface PreviewSchedulerSession {
  readonly id: string;
  warmup(nearStartUs: number, frameDurationUs?: number): Promise<number>;
}

export interface PreviewSchedulerPool {
  getSession(streamId?: string): Promise<PreviewSchedulerSession>;
  prepareHeader?(): Promise<void>;
  releaseSession?(streamId: string): boolean;
}

export interface PreviewSchedulerLookahead {
  prefetch(timeUs: number, request?: { streamId: string }): Promise<void>;
}

export interface PreviewSchedulerOptions {
  maxLiveDecoders?: number;
  minLeadInSeconds?: number;
  maxLeadInSeconds?: number;
  initialLeadInSeconds?: number;
  prefetchFrames?: number;
  headerConcurrency?: number;
  now?: () => number;
}

export interface PreviewSchedulerState {
  leadInSeconds: number;
  liveDecoders: number;
  maxLiveDecoders: number;
  evictions: number;
  decoderLimitHits: number;
  coverage: { warmed: number; needed: number; boundarySeconds: number | null };
}

export interface PreviewScheduler {
  notePresented(timeUs: number, options?: { reason?: 'playback' | 'seek' }): void;
  primeHeaders(): void;
  isWarmed(streamId: string): boolean;
  state(): PreviewSchedulerState;
  reset(): void;
  dispose(): void;
}

export interface PreviewSchedulerMetrics {
  warmupMs: number[];
  onWarmed?(streamId: string, elapsedMs: number): void;
  onChanged?(): void;
  onWarning?(message: string): void;
}

export interface CreatePreviewSchedulerOptions {
  timeline: ResolvedTimelinePlan;
  sources: TimelineSourceRegistry;
  output: EvaluationPlan['output'];
  fps: number;
  pools: ReadonlyMap<string, PreviewSchedulerPool>;
  lookahead: ReadonlyMap<string, PreviewSchedulerLookahead>;
  metrics: PreviewSchedulerMetrics;
  options?: PreviewSchedulerOptions;
}

interface Requirement {
  sourceId: string;
  streamId: string;
  sourceTimeUs: number;
  key: string;
  kind: 'base' | 'layer' | 'mask';
}

interface LiveDecoder {
  sourceId: string;
  streamId: string;
  nextUseSeconds: number;
}

const DEFAULT_MAX_LIVE_DECODERS = 8;
const DEFAULT_MIN_LEAD_IN_SECONDS = 1.5;
const DEFAULT_MAX_LEAD_IN_SECONDS = 4;
const DEFAULT_INITIAL_LEAD_IN_SECONDS = 2.5;
const DEFAULT_PREFETCH_FRAMES = 3;
const DEFAULT_HEADER_CONCURRENCY = 2;

function finitePositive(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

function integerAtLeastOne(value: number | undefined, fallback: number): number {
  return Math.max(1, Math.floor(finitePositive(value, fallback)));
}

function percentile90(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.9) - 1)] ?? 0;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

export function createPreviewScheduler({
  timeline,
  sources,
  output,
  fps: requestedFps,
  pools,
  lookahead,
  metrics,
  options = {},
}: CreatePreviewSchedulerOptions): PreviewScheduler {
  const fps = finitePositive(requestedFps, finitePositive(timeline.fps, 30));
  const maxLiveDecoders = integerAtLeastOne(options.maxLiveDecoders, DEFAULT_MAX_LIVE_DECODERS);
  const minLeadInSeconds = finitePositive(options.minLeadInSeconds, DEFAULT_MIN_LEAD_IN_SECONDS);
  const maxLeadInSeconds = Math.max(
    minLeadInSeconds,
    finitePositive(options.maxLeadInSeconds, DEFAULT_MAX_LEAD_IN_SECONDS),
  );
  const initialLeadInSeconds = clamp(
    finitePositive(options.initialLeadInSeconds, DEFAULT_INITIAL_LEAD_IN_SECONDS),
    minLeadInSeconds,
    maxLeadInSeconds,
  );
  const prefetchFrames = integerAtLeastOne(options.prefetchFrames, DEFAULT_PREFETCH_FRAMES);
  const headerConcurrency = integerAtLeastOne(options.headerConcurrency, DEFAULT_HEADER_CONCURRENCY);
  const now = options.now ?? (() => performance.now());
  const totalDurationUs = Math.round(Math.max(0, timeline.totalDuration) * 1e6);

  const boundaries = [...timeline.cuts.map(placement => placement.at), ...timeline.layers
    .filter(layer => Boolean(layer.src))
    .map(layer => layer.t)]
    .filter(value => Number.isFinite(value) && value >= 0 && value <= timeline.totalDuration)
    .sort((left, right) => left - right)
    .filter((value, index, values) => index === 0 || value !== values[index - 1]);

  const layerSources = new Map<string, { src: string; mask: string | null }>();
  timeline.layers.forEach((layer, index) => {
    if (!layer.src) return;
    const id = String(layer.id ?? `layer-${index}`);
    layerSources.set(id, {
      src: layer.src,
      mask: layer.mask ?? timeline.maskSources.get(layer.src) ?? null,
    });
  });

  const headerSourceUses = new Map<string, { firstUseSeconds: number; order: number }>();
  let sourceDeclarationOrder = 0;
  const noteHeaderSource = (sourceId: string | null | undefined, firstUseSeconds: number) => {
    const order = sourceDeclarationOrder++;
    if (!sourceId || !pools.has(sourceId)) return;
    const normalizedTime = Number.isFinite(firstUseSeconds)
      ? Math.max(0, firstUseSeconds)
      : Number.POSITIVE_INFINITY;
    const existing = headerSourceUses.get(sourceId);
    if (!existing || normalizedTime < existing.firstUseSeconds) {
      headerSourceUses.set(sourceId, { firstUseSeconds: normalizedTime, order });
    }
  };
  for (const placement of timeline.cuts) {
    noteHeaderSource(placement.cut.src, placement.at);
  }
  for (const layer of timeline.layers) {
    noteHeaderSource(layer.src, layer.t);
    if (layer.src) {
      noteHeaderSource(layer.mask ?? timeline.maskSources.get(layer.src) ?? null, layer.t);
    }
  }
  for (const maskSource of timeline.maskSources.values()) {
    noteHeaderSource(maskSource, Number.POSITIVE_INFINITY);
  }
  const headerQueue = [...headerSourceUses.entries()]
    .sort((left, right) => left[1].firstUseSeconds - right[1].firstUseSeconds
      || left[1].order - right[1].order)
    .map(([sourceId]) => [sourceId, pools.get(sourceId)!] as const)
    .filter(([, pool]) => typeof pool.prepareHeader === 'function');

  const boundaryRequirements = new Map<number, readonly Requirement[]>();
  const warned = new Set<string>();
  const warmed = new Set<string>();
  const inFlight = new Set<string>();
  const live = new Map<string, LiveDecoder>();
  const headerMs: number[] = [];
  let latestTimeSeconds = 0;
  let evictions = 0;
  let decoderLimitHits = 0;
  let headersRequested = false;
  let headerWorkersStarted = false;
  let headerLaunchQueued = false;
  let firstPresentationNoted = false;
  let disposed = false;

  const warnOnce = (message: string) => {
    if (warned.has(message)) return;
    warned.add(message);
    metrics.onWarning?.(message);
  };

  const requirementsFromPlan = (plan: EvaluationPlan): readonly Requirement[] => {
    const requirements: Requirement[] = [];
    const seen = new Set<string>();
    const append = (
      sourceId: string | null | undefined,
      streamId: string,
      sourceTimeUs: number,
      kind: Requirement['kind'],
    ) => {
      if (!sourceId || !pools.has(sourceId)) return;
      const key = `${sourceId}::${streamId}`;
      if (seen.has(key)) return;
      seen.add(key);
      requirements.push({ sourceId, streamId, sourceTimeUs, key, kind });
    };
    for (const base of plan.base) {
      if (base.kind === 'image') continue;
      const cutIndex = Number(base.id.slice('cut-'.length));
      append(timeline.cuts[cutIndex]?.cut.src, base.id, base.sourceTimeUs, 'base');
    }
    for (const layer of plan.layers) {
      if (layer.kind === 'image') continue;
      const declared = layerSources.get(layer.id);
      append(declared?.src, `layer-${layer.id}`, layer.sourceTimeUs ?? 0, 'layer');
      if (layer.mask) {
        append(declared?.mask, `layer-${layer.id}-mask`, layer.mask.sourceTimeUs, 'mask');
      }
    }
    return requirements;
  };

  const requirementsAtTime = (timeUs: number, warningContext: string): readonly Requirement[] => {
    try {
      return requirementsFromPlan(evaluationPlanFromResolvedTimeline(timeline, timeUs, sources, output));
    } catch (error) {
      warnOnce(`${warningContext}: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }
  };

  const requirementsAtBoundary = (boundarySeconds: number): readonly Requirement[] => {
    const cached = boundaryRequirements.get(boundarySeconds);
    if (cached) return cached;
    const timeUs = Math.min(
      totalDurationUs,
      Math.round((boundarySeconds + 1 / fps) * 1e6),
    );
    const requirements = requirementsAtTime(timeUs, `preview warmup plan failed at ${boundarySeconds}s`);
    boundaryRequirements.set(boundarySeconds, requirements);
    return requirements;
  };

  const leadInSeconds = (): number => {
    if (metrics.warmupMs.length === 0) return initialLeadInSeconds;
    const recentWarmups = metrics.warmupMs.slice(-20);
    return clamp(
      percentile90(recentWarmups) * 1.5 / 1000 + percentile90(headerMs) / 1000,
      minLeadInSeconds,
      maxLeadInSeconds,
    );
  };

  const refreshNextUses = (currentKeys: ReadonlySet<string>) => {
    for (const [key, entry] of live) {
      if (currentKeys.has(key)) {
        entry.nextUseSeconds = latestTimeSeconds;
        continue;
      }
      if (entry.nextUseSeconds <= latestTimeSeconds) {
        entry.nextUseSeconds = Number.POSITIVE_INFINITY;
      }
    }
  };

  const evictFor = (incoming: Requirement, currentKeys: ReadonlySet<string>): boolean => {
    if (live.has(incoming.key) || live.size < maxLiveDecoders) return true;
    decoderLimitHits += 1;
    const candidates = [...live.entries()]
      .filter(([key]) => key !== incoming.key && !currentKeys.has(key))
      .sort((left, right) => right[1].nextUseSeconds - left[1].nextUseSeconds);
    for (const [key, candidate] of candidates) {
      const pool = pools.get(candidate.sourceId);
      const didRelease = pool?.releaseSession?.(candidate.streamId) === true;
      live.delete(key);
      warmed.delete(key);
      inFlight.delete(key);
      if (didRelease) evictions += 1;
      metrics.onChanged?.();
      return true;
    }
    metrics.onChanged?.();
    return false;
  };

  const trimToDecoderLimit = (currentKeys: ReadonlySet<string>) => {
    while (live.size > maxLiveDecoders) {
      decoderLimitHits += 1;
      const candidates = [...live.entries()]
        .filter(([key]) => !currentKeys.has(key))
        .sort((left, right) => right[1].nextUseSeconds - left[1].nextUseSeconds);
      let released = false;
      for (const [key, candidate] of candidates) {
        const didRelease = pools.get(candidate.sourceId)?.releaseSession?.(candidate.streamId) === true;
        live.delete(key);
        warmed.delete(key);
        inFlight.delete(key);
        if (didRelease) evictions += 1;
        released = true;
        break;
      }
      if (!released) break;
    }
  };

  const startWarmup = (
    requirement: Requirement,
    boundarySeconds: number,
    currentKeys: ReadonlySet<string>,
  ) => {
    if (warmed.has(requirement.key) || inFlight.has(requirement.key)) return;
    if (!evictFor(requirement, currentKeys)) return;
    const pool = pools.get(requirement.sourceId);
    if (!pool) return;
    live.set(requirement.key, {
      sourceId: requirement.sourceId,
      streamId: requirement.streamId,
      nextUseSeconds: boundarySeconds,
    });
    inFlight.add(requirement.key);
    metrics.onChanged?.();
    void pool.getSession(requirement.streamId)
      .then(session => session.warmup(requirement.sourceTimeUs, 1e6 / fps))
      .then(elapsedMs => {
        if (disposed) return;
        inFlight.delete(requirement.key);
        if (!live.has(requirement.key)) return;
        warmed.add(requirement.key);
        metrics.warmupMs.push(elapsedMs);
        metrics.onWarmed?.(requirement.streamId, elapsedMs);
        metrics.onChanged?.();
      }, error => {
        inFlight.delete(requirement.key);
        live.delete(requirement.key);
        warnOnce(`warmup ${requirement.streamId}: ${error instanceof Error ? error.message : String(error)}`);
        metrics.onChanged?.();
      });
  };

  const notePresented = (
    timeUs: number,
    presentation: { reason?: 'playback' | 'seek' } = {},
  ) => {
    if (disposed) return;
    firstPresentationNoted = true;
    if (headersRequested && !headerWorkersStarted && !headerLaunchQueued) {
      headerLaunchQueued = true;
      queueMicrotask(() => {
        headerLaunchQueued = false;
        startHeaderWorkers();
      });
    }
    const safeTimeUs = Math.max(0, Math.min(totalDurationUs, Math.round(timeUs)));
    latestTimeSeconds = safeTimeUs / 1e6;

    const current = requirementsAtTime(safeTimeUs, `preview current plan failed at ${safeTimeUs}us`);
    const currentKeys = new Set(current.map(requirement => requirement.key));
    for (const requirement of current) {
      live.set(requirement.key, {
        sourceId: requirement.sourceId,
        streamId: requirement.streamId,
        nextUseSeconds: latestTimeSeconds,
      });
    }
    refreshNextUses(currentKeys);
    trimToDecoderLimit(currentKeys);

    for (let offset = 1; offset <= prefetchFrames; offset += 1) {
      const futureUs = Math.min(totalDurationUs, safeTimeUs + Math.round(offset * 1e6 / fps));
      const requirements = requirementsAtTime(futureUs, `preview prefetch plan failed at ${futureUs}us`);
      for (const requirement of requirements) {
        if ((presentation.reason ?? 'playback') === 'seek' && requirement.kind !== 'base') continue;
        if (!evictFor(requirement, currentKeys)) continue;
        live.set(requirement.key, {
          sourceId: requirement.sourceId,
          streamId: requirement.streamId,
          nextUseSeconds: futureUs / 1e6,
        });
        void lookahead.get(requirement.sourceId)
          ?.prefetch(requirement.sourceTimeUs, { streamId: requirement.streamId })
          .catch(() => undefined);
      }
    }

    if ((presentation.reason ?? 'playback') === 'seek') {
      metrics.onChanged?.();
      return;
    }

    const leadIn = leadInSeconds();
    for (const boundary of boundaries) {
      if (boundary <= latestTimeSeconds || boundary > latestTimeSeconds + leadIn) continue;
      for (const requirement of requirementsAtBoundary(boundary)) {
        startWarmup(requirement, boundary, currentKeys);
      }
    }
    metrics.onChanged?.();
  };

  const state = (): PreviewSchedulerState => {
    const nextBoundary = boundaries.find(boundary => boundary > latestTimeSeconds) ?? null;
    const requirements = nextBoundary == null ? [] : requirementsAtBoundary(nextBoundary);
    return {
      leadInSeconds: leadInSeconds(),
      liveDecoders: live.size,
      maxLiveDecoders,
      evictions,
      decoderLimitHits,
      coverage: {
        warmed: requirements.filter(requirement => warmed.has(requirement.key)).length,
        needed: requirements.length,
        boundarySeconds: nextBoundary,
      },
    };
  };

  function startHeaderWorkers(): void {
    if (disposed || headerWorkersStarted || !headersRequested || !firstPresentationNoted) return;
    headerWorkersStarted = true;
    let cursor = 0;
    const worker = async () => {
      while (!disposed) {
        const item = headerQueue[cursor++];
        if (!item) return;
        const [sourceId, pool] = item;
        const started = now();
        try {
          await pool.prepareHeader?.();
          headerMs.push(Math.max(0, now() - started));
        } catch (error) {
          warnOnce(`prepare header ${sourceId}: ${error instanceof Error ? error.message : String(error)}`);
        }
        metrics.onChanged?.();
      }
    };
    for (let index = 0; index < Math.min(headerConcurrency, headerQueue.length); index += 1) void worker();
  }

  const primeHeaders = () => {
    if (disposed || headersRequested) return;
    headersRequested = true;
    if (firstPresentationNoted && !headerLaunchQueued) {
      headerLaunchQueued = true;
      queueMicrotask(() => {
        headerLaunchQueued = false;
        startHeaderWorkers();
      });
    }
  };

  const reset = () => {
    warmed.clear();
    inFlight.clear();
    live.clear();
    latestTimeSeconds = 0;
    evictions = 0;
    decoderLimitHits = 0;
    metrics.onChanged?.();
  };

  return {
    notePresented,
    primeHeaders,
    isWarmed: streamId => [...warmed].some(key => key.endsWith(`::${streamId}`)),
    state,
    reset,
    dispose() {
      if (disposed) return;
      disposed = true;
      reset();
    },
  };
}
