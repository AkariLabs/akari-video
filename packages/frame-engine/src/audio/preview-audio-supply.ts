import {
  buildWebAudioSchedule,
  type WebAudioDecodedItem,
} from '@akari-video/edit-store';
import * as EditStoreKernel from '@akari-video/edit-store';

export interface PreviewSpeechCut {
  in: number;
  out: number;
  src?: string;
  speed?: number;
  at?: number;
  track?: number;
  id?: string;
  freeze?: { at_sec?: unknown; duration_sec?: unknown } | null;
  gain_db?: unknown;
  gainDb?: unknown;
  volume_db?: unknown;
  [key: string]: unknown;
}

export const projectSpeechDeclarations = (EditStoreKernel as unknown as {
  projectSpeechDeclarations: (
    values: readonly PreviewSpeechCut[],
    settings: { fps: number },
  ) => Array<Omit<PreviewSpeechDeclaration, 'url'>>;
}).projectSpeechDeclarations;

interface PreviewGainEvent {
  offsetSec: number;
  value: number;
  method: 'set' | 'linear';
}

interface PreviewScheduledItem {
  kind: 'bgm' | 'sfx' | 'narration' | 'speech';
  id: string;
  track: number;
  timelineStartSec: number;
  timelineEndSec: number;
  delaySec: number;
  sourceOffsetSec: number;
  durationSec: number;
  playbackRate: number;
  sourceDurationSec: number;
  loop: boolean;
  gainDb: number;
  gainEvents: PreviewGainEvent[];
  duckingEvents: PreviewGainEvent[];
}

interface PreviewScheduleDeclaration {
  bgm?: WebAudioDecodedItem;
  sfx?: WebAudioDecodedItem[];
  narration?: WebAudioDecodedItem[];
  speech?: PreviewSpeechDeclaration[];
}

interface PreviewScheduleResult {
  startAtSec: number;
  items: PreviewScheduledItem[];
  warnings: string[];
}

export type PreviewScheduleBuilder = (input: {
  timelineDurationSec: number;
  startAtSec: number;
  audio?: PreviewScheduleDeclaration;
}) => PreviewScheduleResult;

export interface PreviewAudioDeclaration {
  kind: 'bgm' | 'sfx' | 'narration';
  id: string;
  url: string;
  spec: WebAudioDecodedItem;
}

export interface PreviewSpeechDeclaration {
  id: string;
  src: string;
  atSec: number;
  durationSec: number;
  inSec: number;
  outSec: number;
  speed: number;
  gainDb?: number;
  track?: number;
  materialDurationSec: number;
  url: string;
  atempo?: {
    path: string;
    durationSec: number;
    generatedMs?: number;
  };
}

export interface PreviewAudioSupplyOptions {
  timelineDurationSec: number;
  declarations?: readonly PreviewAudioDeclaration[];
  speech?: readonly PreviewSpeechDeclaration[];
  contextFactory?: () => AudioContext;
  fetchImpl?: typeof fetch;
  onWarning?: (message: string, reason?: unknown) => void;
  decodeCacheBytes?: number;
  /** 決定論テスト用。製品経路は edit-store の共有予定表を使う。 */
  scheduleBuilder?: PreviewScheduleBuilder;
  /** false で shell の明示 pause/playFrom 経路、数値で Web UI の watchdog を使う。 */
  pauseWatchdogMs?: number | false;
}

export interface PreviewAudioSupplyDebug {
  contextState: AudioContextState | 'unavailable';
  renderedTimelineSec: number | null;
  audioPositionSec: number | null;
  driftMs: number | null;
  playing: boolean;
  scheduled: {
    startAtSec: number | null;
    itemCount: number;
    bgm: number;
    sfx: number;
    narration: number;
    speech: number;
  };
  speechDecode: {
    sources: number;
    okSources: number;
    skippedSources: number;
    totalMs: number;
    bytes: number;
    perSource: Array<{ src: string; ms: number; durationSec: number; bytes: number; ok: boolean }>;
  };
  speech: {
    atempo: {
      items: number;
      generatedMs: number;
    };
  };
}

export interface PreviewAudioSupply {
  playFrom(seconds: number): void;
  position(fallbackSeconds: number): number;
  playbackTime(fallbackSeconds: number): number;
  seek(seconds: number, continuePlaying?: boolean): void;
  pause(): void;
  noteRendered(seconds: number): void;
  debug(): PreviewAudioSupplyDebug;
  dispose(): void;
}

interface DecodedRegular extends PreviewAudioDeclaration {
  buffer: AudioBuffer;
  durationSec: number;
}

interface SpeechCacheEntry {
  promise: Promise<AudioBuffer | null>;
  lastUsed: number;
  bytes: number;
}

interface ResolvedSpeechBuffer {
  buffer: AudioBuffer;
  atempo: boolean;
}

interface ActiveSource {
  source: AudioBufferSourceNode;
  gains: GainNode[];
}

const DEFAULT_DECODE_CACHE_BYTES = 60 * 1024 * 1024;

export function createPreviewAudioSupply(options: PreviewAudioSupplyOptions): PreviewAudioSupply {
  const timelineDurationSec = finitePositive(options.timelineDurationSec) ? options.timelineDurationSec : 0;
  const declarations = [...(options.declarations ?? [])];
  const speech = [...(options.speech ?? [])];
  const sourceOrder = [...new Set(speech.map(item => item.src))];
  const fetchImpl = options.fetchImpl ?? globalThis.fetch?.bind(globalThis);
  const scheduleBuilder = options.scheduleBuilder
    ?? (buildWebAudioSchedule as unknown as PreviewScheduleBuilder);
  const warn = options.onWarning ?? ((message: string, reason?: unknown) => console.warn(message, reason));
  const cacheLimit = finitePositive(options.decodeCacheBytes)
    ? options.decodeCacheBytes as number : DEFAULT_DECODE_CACHE_BYTES;
  const watchdogMs = options.pauseWatchdogMs === false
    ? false : finitePositive(options.pauseWatchdogMs) ? options.pauseWatchdogMs as number : false;
  let context: AudioContext | null = null;
  if (timelineDurationSec > 0 && (declarations.length > 0 || speech.length > 0)) {
    try {
      context = options.contextFactory
        ? options.contextFactory()
        : new (globalThis.AudioContext || (globalThis as typeof globalThis & { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext!)();
    } catch (reason) {
      warn('[frame-engine] Web Audio unavailable; keeping wall-clock playback', reason);
    }
  }

  let regularDecoded: DecodedRegular[] = [];
  let regularLoadPromise: Promise<void> | null = null;
  const speechCache = new Map<string, SpeechCacheEntry>();
  const speechFailures = new Set<string>();
  const warnedSpeech = new Set<string>();
  const atempoCache = new Map<string, Promise<AudioBuffer | null>>();
  const warnedAtempo = new Set<string>();
  const speechMetrics = new Map<string, {
    src: string; ms: number; durationSec: number; bytes: number; ok: boolean;
  }>();
  let cacheBytes = 0;
  let lruClock = 0;
  let active: ActiveSource[] = [];
  let generation = 0;
  let starting = false;
  let playing = false;
  let anchorTimelineSec = 0;
  let anchorContextSec = 0;
  let latestRequestedSec = 0;
  let pauseTimer: ReturnType<typeof setTimeout> | null = null;
  let lastRenderedTimelineSec: number | null = null;
  let lastAudioPositionAtRenderSec: number | null = null;
  let lastSchedule: PreviewScheduledItem[] = [];
  let lastAtempoIds = new Set<string>();

  const clamp = (seconds: number): number => Math.max(
    0,
    Math.min(Number.isFinite(seconds) ? seconds : 0, timelineDurationSec),
  );

  const audioPosition = (): number => context && playing
    ? clamp(anchorTimelineSec + Math.max(0, context.currentTime - anchorContextSec))
    : latestRequestedSec;

  const stopSources = (): void => {
    const sources = active;
    active = [];
    for (const item of sources) {
      item.source.onended = null;
      try { item.source.stop(); } catch {}
      try { item.source.disconnect(); } catch {}
      for (const gain of item.gains) try { gain.disconnect(); } catch {}
    }
  };

  const loadRegular = (): Promise<void> => {
    if (regularLoadPromise) return regularLoadPromise;
    if (!context || !fetchImpl) return Promise.resolve();
    regularLoadPromise = Promise.all(declarations.map(async declaration => {
      try {
        const response = await fetchImpl(declaration.url);
        if (!response.ok) throw new Error(`fetch status=${response.status}`);
        const buffer = await context!.decodeAudioData(await response.arrayBuffer());
        if (!(buffer.duration > 0)) throw new Error('decoded duration is invalid');
        return { ...declaration, buffer, durationSec: buffer.duration };
      } catch (reason) {
        warn(`[frame-engine] ${declaration.kind} ${declaration.id} unavailable; skipped`, reason);
        return null;
      }
    })).then(items => {
      regularDecoded = items.filter((item): item is DecodedRegular => item !== null);
    });
    return regularLoadPromise;
  };

  const evictSpeechCache = (): void => {
    while (cacheBytes > cacheLimit && speechCache.size > 0) {
      const oldest = [...speechCache].filter(([, entry]) => entry.bytes > 0)
        .sort((left, right) => left[1].lastUsed - right[1].lastUsed)[0];
      if (!oldest) return;
      speechCache.delete(oldest[0]);
      cacheBytes -= oldest[1].bytes;
    }
  };

  const getSpeechBuffer = (declaration: PreviewSpeechDeclaration): Promise<AudioBuffer | null> => {
    if (!context || !fetchImpl || speechFailures.has(declaration.src)) return Promise.resolve(null);
    const cached = speechCache.get(declaration.src);
    if (cached) {
      cached.lastUsed = ++lruClock;
      return cached.promise;
    }
    const started = nowMs();
    const entry: SpeechCacheEntry = {
      lastUsed: ++lruClock,
      bytes: 0,
      promise: Promise.resolve(null),
    };
    entry.promise = (async () => {
      try {
        const response = await fetchImpl(declaration.url);
        if (!response.ok) throw new Error(`fetch status=${response.status}`);
        const buffer = await context!.decodeAudioData(await response.arrayBuffer());
        if (!(buffer.duration > 0)) throw new Error('decoded duration is invalid');
        const bytes = buffer.length * buffer.numberOfChannels * 4;
        entry.bytes = bytes;
        cacheBytes += bytes;
        speechMetrics.set(declaration.src, {
          src: declaration.src,
          ms: nowMs() - started,
          durationSec: buffer.duration,
          bytes,
          ok: true,
        });
        evictSpeechCache();
        return buffer;
      } catch (reason) {
        speechCache.delete(declaration.src);
        speechFailures.add(declaration.src);
        speechMetrics.set(declaration.src, {
          src: declaration.src,
          ms: nowMs() - started,
          durationSec: 0,
          bytes: 0,
          ok: false,
        });
        if (!warnedSpeech.has(declaration.src)) {
          warnedSpeech.add(declaration.src);
          warn(`[frame-engine] speech ${declaration.src} unavailable; skipped`, reason);
        }
        return null;
      }
    })();
    speechCache.set(declaration.src, entry);
    return entry.promise;
  };

  const getAtempoBuffer = (declaration: PreviewSpeechDeclaration): Promise<AudioBuffer | null> => {
    const atempo = declaration.atempo;
    if (!context || !fetchImpl || !atempo) return Promise.resolve(null);
    const cached = atempoCache.get(atempo.path);
    if (cached) return cached;
    const pending = (async () => {
      try {
        const response = await fetchImpl(atempo.path);
        if (!response.ok) throw new Error(`fetch status=${response.status}`);
        const buffer = await context!.decodeAudioData(await response.arrayBuffer());
        if (!(buffer.duration > 0)) throw new Error('decoded duration is invalid');
        return buffer;
      } catch (reason) {
        if (!warnedAtempo.has(atempo.path)) {
          warnedAtempo.add(atempo.path);
          warn(`[frame-engine] speech atempo ${declaration.id} unavailable; using source playbackRate`, reason);
        }
        return null;
      }
    })();
    atempoCache.set(atempo.path, pending);
    return pending;
  };

  const loadSpeech = async (): Promise<Map<string, ResolvedSpeechBuffer>> => {
    const buffers = new Map<string, ResolvedSpeechBuffer>();
    await Promise.all(speech.map(async declaration => {
      const atempoBuffer = await getAtempoBuffer(declaration);
      if (atempoBuffer) {
        buffers.set(declaration.id, { buffer: atempoBuffer, atempo: true });
        return;
      }
      const sourceBuffer = await getSpeechBuffer(declaration);
      if (sourceBuffer) buffers.set(declaration.id, { buffer: sourceBuffer, atempo: false });
    }));
    return buffers;
  };

  const applyGainEvents = (
    param: AudioParam,
    events: PreviewScheduledItem['gainEvents'],
    startTime: number,
  ): void => {
    if (events.length === 0) {
      param.setValueAtTime(1, startTime);
      return;
    }
    param.cancelScheduledValues(startTime);
    for (const event of events) {
      const at = startTime + event.offsetSec;
      if (event.method === 'linear') param.linearRampToValueAtTime(event.value, at);
      else param.setValueAtTime(event.value, at);
    }
  };

  const startItem = (
    item: PreviewScheduledItem,
    contextStart: number,
    speechBuffers: ReadonlyMap<string, ResolvedSpeechBuffer>,
  ): void => {
    if (!context) return;
    const regular = item.kind === 'speech' ? undefined
      : regularDecoded.find(candidate => candidate.id === item.id && candidate.kind === item.kind);
    const buffer = regular?.buffer
      ?? (item.kind === 'speech' ? speechBuffers.get(item.id)?.buffer : undefined);
    if (!buffer) return;
    try {
      const source = context.createBufferSource();
      const baseGain = context.createGain();
      const gains = [baseGain];
      source.buffer = buffer;
      source.loop = item.loop;
      source.playbackRate.value = item.playbackRate;
      source.connect(baseGain);
      let tail: AudioNode = baseGain;
      if (item.kind === 'bgm') {
        const duckGain = context.createGain();
        baseGain.connect(duckGain);
        tail = duckGain;
        gains.push(duckGain);
        applyGainEvents(duckGain.gain, item.duckingEvents, contextStart + item.delaySec);
      }
      tail.connect(context.destination);
      applyGainEvents(baseGain.gain, item.gainEvents, contextStart + item.delaySec);
      source.start(
        contextStart + item.delaySec,
        item.sourceOffsetSec,
        item.sourceDurationSec,
      );
      const activeItem = { source, gains };
      active.push(activeItem);
      source.onended = () => {
        active = active.filter(candidate => candidate !== activeItem);
        try { source.disconnect(); } catch {}
        for (const gain of gains) try { gain.disconnect(); } catch {}
      };
    } catch (reason) {
      warn(`[frame-engine] ${item.kind} ${item.id} could not be scheduled`, reason);
    }
  };

  const regularScheduleDeclaration = (): PreviewScheduleDeclaration => {
    const bgm = regularDecoded.find(item => item.kind === 'bgm');
    return {
      ...(bgm ? { bgm: { ...bgm.spec, id: bgm.id, durationSec: bgm.durationSec } } : {}),
      sfx: regularDecoded.filter(item => item.kind === 'sfx')
        .map(item => ({ ...item.spec, id: item.id, durationSec: item.durationSec })),
      narration: regularDecoded.filter(item => item.kind === 'narration')
        .map(item => ({ ...item.spec, id: item.id, durationSec: item.durationSec })),
    };
  };

  const startFrom = async (seconds: number): Promise<void> => {
    if (!context) return;
    const thisGeneration = ++generation;
    starting = true;
    const [, speechBuffers] = await Promise.all([loadRegular(), loadSpeech()]);
    if (thisGeneration !== generation) {
      starting = false;
      return;
    }
    try {
      await context.resume();
    } catch (reason) {
      warn('[frame-engine] AudioContext resume failed; keeping wall-clock playback', reason);
      starting = false;
      return;
    }
    if (thisGeneration !== generation) {
      starting = false;
      return;
    }
    const speechForSchedule = speech.flatMap(item => {
      const resolved = speechBuffers.get(item.id);
      if (!resolved) return [];
      return [{
        ...item,
        ...(!resolved.atempo ? { atempo: undefined } : {}),
        materialDurationSec: resolved.buffer.duration,
      }];
    });
    const plan = scheduleBuilder({
      timelineDurationSec,
      startAtSec: clamp(latestRequestedSec || seconds),
      audio: { ...regularScheduleDeclaration(), speech: speechForSchedule },
    });
    for (const warning of plan.warnings) warn(`[frame-engine] audio: ${warning}`);
    if (plan.items.length === 0) {
      starting = false;
      return;
    }
    stopSources();
    const contextStart = context.currentTime + 0.02;
    anchorTimelineSec = plan.startAtSec;
    anchorContextSec = contextStart;
    lastSchedule = plan.items;
    lastAtempoIds = new Set(speechForSchedule.filter(item => item.atempo).map(item => item.id));
    for (const item of lastSchedule) startItem(item, contextStart, speechBuffers);
    playing = true;
    starting = false;
  };

  const pause = (): void => {
    if (playing) latestRequestedSec = audioPosition();
    generation += 1;
    playing = false;
    starting = false;
    stopSources();
  };

  const armPauseWatchdog = (): void => {
    if (watchdogMs === false) return;
    if (pauseTimer !== null) clearTimeout(pauseTimer);
    pauseTimer = setTimeout(pause, watchdogMs);
  };

  const debug = (): PreviewAudioSupplyDebug => {
    const audioPositionSec = lastAudioPositionAtRenderSec;
    const perSource = sourceOrder.flatMap(src => {
      const metric = speechMetrics.get(src);
      return metric ? [metric] : [];
    });
    return {
      contextState: context?.state ?? 'unavailable',
      renderedTimelineSec: lastRenderedTimelineSec,
      audioPositionSec,
      driftMs: audioPositionSec === null || lastRenderedTimelineSec === null
        ? null : (lastRenderedTimelineSec - audioPositionSec) * 1000,
      playing,
      scheduled: {
        startAtSec: lastSchedule.length > 0 ? anchorTimelineSec : null,
        itemCount: lastSchedule.length,
        bgm: lastSchedule.filter(item => item.kind === 'bgm').length,
        sfx: lastSchedule.filter(item => item.kind === 'sfx').length,
        narration: lastSchedule.filter(item => item.kind === 'narration').length,
        speech: lastSchedule.filter(item => item.kind === 'speech').length,
      },
      speechDecode: {
        sources: sourceOrder.length,
        okSources: perSource.filter(item => item.ok).length,
        skippedSources: perSource.filter(item => !item.ok).length,
        totalMs: perSource.reduce((sum, item) => sum + item.ms, 0),
        bytes: cacheBytes,
        perSource: perSource.map(item => ({ ...item })),
      },
      speech: {
        atempo: {
          items: lastSchedule.filter(item => item.kind === 'speech' && lastAtempoIds.has(item.id)).length,
          generatedMs: speech.filter(item => lastAtempoIds.has(item.id))
            .reduce((sum, item) => sum + (finitePositive(item.atempo?.generatedMs)
              ? item.atempo!.generatedMs as number : 0), 0),
        },
      },
    };
  };

  return {
    playFrom(seconds) {
      latestRequestedSec = clamp(seconds);
      if (context && !playing && !starting) void startFrom(latestRequestedSec);
    },
    position(fallbackSeconds) {
      latestRequestedSec = clamp(fallbackSeconds);
      return playing ? audioPosition() : latestRequestedSec;
    },
    playbackTime(fallbackSeconds) {
      latestRequestedSec = clamp(fallbackSeconds);
      if (!context) return latestRequestedSec;
      armPauseWatchdog();
      if (!playing && !starting) void startFrom(latestRequestedSec);
      return playing ? audioPosition() : latestRequestedSec;
    },
    seek(seconds, continuePlaying = false) {
      latestRequestedSec = clamp(seconds);
      generation += 1;
      playing = false;
      starting = false;
      stopSources();
      if (continuePlaying && context) void startFrom(latestRequestedSec);
    },
    pause,
    noteRendered(seconds) {
      lastRenderedTimelineSec = clamp(seconds);
      lastAudioPositionAtRenderSec = context && playing ? audioPosition() : null;
    },
    debug,
    dispose() {
      if (pauseTimer !== null) clearTimeout(pauseTimer);
      pauseTimer = null;
      pause();
      speechCache.clear();
      atempoCache.clear();
      cacheBytes = 0;
      void context?.close().catch(() => undefined);
    },
  };
}

function finitePositive(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}
