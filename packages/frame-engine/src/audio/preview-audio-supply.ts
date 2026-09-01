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
  transition_out?: { type?: unknown; duration?: unknown } | null;
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
  method: 'set' | 'linear' | 'exponential';
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
  envelopeEvents: PreviewGainEvent[];
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

export interface PreviewAudioSidecar {
  path: string;
  durationSec: number;
  padBeforeSec: number;
  padAfterSec: number;
  generatedMs?: number;
  skipped?: boolean;
  bytes?: number;
}

export interface PreviewAudioDeclaration {
  kind: 'bgm' | 'sfx' | 'narration';
  id: string;
  /** 実際に先読みする URL。sidecar があれば FLAC、無ければ source。 */
  url: string;
  /** sidecar decode 失敗時だけ使う元ファイル URL。 */
  sourceUrl?: string;
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
  sidecar?: PreviewAudioSidecar;
  /** 旧 summary の読み取り互換。新規生成は sidecar。 */
  atempo?: { path: string; durationSec: number; generatedMs?: number };
  padBeforeSec?: number;
  padAfterSec?: number;
  crossfadeInSec?: number;
  crossfadeOutSec?: number;
  sidecarWarningEmitted?: boolean;
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
  prefetch: { items: number; decodedBytes: number; elapsedMs: number; pending: number };
  sidecars: { generated: number; skipped: number; bytes: number };
  crossfades: Array<{ id: string; startSec: number; durationSec: number }>;
  speechDecode: {
    sources: number;
    okSources: number;
    skippedSources: number;
    totalMs: number;
    bytes: number;
    perSource: Array<{ src: string; ms: number; durationSec: number; bytes: number; ok: boolean }>;
  };
  speech: { atempo: { items: number; generatedMs: number } };
}

export interface PreviewAudioSupply {
  /** ready 後に呼ぶ。呼び手を await させず、同時 2 本で予定表を先読みする。 */
  prime(): void;
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
  sidecar: boolean;
  cacheKey: string;
}

interface ResolvedSpeechBuffer {
  buffer: AudioBuffer;
  sidecar: boolean;
  cacheKey: string;
}

interface DecodeCacheEntry {
  promise: Promise<AudioBuffer | null>;
  bytes: number;
  nextUseSec: number;
}

interface ActiveSource { source: AudioBufferSourceNode; gains: GainNode[] }

const DEFAULT_DECODE_CACHE_BYTES = 256 * 1024 * 1024;
const MAX_SPEECH_SOURCE_FALLBACK_BYTES = 64 * 1024 * 1024;

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

  const decoded = new Map<string, DecodeCacheEntry>();
  const warned = new Set<string>();
  const speechMetrics = new Map<string, {
    src: string; ms: number; durationSec: number; bytes: number; ok: boolean;
  }>();
  let decodedBytes = 0;
  let prefetchPromise: Promise<void> | null = null;
  let prefetchStartedAt = 0;
  let prefetchElapsedMs = 0;
  let prefetchPending = 0;
  let regularDecoded: DecodedRegular[] = [];
  let speechDecoded = new Map<string, ResolvedSpeechBuffer>();
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
  let lastSidecarSpeechIds = new Set<string>();

  const sidecarValues = [
    ...declarations.map(item => validSidecar(item.spec.sidecar) ? item.spec.sidecar : undefined),
    ...speech.map(item => item.sidecar),
  ].filter((item): item is PreviewAudioSidecar => Boolean(item));
  const uniqueSidecars = [...new Map(sidecarValues.map(item => [item.path, item])).values()];
  const crossfades = speech.filter(item => finitePositive(item.crossfadeOutSec)).map(item => ({
    id: item.id,
    startSec: item.atSec + item.durationSec - (item.crossfadeOutSec as number),
    durationSec: item.crossfadeOutSec as number,
  }));

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

  const evictFarthest = (): void => {
    while (decodedBytes > cacheLimit) {
      const candidate = [...decoded.entries()]
        .filter(([, entry]) => entry.bytes > 0)
        .sort((left, right) => right[1].nextUseSec - left[1].nextUseSec)[0];
      if (!candidate) return;
      decoded.delete(candidate[0]);
      decodedBytes -= candidate[1].bytes;
    }
  };

  const decodeUrl = (
    url: string,
    nextUseSec: number,
    label: string,
    restrictSpeechSource = false,
    suppressWarning = false,
  ): Promise<AudioBuffer | null> => {
    if (!context || !fetchImpl) return Promise.resolve(null);
    const cacheKey = decodeCacheKey(url, restrictSpeechSource);
    const cached = decoded.get(cacheKey);
    if (cached) {
      cached.nextUseSec = Math.min(cached.nextUseSec, nextUseSec);
      return cached.promise;
    }
    const entry: DecodeCacheEntry = { bytes: 0, nextUseSec, promise: Promise.resolve(null) };
    entry.promise = (async () => {
      try {
        const response = await fetchImpl(url);
        if (!response.ok) throw new Error(`fetch status=${response.status}`);
        const declaredBytes = Number(response.headers?.get?.('content-length'));
        if (restrictSpeechSource && (!finitePositive(declaredBytes)
          || declaredBytes >= MAX_SPEECH_SOURCE_FALLBACK_BYTES)) {
          throw new Error(finitePositive(declaredBytes)
            ? `source is ${declaredBytes} bytes (64 MB fallback limit)`
            : 'source size is unavailable (64 MB fallback limit)');
        }
        const encoded = await response.arrayBuffer();
        if (restrictSpeechSource && encoded.byteLength >= MAX_SPEECH_SOURCE_FALLBACK_BYTES) {
          throw new Error(`source is ${encoded.byteLength} bytes (64 MB fallback limit)`);
        }
        const buffer = await context!.decodeAudioData(encoded);
        if (!(buffer.duration > 0)) throw new Error('decoded duration is invalid');
        entry.bytes = buffer.length * buffer.numberOfChannels * 4;
        decodedBytes += entry.bytes;
        evictFarthest();
        return buffer;
      } catch (reason) {
        decoded.delete(cacheKey);
        if (!suppressWarning && !warned.has(cacheKey)) {
          warned.add(cacheKey);
          warn(`[frame-engine] ${label} unavailable`, reason);
        }
        return null;
      }
    })();
    decoded.set(cacheKey, entry);
    return entry.promise;
  };

  const resolveRegular = async (declaration: PreviewAudioDeclaration): Promise<void> => {
    const sidecar = validSidecar(declaration.spec.sidecar);
    let buffer = await decodeUrl(declaration.url, firstUseRegular(declaration),
      `${declaration.kind} ${declaration.id}${sidecar ? ' sidecar' : ''}`);
    let usedSidecar = Boolean(sidecar && buffer);
    if (!buffer && sidecar && declaration.sourceUrl) {
      buffer = await decodeUrl(declaration.sourceUrl, firstUseRegular(declaration),
        `${declaration.kind} ${declaration.id}`);
      usedSidecar = false;
    }
    if (!buffer) return;
    const usedUrl = usedSidecar ? declaration.url : declaration.sourceUrl ?? declaration.url;
    regularDecoded.push({
      ...declaration, buffer, durationSec: buffer.duration, sidecar: usedSidecar,
      cacheKey: decodeCacheKey(usedUrl, false),
    });
  };

  const resolveSpeech = async (declaration: PreviewSpeechDeclaration): Promise<void> => {
    const started = nowMs();
    const sidecar = declaration.sidecar;
    const legacy = declaration.atempo;
    const bakedPath = sidecar?.path ?? legacy?.path;
    let buffer = bakedPath
      ? await decodeUrl(bakedPath, firstUseSpeech(declaration), `speech sidecar ${declaration.id}`)
      : null;
    let usedSidecar = Boolean(bakedPath && buffer);
    if (!buffer) {
      buffer = await decodeUrl(declaration.url, firstUseSpeech(declaration),
        `speech ${declaration.src}`, true, Boolean(bakedPath || declaration.sidecarWarningEmitted));
      usedSidecar = false;
    }
    if (buffer) speechDecoded.set(declaration.id, {
      buffer,
      sidecar: usedSidecar,
      cacheKey: decodeCacheKey(usedSidecar ? bakedPath! : declaration.url, !usedSidecar),
    });
    const bytes = buffer ? buffer.length * buffer.numberOfChannels * 4 : 0;
    const previous = speechMetrics.get(declaration.src);
    speechMetrics.set(declaration.src, {
      src: declaration.src,
      ms: (previous?.ms ?? 0) + (nowMs() - started),
      durationSec: Math.max(previous?.durationSec ?? 0, buffer?.duration ?? 0),
      bytes: (previous?.bytes ?? 0) + bytes,
      ok: previous?.ok === false ? false : Boolean(buffer),
    });
  };

  const tasks = [
    ...declarations.map(item => ({ at: firstUseRegular(item), run: () => resolveRegular(item) })),
    ...speech.map(item => ({ at: firstUseSpeech(item), run: () => resolveSpeech(item) })),
  ].sort((left, right) => left.at - right.at);

  const runPrefetch = async (): Promise<void> => {
    regularDecoded = [];
    speechDecoded = new Map();
    prefetchPending = tasks.length;
    let cursor = 0;
    const worker = async (): Promise<void> => {
      while (cursor < tasks.length) {
        const task = tasks[cursor++];
        if (!task) break;
        try { await task.run(); } finally { prefetchPending -= 1; }
      }
    };
    await Promise.all([worker(), worker()]);
    regularDecoded = regularDecoded.filter(item => decoded.has(item.cacheKey));
    speechDecoded = new Map([...speechDecoded].filter(([, item]) => decoded.has(item.cacheKey)));
  };

  const ensurePrefetch = (): Promise<void> => {
    if (prefetchPromise) return prefetchPromise;
    prefetchStartedAt = nowMs();
    prefetchPromise = runPrefetch().finally(() => {
      prefetchElapsedMs = nowMs() - prefetchStartedAt;
      prefetchPending = 0;
    });
    return prefetchPromise;
  };

  const applyGainEvents = (param: AudioParam, events: PreviewGainEvent[], startTime: number): void => {
    if (events.length === 0) {
      param.setValueAtTime(1, startTime);
      return;
    }
    param.cancelScheduledValues(startTime);
    for (const event of events) {
      const at = startTime + event.offsetSec;
      if (event.method === 'linear') param.linearRampToValueAtTime(event.value, at);
      else if (event.method === 'exponential') param.exponentialRampToValueAtTime(event.value, at);
      else param.setValueAtTime(event.value, at);
    }
  };

  const startItem = (item: PreviewScheduledItem, contextStart: number): void => {
    if (!context) return;
    const regular = item.kind === 'speech' ? undefined
      : regularDecoded.find(candidate => candidate.id === item.id && candidate.kind === item.kind);
    const buffer = regular?.buffer
      ?? (item.kind === 'speech' ? speechDecoded.get(item.id)?.buffer : undefined);
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
      if (item.envelopeEvents.length > 0) {
        const envelopeGain = context.createGain();
        baseGain.connect(envelopeGain);
        tail = envelopeGain;
        gains.push(envelopeGain);
        applyGainEvents(envelopeGain.gain, item.envelopeEvents, contextStart + item.delaySec);
      }
      tail.connect(context.destination);
      applyGainEvents(baseGain.gain, item.gainEvents, contextStart + item.delaySec);
      source.start(contextStart + item.delaySec, item.sourceOffsetSec, item.sourceDurationSec);
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
    const normalized = regularDecoded.map(item => ({
      ...item.spec,
      id: item.id,
      durationSec: item.durationSec,
      ...(!item.sidecar ? { sidecar: undefined } : {}),
    }));
    const bgm = normalized.find((_, index) => regularDecoded[index]?.kind === 'bgm');
    return {
      ...(bgm ? { bgm } : {}),
      sfx: normalized.filter((_, index) => regularDecoded[index]?.kind === 'sfx'),
      narration: normalized.filter((_, index) => regularDecoded[index]?.kind === 'narration'),
    };
  };

  const startFrom = async (seconds: number): Promise<void> => {
    if (!context) return;
    const thisGeneration = ++generation;
    starting = true;
    const alreadyPrefetched = prefetchPromise !== null;
    await ensurePrefetch();
    if (alreadyPrefetched && regularDecoded.length + speechDecoded.size < tasks.length) {
      await runPrefetch();
    }
    if (thisGeneration !== generation) { starting = false; return; }
    try {
      await context.resume();
    } catch (reason) {
      warn('[frame-engine] AudioContext resume failed; keeping wall-clock playback', reason);
      starting = false;
      return;
    }
    if (thisGeneration !== generation) { starting = false; return; }
    const speechForSchedule = speech.flatMap(item => {
      const resolved = speechDecoded.get(item.id);
      if (!resolved) return [];
      return [{
        ...item,
        ...(!resolved.sidecar ? { sidecar: undefined, atempo: undefined } : {}),
        materialDurationSec: resolved.buffer.duration,
      }];
    });
    const plan = scheduleBuilder({
      timelineDurationSec,
      startAtSec: clamp(latestRequestedSec || seconds),
      audio: { ...regularScheduleDeclaration(), speech: speechForSchedule },
    });
    for (const warning of plan.warnings) warn(`[frame-engine] audio: ${warning}`);
    if (plan.items.length === 0) { starting = false; return; }
    stopSources();
    const contextStart = context.currentTime + 0.02;
    anchorTimelineSec = plan.startAtSec;
    anchorContextSec = contextStart;
    lastSchedule = plan.items;
    lastSidecarSpeechIds = new Set(speechForSchedule
      .filter(item => item.sidecar || item.atempo).map(item => item.id));
    for (const item of lastSchedule) startItem(item, contextStart);
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
      prefetch: {
        items: tasks.length,
        decodedBytes,
        elapsedMs: prefetchElapsedMs || (prefetchStartedAt ? nowMs() - prefetchStartedAt : 0),
        pending: prefetchPending,
      },
      sidecars: {
        generated: uniqueSidecars.filter(item => item.skipped === false).length,
        skipped: uniqueSidecars.filter(item => item.skipped === true).length,
        bytes: uniqueSidecars.reduce((sum, item) => sum + (finiteNonNegative(item.bytes) ? item.bytes! : 0), 0),
      },
      crossfades,
      speechDecode: {
        sources: sourceOrder.length,
        okSources: perSource.filter(item => item.ok).length,
        skippedSources: perSource.filter(item => !item.ok).length,
        totalMs: perSource.reduce((sum, item) => sum + item.ms, 0),
        bytes: decodedBytes,
        perSource: perSource.map(item => ({ ...item })),
      },
      speech: {
        atempo: {
          items: lastSchedule.filter(item => item.kind === 'speech' && lastSidecarSpeechIds.has(item.id)).length,
          generatedMs: speech.filter(item => lastSidecarSpeechIds.has(item.id))
            .reduce((sum, item) => sum + (finitePositive(item.sidecar?.generatedMs)
              ? item.sidecar!.generatedMs! : finitePositive(item.atempo?.generatedMs)
                ? item.atempo!.generatedMs! : 0), 0),
        },
      },
    };
  };

  return {
    prime() { void ensurePrefetch(); },
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
      decoded.clear();
      decodedBytes = 0;
      void context?.close().catch(() => undefined);
    },
  };
}

function validSidecar(value: unknown): PreviewAudioSidecar | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const item = value as PreviewAudioSidecar;
  return typeof item.path === 'string' && item.path && finitePositive(item.durationSec)
    && finiteNonNegative(item.padBeforeSec) && finiteNonNegative(item.padAfterSec) ? item : undefined;
}

function firstUseRegular(item: PreviewAudioDeclaration): number {
  if (item.kind === 'bgm') return 0;
  return finiteNonNegative(item.spec.t) ? item.spec.t as number : 0;
}

function firstUseSpeech(item: PreviewSpeechDeclaration): number {
  const before = finitePositive(item.crossfadeInSec) ? item.crossfadeInSec as number : 0;
  return Math.max(0, item.atSec - before);
}

function decodeCacheKey(url: string, restricted: boolean): string {
  return `${restricted ? 'small:' : 'audio:'}${url}`;
}

function finitePositive(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function finiteNonNegative(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}
