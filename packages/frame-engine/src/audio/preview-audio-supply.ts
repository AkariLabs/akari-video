import {
  buildWebAudioSchedule,
  isAudioItemAudible,
  type WebAudioDecodedItem,
} from '@akari-video/edit-store';
import * as EditStoreKernel from '@akari-video/edit-store';
import { PcmWindowSource, type PcmWindowStats } from './pcm-window-source.js';

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

export type PreviewAudioSidecarState = 'ready' | 'queued' | 'generating' | 'no-audio' | 'failed' | 'unavailable';

export interface PreviewAudioSidecar {
  format?: 'flac' | 'pcm-s16le';
  sampleRate?: number;
  channels?: number;
  frames?: number;
  bytesPerSample?: number;
  path: string;
  durationSec: number;
  padBeforeSec: number;
  padAfterSec: number;
  generatedMs?: number;
  skipped?: boolean;
  bytes?: number;
}

export interface PreviewAudioDeclaration {
  /** Independent speech is owned by audio tracks and keys speech ducking. */
  duckKey?: boolean;
  kind: 'bgm' | 'sfx' | 'narration';
  id: string;
  /** 実際に先読みする URL。sidecar があれば PCM / FLAC、無ければ source。 */
  url: string;
  /** sidecar decode 失敗時だけ使う元ファイル URL。 */
  sourceUrl?: string;
  spec: WebAudioDecodedItem & { sidecarState?: PreviewAudioSidecarState };
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
  sidecarState?: PreviewAudioSidecarState;
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
  /**
   * デコード済み PCM の予算（bytes）。超えても buffer は捨てない（予定表から音源が消えて
   * 無音になるより、警告一行でメモリを使う方を取る）。超過は debug().prefetch と警告で見える。
   */
  decodeCacheBytes?: number;
  /** PCM 窓の float32 LRU 上限。既定 64 MiB / 音源。 */
  windowCacheBytes?: number;
  /** 最初の PCM 窓の待ち上限。未指定ならゲートの残り予算、ゲート無しでは 1500 ms。 */
  windowStartupWaitMs?: number;
  /**
   * 展開後のサイズがこの値を超えると見積もられる音源は、OfflineAudioContext で
   * compactSampleRate に落として decode し、モノラルへ畳んで保持する（長尺 BGM / ナレーション向け。
   * 48 kHz ステレオ float32 は 1 分 23 MB、24 kHz モノは 1 分 5.8 MB）。既定 64 MiB ≒ 48 kHz ステレオ 2.9 分。
   */
  compactDecodeThresholdBytes?: number;
  /** compact decode のサンプルレート。既定 24000。 */
  compactSampleRate?: number;
  /** テスト用。既定は globalThis.OfflineAudioContext。null を返すと compact decode を諦めて等倍で decode する。 */
  offlineContextFactory?: (sampleRate: number) => BaseAudioContext | null;
  /** テスト用の時計。 */
  nowImpl?: () => number;
  /** 決定論テスト用。製品経路は edit-store の共有予定表を使う。 */
  scheduleBuilder?: PreviewScheduleBuilder;
  /** false で shell の明示 pause/playFrom 経路、数値で Web UI の watchdog を使う。 */
  pauseWatchdogMs?: number | false;
  /** Preview-only pitch shifter bundled as an AudioWorklet module. */
  pitchShiftWorkletUrl?: string;
}

export interface PreviewAudioSupplyDebug {
  supply: {
    phase: 'idle' | 'preparing' | 'ready' | 'degraded';
    required: string[];
    ready: string[];
    pendingSidecar: string[];
    failed: string[];
    noAudio: string[];
    bufferedUntil: Record<string, number>;
    mutedTracks: { cuts: number[]; audio: number[]; allCuts: boolean; allAudio: boolean };
    /** 再生開始で音の最初の窓を待って共通時計を止めている間の状態。 */
    gate: { holding: boolean; startSec: number; heldMs: number; reason: 'first-window' | 'sidecar' | null };
  };
  contextState: AudioContextState | 'unavailable';
  outputLatencyMs: number | null;
  renderedTimelineSec: number | null;
  audioPositionSec: number | null;
  driftMs: number | null;
  playing: boolean;
  rate: number;
  pitchPreserved: boolean;
  stretcher: 'worklet' | 'none';
  scheduled: {
    startAtSec: number | null;
    itemCount: number;
    bgm: number;
    sfx: number;
    narration: number;
    speech: number;
    /** 予定表にあるのに decode 済み buffer が無く鳴らせなかった item（kind:id）。常に空が正常。 */
    skipped: string[];
  };
  prefetch: {
    items: number;
    decodedBytes: number;
    elapsedMs: number;
    pending: number;
    /** decode に失敗した task（kind:id）。次の startFrom で再試行する。 */
    failed: string[];
    /** compact（低レート・モノ）で保持している音源数。 */
    compact: number;
    /** decodedBytes が予算を超えているか。超えても捨てない。 */
    overBudget: boolean;
    windows: PcmWindowStats;
  };
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
  updateAudio(next: {
    declarations?: readonly PreviewAudioDeclaration[];
    speech?: readonly PreviewSpeechDeclaration[];
  }): void;
  playFrom(seconds: number): void;
  position(fallbackSeconds: number): number;
  playbackTime(fallbackSeconds: number): number;
  seek(seconds: number, continuePlaying?: boolean): void;
  pause(): void;
  setRate(rate: number): void;
  setMutedTracks(muted: {
    cuts?: Iterable<number>; audio?: Iterable<number>;
    allCuts?: boolean; allAudio?: boolean;
  }): void;
  attachAnalyser(): AnalyserNode | null;
  noteRendered(seconds: number): void;
  debug(): PreviewAudioSupplyDebug;
  dispose(): void;
}

interface DecodedRegular extends PreviewAudioDeclaration {
  buffer?: AudioBuffer;
  windowed?: PcmWindowSource;
  durationSec: number;
  sidecar: boolean;
  cacheKey: string;
}

interface ResolvedSpeechBuffer {
  buffer?: AudioBuffer;
  windowed?: PcmWindowSource;
  durationSec: number;
  sidecar: boolean;
  cacheKey: string;
}

interface DecodeCacheEntry {
  promise: Promise<AudioBuffer | null>;
  bytes: number;
  compact: boolean;
}

interface PrefetchTask {
  key: string;
  at: number;
  run: () => Promise<void>;
  resolved: () => boolean;
  muted: () => boolean;
  failedAtMs: number | null;
  state: 'decode' | 'windowed' | 'pending-sidecar' | 'no-audio';
  updated?: boolean;
  queued?: boolean;
}

interface ActiveItem {
  key: string;
  material: AudioBuffer | PcmWindowSource;
  item: PreviewScheduledItem;
  rate: number;
}
interface ActiveSource extends ActiveItem { source: AudioBufferSourceNode; gains: GainNode[] }

interface ActiveItemGain {
  kind: PreviewScheduledItem['kind'];
  track: number;
  baseGain: GainNode;
  gainEvents: PreviewGainEvent[];
  startTime: number;
  transportRate: number;
  remove(): void;
}

const DEFAULT_DECODE_CACHE_BYTES = 256 * 1024 * 1024;
const MAX_SPEECH_SOURCE_FALLBACK_BYTES = 64 * 1024 * 1024;
const DEFAULT_COMPACT_DECODE_THRESHOLD_BYTES = 64 * 1024 * 1024;
const DEFAULT_COMPACT_SAMPLE_RATE = 24000;
/** 失敗した decode を次に再試行するまでの間隔。再生ボタンごとに 404 を叩き直さない。 */
const FAILED_DECODE_RETRY_MS = 5000;
/** 空の予定表 / 失敗の直後に playbackTime() が startFrom を叩き直すまでの間隔。 */
const RESTART_BACKOFF_MS = 500;
const WINDOW_LOOKAHEAD_SEC = 12;
const WINDOW_REFILL_MS = 500;
/** 再生開始で「開始位置の音の最初の窓」を待つ上限。越えたら壁時計で進め、音は後から合流する。 */
const PLAY_GATE_MAX_HOLD_SEC = 3;
const MIB = 1024 * 1024;

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
  const compactThreshold = finitePositive(options.compactDecodeThresholdBytes)
    ? options.compactDecodeThresholdBytes as number : DEFAULT_COMPACT_DECODE_THRESHOLD_BYTES;
  const compactSampleRate = finitePositive(options.compactSampleRate)
    ? options.compactSampleRate as number : DEFAULT_COMPACT_SAMPLE_RATE;
  const offlineContextFactory = options.offlineContextFactory ?? defaultOfflineContextFactory;
  const now = options.nowImpl ?? nowMs;
  const watchdogMs = options.pauseWatchdogMs === false
    ? false : finitePositive(options.pauseWatchdogMs) ? options.pauseWatchdogMs as number : false;
  const explicitWindowStartupWaitMs = finiteNonNegative(options.windowStartupWaitMs) ? options.windowStartupWaitMs! : null;
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
  let overBudgetWarned = false;
  let prefetchInFlight: Promise<void> | null = null;
  let activePrefetchQueue: PrefetchTask[] | null = null;
  let wakePrefetch: (() => void) | null = null;
  let disposed = false;
  let decodedRevision = 0;
  let prefetchEverRan = false;
  let prefetchStartedAt = 0;
  let prefetchElapsedMs = 0;
  let prefetchPending = 0;
  let lastStartAttemptMs = 0;
  let lastStartOutcome: 'started' | 'empty' | 'failed' | null = null;
  let skippedAtSchedule: string[] = [];
  let scheduledDecodedCount = 0;
  /** 「鳴らせる音源が無い」(outcome=empty) で終わった時点の decode 済み件数。増えたときだけ拾い直す。 */
  let emptyPlanDecodedCount = 0;
  let regularDecoded: DecodedRegular[] = [];
  let speechDecoded = new Map<string, ResolvedSpeechBuffer>();
  let active: ActiveSource[] = [];
  const activeItemGains = new Set<ActiveItemGain>();
  let mutedCutTracks = new Set<number>();
  let mutedAudioTracks = new Set<number>();
  let allCutsMuted = false;
  let allAudioMuted = false;
  const trackMuted = (kind: PreviewScheduledItem['kind'], track: unknown): boolean => kind === 'speech'
    ? allCutsMuted || mutedCutTracks.has(normalizedTrack(track))
    : allAudioMuted || mutedAudioTracks.has(normalizedTrack(track));
  const itemMuted = (item: PreviewScheduledItem): boolean => trackMuted(item.kind, item.track);
  const windowSources = new Map<string, PcmWindowSource>();
  const windowStops = new Map<string, () => void>();
  // resume = トラックミュート解除で止まっていた窓の補充を再開する（同期便の「再計画で既存ノードを保つ」と両立させる合流時の追加）。
  const windowItems = new Map<string, ActiveItem & { controller: AbortController; resume?: () => void; suspended?: boolean }>();
  const windowFailures = new Set<string>();
  const windowControllers = new Set<AbortController>();
  let startingWindowController: AbortController | null = null;
  let bufferedUntil: Record<string, number> = {};
  let generation = 0;
  let playbackEpoch = 0;
  let starting = false;
  let replanPending = false;
  let gate: { holding: boolean; startSec: number; sinceMs: number; reason: 'first-window' | 'sidecar' | null } = {
    holding: false, startSec: 0, sinceMs: 0, reason: null,
  };
  /** gate を張った startFrom の世代。seek / pause / setRate / 新しい startFrom で無効になる。 */
  let gateGeneration = -1;
  /** 1 回の再生意図（play / シーク後の再開 / レート変更後の再開）の起点。内部の再試行では更新しない。 */
  let gateIntent: { startSec: number; sinceMs: number } | null = null;
  let playing = false;
  let anchorTimelineSec = 0;
  let anchorContextSec = 0;
  let latestRequestedSec = 0;
  let pauseTimer: ReturnType<typeof setTimeout> | null = null;
  let lastRenderedTimelineSec: number | null = null;
  let lastAudioPositionAtRenderSec: number | null = null;
  let lastSchedule: PreviewScheduledItem[] = [];
  let lastPlanStartAtSec = 0;
  let lastSidecarSpeechIds = new Set<string>();
  let rate = 1;
  const masterGain = context?.createGain() ?? null;
  let analyser: AnalyserNode | null = null;
  let pitchShiftNode: AudioWorkletNode | null = null;
  let workletReady = false;
  let workletWarningEmitted = false;
  let stretcher: 'worklet' | 'none' = 'none';

  const uniqueSidecars = (): PreviewAudioSidecar[] => {
    const sidecarValues = [
      ...declarations.map(item => validSidecar(item.spec.sidecar) ? item.spec.sidecar : undefined),
      ...speech.map(item => item.sidecar),
    ].filter((item): item is PreviewAudioSidecar => Boolean(item));
    return [...new Map(sidecarValues.map(item => [item.path, item])).values()];
  };
  const crossfades = speech.filter(item => finitePositive(item.crossfadeOutSec)).map(item => ({
    id: item.id,
    startSec: item.atSec + item.durationSec - (item.crossfadeOutSec as number),
    durationSec: item.crossfadeOutSec as number,
  }));

  const clamp = (seconds: number): number => Math.max(
    0,
    Math.min(Number.isFinite(seconds) ? seconds : 0, timelineDurationSec),
  );

  const positionAtContextTime = (seconds: number): number => context && playing
    ? clamp(anchorTimelineSec + Math.max(0, seconds - anchorContextSec) * rate)
    : latestRequestedSec;
  const contextPosition = (): number => positionAtContextTime(context?.currentTime ?? 0);
  const audioPosition = (): number => {
    let outputContextTime = context?.currentTime ?? 0;
    try {
      if (typeof context?.getOutputTimestamp === 'function') {
        const timestamp = context.getOutputTimestamp();
        if (finiteNonNegative(timestamp?.contextTime)) outputContextTime = timestamp.contextTime!;
      }
    } catch { /* Older/outputless devices may not supply an output timestamp. */ }
    return positionAtContextTime(outputContextTime);
  };

  const warnPitchUnavailable = (reason: unknown): void => {
    if (workletWarningEmitted) return;
    workletWarningEmitted = true;
    warn('[frame-engine] pitch-preserving playback unavailable; using native playback rate', reason);
  };

  const outputNode = (): AudioNode | null => analyser ?? context?.destination ?? null;

  const disconnectPitchShiftNode = (): void => {
    if (!pitchShiftNode) return;
    try { pitchShiftNode.disconnect(); } catch {}
  };

  const routeMasterBus = (): void => {
    if (!context || !masterGain) return;
    try { masterGain.disconnect(); } catch {}
    disconnectPitchShiftNode();
    stretcher = 'none';
    const output = outputNode();
    if (!output) return;
    if (rate !== 1 && workletReady) {
      try {
        const WorkletNode = globalThis.AudioWorkletNode;
        if (typeof WorkletNode !== 'function') throw new Error('AudioWorkletNode is unavailable');
        pitchShiftNode ??= new WorkletNode(context, 'akari-pitch-shift', {
          parameterData: { ratio: 1 / rate },
        });
        const ratio = pitchShiftNode.parameters.get('ratio');
        if (ratio) ratio.value = 1 / rate;
        masterGain.connect(pitchShiftNode);
        pitchShiftNode.connect(output);
        stretcher = 'worklet';
        return;
      } catch (reason) {
        warnPitchUnavailable(reason);
      }
    }
    masterGain.connect(output);
  };

  if (masterGain) routeMasterBus();
  if (context && options.pitchShiftWorkletUrl) {
    if (context.audioWorklet?.addModule) {
      void context.audioWorklet.addModule(options.pitchShiftWorkletUrl).then(() => {
        workletReady = true;
        routeMasterBus();
      }).catch(reason => warnPitchUnavailable(reason));
    } else {
      warnPitchUnavailable(new Error('AudioContext.audioWorklet is unavailable'));
    }
  }

  const stopActiveSource = (item: ActiveSource): void => {
    active = active.filter(candidate => candidate !== item);
    item.source.onended = null;
    try { item.source.stop(); } catch {}
    try { item.source.disconnect(); } catch {}
    for (const gain of item.gains) try { gain.disconnect(); } catch {}
  };

  const stopSources = (): void => {
    startingWindowController?.abort();
    startingWindowController = null;
    for (const controller of windowControllers) controller.abort();
    windowControllers.clear();
    for (const stop of [...windowStops.values()]) stop();
    windowStops.clear();
    for (const entry of activeItemGains) entry.remove();
    bufferedUntil = {};
    for (const item of [...active]) stopActiveSource(item);
  };

  // 予算超過でも buffer は捨てない。以前は「次の使用時刻が最も遠い buffer」を黙って evict し、
  // 予定表からもその音源が消えていた（48 kHz ステレオ 11.6 分の WAV 1 本で 256 MiB を超え、
  // 一度も鳴らない）。捨てる代わりに、長尺は compact（低レート・モノ）で持ち、超過は警告で見せる。
  const noteDecodedBytes = (entry: DecodeCacheEntry, buffer: AudioBuffer): void => {
    entry.bytes = buffer.length * buffer.numberOfChannels * 4;
    decodedBytes += entry.bytes;
    if (decodedBytes > cacheLimit && !overBudgetWarned) {
      overBudgetWarned = true;
      warn(`[frame-engine] preview audio holds ${(decodedBytes / MIB).toFixed(0)} MiB of decoded PCM, `
        + `over the ${(cacheLimit / MIB).toFixed(0)} MiB budget; keeping every buffer so playback stays complete`);
    }
  };

  // 長尺音源は OfflineAudioContext（compactSampleRate）で decode し、モノラルへ畳んで保持する。
  // decodeAudioData は context のレートへ resample して返すため、低レートの context で decode すれば
  // 展開後の float32 がそのぶん小さくなる。AudioBufferSourceNode は buffer のレートが context と
  // 違っても再生時に resample するので、予定表・gain・ducking の扱いは等倍 decode と同じ。
  const decodeCompact = async (encoded: ArrayBuffer): Promise<AudioBuffer | null> => {
    const offline = offlineContextFactory(compactSampleRate);
    if (!offline) return null;
    const full = await offline.decodeAudioData(encoded);
    return downmixToMono(full, context!);
  };

  const decodeUrl = (
    url: string,
    label: string,
    restrictSpeechSource = false,
    suppressWarning = false,
  ): Promise<AudioBuffer | null> => {
    if (!context || !fetchImpl) return Promise.resolve(null);
    const cacheKey = decodeCacheKey(url, restrictSpeechSource);
    const cached = decoded.get(cacheKey);
    if (cached) return cached.promise;
    const entry: DecodeCacheEntry = { bytes: 0, compact: false, promise: Promise.resolve(null) };
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
        let buffer: AudioBuffer | null = null;
        if (estimateDecodedBytes(encoded, context!.sampleRate) > compactThreshold) {
          // decodeAudioData は渡した ArrayBuffer を detach する。compact が失敗したとき
          // 同じ encoded で等倍 decode へ退避すると DataCloneError（detached）で必ず落ち、
          // 「decoding at full rate」は嘘になっていた（実機 2026-09-05: 88 分の BGM が
          // compact の EncodingError → 退避も失敗 → 丸ごと無音）。退避用に複製を渡す。
          // 複製は encoded と同じ大きさ（BGM で 129MB）だが、成功時は即 GC される一時物。
          try {
            buffer = await decodeCompact(encoded.slice(0));
            entry.compact = buffer !== null;
          } catch (reason) {
            warn(`[frame-engine] ${label}: compact decode failed; decoding at full rate`, reason);
          }
        }
        if (!buffer) buffer = await context!.decodeAudioData(encoded);
        if (!(buffer.duration > 0)) throw new Error('decoded duration is invalid');
        noteDecodedBytes(entry, buffer);
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

  const pcmSource = (url: string, sidecar: PreviewAudioSidecar): PcmWindowSource => {
    if (!context || !fetchImpl) throw new Error('PCM window supply unavailable');
    const metadata = { url, sampleRate: sidecar.sampleRate!, channels: sidecar.channels!,
      bytesPerSample: sidecar.bytesPerSample!, frames: sidecar.frames!, durationSec: sidecar.durationSec };
    const key = JSON.stringify(metadata);
    let source = windowSources.get(key);
    if (!source) {
      source = new PcmWindowSource(metadata, fetchImpl, context, { cacheBytes: options.windowCacheBytes });
      windowSources.set(key, source);
    }
    return source;
  };

  const resolveRegular = async (declaration: PreviewAudioDeclaration): Promise<void> => {
    const sidecar = validSidecar(declaration.spec.sidecar);
    if (sidecar?.format === 'pcm-s16le') {
      regularDecoded.push({ ...declaration, windowed: pcmSource(declaration.url, sidecar),
        durationSec: sidecar.durationSec, sidecar: true, cacheKey: declaration.url });
      decodedRevision += 1;
      return;
    }
    let buffer = await decodeUrl(declaration.url,
      `${declaration.kind} ${declaration.id}${sidecar ? ' sidecar' : ''}`);
    let usedSidecar = Boolean(sidecar && buffer);
    if (!buffer && sidecar && declaration.sourceUrl && !trackMuted(declaration.kind, declaration.spec.track)) {
      buffer = await decodeUrl(declaration.sourceUrl, `${declaration.kind} ${declaration.id}`);
      usedSidecar = false;
    }
    if (!buffer || disposed || !declarations.includes(declaration)) return;
    const usedUrl = usedSidecar ? declaration.url : declaration.sourceUrl ?? declaration.url;
    regularDecoded.push({
      ...declaration, buffer, durationSec: buffer.duration, sidecar: usedSidecar,
      cacheKey: decodeCacheKey(usedUrl, false),
    });
    decodedRevision += 1;
  };

  const resolveSpeech = async (declaration: PreviewSpeechDeclaration): Promise<void> => {
    const started = nowMs();
    const sidecar = declaration.sidecar;
    const legacy = declaration.atempo;
    if (sidecar?.format === 'pcm-s16le') {
      speechDecoded.set(declaration.id, { windowed: pcmSource(sidecar.path, sidecar),
        durationSec: sidecar.durationSec, sidecar: true, cacheKey: sidecar.path });
      decodedRevision += 1;
      return;
    }
    const bakedPath = sidecar?.path ?? legacy?.path;
    let buffer = bakedPath
      ? await decodeUrl(bakedPath, `speech sidecar ${declaration.id}`)
      : null;
    let usedSidecar = Boolean(bakedPath && buffer);
    if (!buffer && !trackMuted('speech', declaration.track)) {
      buffer = await decodeUrl(declaration.url,
        `speech ${declaration.src}`, true, Boolean(bakedPath || declaration.sidecarWarningEmitted));
      usedSidecar = false;
    }
    if (disposed || !speech.includes(declaration)) return;
    if (buffer) speechDecoded.set(declaration.id, {
      buffer,
      durationSec: buffer.duration,
      sidecar: usedSidecar,
      cacheKey: decodeCacheKey(usedSidecar ? bakedPath! : declaration.url, !usedSidecar),
    });
    if (buffer) decodedRevision += 1;
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

  const regularResolved = (item: PreviewAudioDeclaration): boolean =>
    regularDecoded.some(candidate => candidate.kind === item.kind && candidate.id === item.id);
  const taskState = (state?: PreviewAudioSidecarState): PrefetchTask['state'] =>
    state === 'queued' || state === 'generating' ? 'pending-sidecar'
      : state === 'no-audio' ? 'no-audio' : 'decode';
  const prepareWindowedTask = (task: PrefetchTask, pcm: boolean): PrefetchTask => {
    if (pcm && task.state === 'decode') task.state = 'windowed';
    if (task.state === 'windowed' && !task.muted() && !task.resolved()) {
      // PCM メタデータだけを同期で解決する。ミュート中は解除後の ensureDecoded へ持ち越す。
      void task.run().catch(reason => {
        task.failedAtMs = now();
        warn(`[frame-engine] ${task.key} PCM metadata unavailable`, reason);
      });
    }
    return task;
  };
  const regularTask = (item: PreviewAudioDeclaration): PrefetchTask => prepareWindowedTask({
      key: `${item.kind}:${item.id}`, at: firstUseRegular(item), failedAtMs: null,
      state: taskState(item.spec.sidecarState),
      muted: () => !isAudioItemAudible({ muted: trackMuted(item.kind, item.spec.track) }, item.spec),
      run: () => resolveRegular(item), resolved: () => regularResolved(item),
    }, validSidecar(item.spec.sidecar)?.format === 'pcm-s16le');
  const speechTask = (item: PreviewSpeechDeclaration): PrefetchTask => prepareWindowedTask({
      key: `speech:${item.id}`, at: firstUseSpeech(item), failedAtMs: null,
      state: taskState(item.sidecarState),
      muted: () => trackMuted('speech', item.track),
      run: () => resolveSpeech(item), resolved: () => speechDecoded.has(item.id),
    }, item.sidecar?.format === 'pcm-s16le');
  const tasks: PrefetchTask[] = [
    ...declarations.map(regularTask),
    ...speech.map(speechTask),
  ].sort((left, right) => left.at - right.at);

  const pendingTasks = (): PrefetchTask[] => {
    const at = now();
    return tasks.filter(task => !task.muted() && task.state === 'decode' && !task.resolved()
      && (task.failedAtMs === null || at - task.failedAtMs >= FAILED_DECODE_RETRY_MS));
  };

  const runPrefetch = async (queue: PrefetchTask[]): Promise<void> => {
    activePrefetchQueue = queue;
    for (const task of queue) task.queued = true;
    prefetchPending = queue.length;
    let cursor = 0;
    let workers = 2;
    let failed = false;
    let failure: unknown;
    const idle = new Set<() => void>();
    const wake = (): void => {
      const waiters = [...idle];
      idle.clear();
      for (const resume of waiters) resume();
    };
    wakePrefetch = wake;
    const worker = async (): Promise<void> => {
      try {
        while (!disposed && !failed) {
          if (cursor >= queue.length) {
            // 全 worker が空いたら終了。それまでは解除時のキュー追加を待つ。
            if (idle.size === workers - 1) return;
            await new Promise<void>(resolve => idle.add(resolve));
            continue;
          }
          const task = queue[cursor++];
          if (!task) break;
          try {
            if (!tasks.includes(task) || task.muted()) continue;
            await task.run();
            task.failedAtMs = task.resolved() || task.muted() ? null : now();
          } catch (reason) {
            task.failedAtMs = now();
            warn(`[frame-engine] ${task.key} prefetch failed`, reason);
          } finally {
            task.queued = false;
            prefetchPending -= 1;
            notifyTaskSettled();
            if (task.updated && !disposed) replanIfNeeded();
          }
        }
      } catch (reason) {
        // 通知などの例外でも待機中の worker を解放し、稼働中の終了まで合流する。
        failed = true;
        failure = reason;
      } finally {
        workers -= 1;
        wake();
      }
    };
    try {
      await Promise.all([worker(), worker()]);
      if (failed) throw failure;
    } finally {
      for (const task of queue) task.queued = false;
    }
  };

  // 「その時刻までに鳴り始めているはずの音源」だけ待つための待ち合わせ口。
  const taskWaiters = new Set<() => void>();
  const notifyTaskSettled = (): void => {
    for (const waiter of [...taskWaiters]) waiter();
  };

  // 未解決の task だけを同時 2 本で decode する。以前は毎回 regularDecoded / speechDecoded を空にして
  // 全 task を再 decode し（欠けが 1 つでもあると再生ボタンのたびに全音源を fetch + decode）、
  // 再入ガードも無かったので prefetch 中の seek が同じ配列を取り合っていた。
  // 解決済みは触らず、同時呼び出しは 1 本に合流する。失敗した task は 5 秒空けてから再試行する。
  const ensureDecoded = (): Promise<void> => {
    if (disposed) return Promise.resolve();
    for (const task of tasks) prepareWindowedTask(task, false);
    if (prefetchInFlight) {
      // 解除した音源を稼働中のキューへ足し、未来の全 task の終了を待たせない。
      if (activePrefetchQueue) for (const task of pendingTasks()) {
        if (task.queued) continue;
        task.queued = true;
        activePrefetchQueue.push(task);
        prefetchPending += 1;
      }
      wakePrefetch?.();
      return prefetchInFlight;
    }
    const queue = pendingTasks();
    if (queue.length === 0) return Promise.resolve();
    const first = !prefetchEverRan;
    prefetchEverRan = true;
    if (first) prefetchStartedAt = now();
    prefetchInFlight = runPrefetch(queue).finally(() => {
      if (first) prefetchElapsedMs = now() - prefetchStartedAt;
      prefetchPending = 0;
      prefetchInFlight = null;
      activePrefetchQueue = null;
      wakePrefetch = null;
      // 先に鳴り始めた予定表は、遅れて decode が揃った音源を知らない。全件揃ったこの 1 回だけ
      // 組み直して取りこぼしを拾う（毎件やると stopSources のたびにクリックが乗る）。
      replanIfNeeded();
    });
    return prefetchInFlight;
  };

  // 再生開始に要るのは「その時刻までに鳴り始めているはずの音源」だけ。全件の decode を待つと、
  // 長尺案件では最初の一音までが総量に比例して伸び、1 件でも詰まれば永久に無音になる
  // （実機 2026-09-05: 先読み 23 件 / sidecar 合計 1.1GB で 5 分経っても pending 23・予定表 0 件）。
  // task は first-use 昇順に並んでいて worker もその順に消化するので、待ちは先頭側だけで解ける。
  // 先の音源は背景で decode を続け、揃った時点で replanIfNeeded が組み直す。
  const ensureDecodedUpTo = (seconds: number): Promise<void> => {
    const full = ensureDecoded();
    // 一度失敗した task は開始待ちの対象から外す（背景の 5 秒後再試行は pendingTasks 側で続く）。
    // 外さないと、音声ストリームの無い素材や decode に失敗し続ける BGM が「未解決」として
    // 5 秒ごとに戻ってきて、シークのたびに再 fetch → 再失敗を待たされる（実機 2026-09-05:
    // シーク後に無音が続く主因。gpt-6-astra の指摘 P0）。
    const due = (): PrefetchTask[] => pendingTasks()
      .filter(task => task.at <= seconds && task.failedAtMs === null);
    if (due().length === 0) return Promise.resolve();
    return new Promise<void>(resolve => {
      let settled = false;
      const finish = (): void => {
        if (settled) return;
        settled = true;
        taskWaiters.delete(check);
        resolve();
      };
      const check = (): void => {
        if (due().length === 0) finish();
      };
      taskWaiters.add(check);
      // 全件終われば当然抜ける（失敗して resolved にならない task があっても止まらない）。
      void full.finally(finish);
      check();
    });
  };

  // cold（sidecar 未生成）では待つものが無いまま予定表が組まれ、後から届いた音が冒頭を失っていた。
  // ゲートを張っている間は、開始位置の required が解決するまで（上限 3 秒）予定表を組まずに待つ。
  const waitForGateStart = (positionSec: number, thisGeneration: number): Promise<void> => {
    if (gateMissingKeys(positionSec, false).length === 0) return Promise.resolve();
    const remaining = gate.sinceMs + PLAY_GATE_MAX_HOLD_SEC * 1000 - now();
    if (!(remaining > 0)) return Promise.resolve();
    return new Promise<void>(resolve => {
      let settled = false;
      const finish = (): void => {
        if (settled) return;
        settled = true;
        taskWaiters.delete(check);
        clearTimeout(timer);
        resolve();
      };
      const check = (): void => {
        if (thisGeneration !== generation || gateMissingKeys(positionSec, false).length === 0) finish();
      };
      const timer = setTimeout(finish, remaining);
      taskWaiters.add(check);
      check();
    });
  };

  const replanIfNeeded = (): void => {
    if (starting) {
      replanPending = true;
      return;
    }
    const decodedCount = decodedRevision;
    if (!playing) {
      // 失敗 task を開始待ちから外したぶん、「その位置に鳴らせる音源がまだ無い」（outcome=empty）で
      // 終わった開始意図は、decode が届いた時点でここで拾い直す。5 秒後の背景再試行が成功したら
      // 鳴り始める、という従来の契約（test: 5 秒空けた次の再生で再試行する）はこれで維持される。
      // pause / seek は outcome を null に戻すので、止めた再生を勝手に再開することはない。
      // 空の予定表を組んだ後に decode 済みが増えたときだけ。組んだ時点で揃っていた分では
      // 何度組み直しても空のままなので、playbackTime 側の 500 ms backoff に任せる
      // （test: 空の予定表の直後は 500 ms 空けて再試行する）。
      if (lastStartOutcome === 'empty' && decodedCount > emptyPlanDecodedCount) launch(latestRequestedSec);
      return;
    }
    if (decodedCount <= scheduledDecodedCount) return;
    launch(contextPosition(), { pinStart: true });
  };

  // Rebase automation without replaying a fade that has already elapsed.
  const remainingGainEvents = (events: PreviewGainEvent[], elapsed: number): PreviewGainEvent[] => {
    if (events.length === 0) return [];
    let value = events[0]!.value;
    let previous = events[0]!;
    for (const event of events) {
      if (event.offsetSec > elapsed) {
        const fraction = Math.max(0, (elapsed - previous.offsetSec) / (event.offsetSec - previous.offsetSec));
        if (event.method === 'linear') value = previous.value + (event.value - previous.value) * fraction;
        else if (event.method === 'exponential' && previous.value > 0 && event.value > 0) {
          value = previous.value * (event.value / previous.value) ** fraction;
        }
        break;
      }
      value = event.value;
      previous = event;
    }
    return [{ offsetSec: 0, value, method: 'set' },
      ...events.filter(event => event.offsetSec > elapsed)
        .map(event => ({ ...event, offsetSec: event.offsetSec - elapsed }))];
  };

  const applyGainEvents = (
    param: AudioParam,
    events: PreviewGainEvent[],
    startTime: number,
    playbackRate: number,
    lateSec = 0,
  ): void => {
    if (lateSec > 0) {
      events = remainingGainEvents(events, lateSec * playbackRate);
      startTime += lateSec;
    }
    if (events.length === 0) {
      param.setValueAtTime(1, startTime);
      return;
    }
    param.cancelScheduledValues(startTime);
    for (const event of events) {
      const at = startTime + event.offsetSec / playbackRate;
      if (event.method === 'linear') param.linearRampToValueAtTime(event.value, at);
      else if (event.method === 'exponential') param.exponentialRampToValueAtTime(event.value, at);
      else param.setValueAtTime(event.value, at);
    }
  };

  // 第 1 gain だけを登録し、envelope / ducking と master の設定は独立させる。
  const registerItemGain = (
    item: PreviewScheduledItem, baseGain: GainNode, startTime: number, transportRate: number,
  ): ActiveItemGain => {
    const entry: ActiveItemGain = {
      kind: item.kind, track: normalizedTrack(item.track), baseGain,
      gainEvents: item.gainEvents, startTime, transportRate,
      remove: () => { activeItemGains.delete(entry); },
    };
    activeItemGains.add(entry);
    return entry;
  };

  /** 予定表の 1 item を鳴らす。buffer が無い / 失敗した場合は false（呼び手が警告にまとめる）。 */
  const startItem = (item: PreviewScheduledItem, contextStart: number): boolean => {
    if (!context) return false;
    const regular = item.kind === 'speech' ? undefined
      : regularDecoded.find(candidate => candidate.id === item.id && candidate.kind === item.kind);
    const buffer = regular?.buffer
      ?? (item.kind === 'speech' ? speechDecoded.get(item.id)?.buffer : undefined);
    if (!buffer) return false;
    const when = contextStart + item.delaySec / rate;
    const late = Math.max(0, context.currentTime - when);
    const consumed = late * item.playbackRate * rate;
    if (item.sourceDurationSec - consumed <= 0) return false;
    try {
      const source = context.createBufferSource();
      const baseGain = context.createGain();
      const gains = [baseGain];
      source.buffer = buffer;
      source.loop = item.loop;
      source.playbackRate.value = item.playbackRate * rate;
      source.connect(baseGain);
      let tail: AudioNode = baseGain;
      if (item.envelopeEvents.length > 0) {
        const envelopeGain = context.createGain();
        baseGain.connect(envelopeGain);
        tail = envelopeGain;
        gains.push(envelopeGain);
        applyGainEvents(
          envelopeGain.gain,
          item.envelopeEvents,
          contextStart + item.delaySec / rate,
          rate,
          late,
        );
      }
      tail.connect(masterGain ?? context.destination);
      applyGainEvents(baseGain.gain, item.gainEvents, when, rate, late);
      source.start(Math.max(when, context.currentTime), item.sourceOffsetSec + consumed, item.sourceDurationSec - consumed);
      // track-mute（gain 0 の即時反映）と sync（再計画で既存ノードを保持）の両方: gain の登録は開始時刻 when 基準。
      const gainEntry = registerItemGain(item, baseGain, when, rate);
      const activeItem: ActiveSource = { source, gains, key: `${item.kind}:${item.id}`, material: buffer, item, rate };
      active.push(activeItem);
      source.onended = () => {
        gainEntry.remove();
        active = active.filter(candidate => candidate !== activeItem);
        try { source.disconnect(); } catch {}
        for (const gain of gains) try { gain.disconnect(); } catch {}
      };
      return true;
    } catch (reason) {
      warn(`[frame-engine] ${item.kind} ${item.id} could not be scheduled`, reason);
      return false;
    }
  };

  const windowedFor = (item: PreviewScheduledItem): PcmWindowSource | undefined =>
    item.kind === 'speech' ? speechDecoded.get(item.id)?.windowed
      : regularDecoded.find(candidate => candidate.id === item.id && candidate.kind === item.kind)?.windowed;

  const canKeepItem = (item: PreviewScheduledItem): boolean => {
    const key = `${item.kind}:${item.id}`;
    const live = windowItems.get(key) ?? active.find(candidate => candidate.key === key);
    if (!live) return false;
    // トラックミュートで窓の補充が止まった item は保持せず組み直す（解除時に補充を確実に再開するため）。
    if ((live as { suspended?: boolean }).suspended) return false;
    const material = windowedFor(item) ?? (item.kind === 'speech' ? speechDecoded.get(item.id)?.buffer
      : regularDecoded.find(candidate => candidate.id === item.id && candidate.kind === item.kind)?.buffer);
    const old = live.item;
    if (live.material !== material || live.rate !== rate || old.loop !== item.loop
      || old.playbackRate !== item.playbackRate || old.gainDb !== item.gainDb
      || old.timelineEndSec !== item.timelineEndSec) return false;
    const elapsed = item.timelineStartSec - old.timelineStartSec;
    const sameEvents = (before: PreviewGainEvent[], after: PreviewGainEvent[]): boolean => {
      const remaining = remainingGainEvents(before, elapsed);
      const next = remainingGainEvents(after, 0);
      return remaining.length === next.length && remaining.every((event, index) => {
        const other = next[index]!;
        return event.method === other.method && Math.abs(event.offsetSec - other.offsetSec) < 1e-6
          && Math.abs(event.value - other.value) < 1e-6;
      });
    };
    return sameEvents(old.gainEvents, item.gainEvents) && sameEvents(old.envelopeEvents, item.envelopeEvents);
  };

  interface WindowSlice {
    startSec: number;
    endSec: number;
    frames: number;
    durationSec: number;
    elapsedSec: number;
  }
  interface PreparedWindow {
    result: Promise<{ buffer: AudioBuffer } | { reason: unknown; failedAtMs: number }>;
    release: () => void;
  }

  // Use an integer frame cursor, including across loop wraps. Correct floating point
  // division at the Range API boundary so floor/ceil cannot introduce an extra sample.
  const frameSeconds = (frame: number, sampleRate: number, end: boolean): number => {
    const seconds = frame / sampleRate;
    const adjustment = Number.EPSILON * Math.max(1, Math.abs(seconds));
    return end ? (Math.ceil(seconds * sampleRate) > frame ? seconds - adjustment : seconds)
      : (Math.floor(seconds * sampleRate) < frame ? seconds + adjustment : seconds);
  };
  const windowSlice = (item: PreviewScheduledItem, source: PcmWindowSource, consumed: number): WindowSlice | null => {
    const { sampleRate, frames, durationSec: materialDurationSec } = source.metadata;
    const materialFrames = Math.min(frames, Math.round(materialDurationSec * sampleRate));
    const remaining = item.sourceDurationSec - consumed / sampleRate;
    if (!(remaining > 0) || materialFrames <= 0) return null;
    let startFrame = Math.floor(item.sourceOffsetSec * sampleRate) + consumed;
    if (item.loop) startFrame = ((startFrame % materialFrames) + materialFrames) % materialFrames;
    if (startFrame >= materialFrames) return null;
    const count = Math.min(Math.round((consumed === 0 ? 1 : 3) * sampleRate),
      Math.ceil(remaining * sampleRate), materialFrames - startFrame);
    if (count <= 0) return null;
    return { startSec: frameSeconds(startFrame, sampleRate, false),
      endSec: frameSeconds(startFrame + count, sampleRate, true), frames: count,
      durationSec: Math.min(count / sampleRate, remaining), elapsedSec: consumed / sampleRate };
  };

  const prepareWindow = (source: PcmWindowSource, slice: WindowSlice, signal: AbortSignal): PreparedWindow => {
    const unpin = source.pin(slice.startSec, slice.endSec);
    const release = (): void => { signal.removeEventListener('abort', release); unpin(); };
    signal.addEventListener('abort', release, { once: true });
    if (signal.aborted) release();
    return {
      result: source.window(slice.startSec, slice.endSec, signal)
        .then(buffer => ({ buffer }), reason => ({ reason, failedAtMs: now() })),
      release,
    };
  };

  const waitForFirstWindows = (windows: PreparedWindow[], signal: AbortSignal, waitMs: number): Promise<void> => {
    if (windows.length === 0 || signal.aborted) return Promise.resolve();
    return new Promise(resolve => {
      const finish = (): void => {
        clearTimeout(timer);
        signal.removeEventListener('abort', finish);
        resolve();
      };
      const timer = setTimeout(finish, waitMs);
      signal.addEventListener('abort', finish, { once: true });
      void Promise.all(windows.map(window => window.result)).then(finish);
    });
  };

  /** Each item owns one gain envelope and a timer; only its finite buffer nodes change. */
  const startWindowedItem = (
    item: PreviewScheduledItem, contextStart: number, itemEpoch: number, controller: AbortController, prepared?: PreparedWindow,
  ): boolean => {
    const windowed = windowedFor(item);
    if (!context || !windowed) return false;
    const audioContext = context;
    const signal = controller.signal;
    const key = `${item.kind}:${item.id}`;
    if (windowFailures.has(key)) { prepared?.release(); return false; }
    const transportRate = rate;
    const playbackRate = item.playbackRate * transportRate;
    const itemStart = contextStart + item.delaySec / transportRate;
    const late = Math.max(0, audioContext.currentTime - itemStart);
    const baseGain = audioContext.createGain();
    const gains = [baseGain];
    let tail: AudioNode = baseGain;
    if (item.envelopeEvents.length > 0) {
      const envelopeGain = audioContext.createGain();
      baseGain.connect(envelopeGain);
      tail = envelopeGain;
      gains.push(envelopeGain);
      applyGainEvents(envelopeGain.gain, item.envelopeEvents, itemStart, transportRate, late);
    }
    tail.connect(masterGain ?? audioContext.destination);
    applyGainEvents(baseGain.gain, item.gainEvents, itemStart, transportRate, late);
    const gainEntry = registerItemGain(item, baseGain, itemStart, transportRate);
    let consumed = 0;
    let failures = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;
    let filling = false;
    const nodes = new Map<AudioBufferSourceNode, () => void>();
    const current = (): boolean => !stopped && !signal.aborted && playbackEpoch === itemEpoch;
    const disconnectGains = (): void => {
      for (const gain of gains) try { gain.disconnect(); } catch {}
    };
    const stop = (): void => {
      if (stopped) return;
      stopped = true;
      gainEntry.remove();
      if (timer !== null) clearTimeout(timer);
      prepared?.release();
      for (const [source, release] of nodes) {
        source.onended = null;
        try { source.stop(); } catch {}
        try { source.disconnect(); } catch {}
        release();
      }
      nodes.clear();
      disconnectGains();
      windowStops.delete(key);
      windowItems.delete(key);
      delete bufferedUntil[key];
      if (!starting && ![...windowItems.values()].some(entry => entry.controller === controller)) {
        windowControllers.delete(controller);
        controller.abort();
      }
    };
    windowStops.set(key, stop);
    const arm = (delay: number): void => {
      if (current()) timer = setTimeout(() => { timer = null; void fill(); }, delay);
    };
    windowItems.set(key, { key, material: windowed, item, rate: transportRate, controller, resume: () => { if (timer === null) arm(0); } });
    const fill = async (): Promise<void> => {
      if (itemMuted(item)) { const entry = windowItems.get(key); if (entry) entry.suspended = true; }
      if (!current() || filling || itemMuted(item)) return;
      filling = true;
      let retryDelay: number | null = null;
      try {
        while (current() && !itemMuted(item)) {
          const slice = windowSlice(item, windowed, consumed);
          if (!slice) {
            if (nodes.size === 0) stop();
            break;
          }
          const when = itemStart + slice.elapsedSec / playbackRate;
          if (when >= audioContext.currentTime + WINDOW_LOOKAHEAD_SEC) break;
          const request = prepared ?? prepareWindow(windowed, slice, signal);
          prepared = undefined;
          const result = await request.result;
          if (!current() || itemMuted(item)) { request.release(); return; }
          if ('reason' in result) {
            request.release();
            failures += 1;
            if (failures >= 3) {
              windowFailures.add(key);
              warn(`[frame-engine] ${key} PCM windows failed after 3 consecutive attempts`);
              break;
            }
            retryDelay = Math.max(0, result.failedAtMs + FAILED_DECODE_RETRY_MS - now());
            break;
          }
          failures = 0;
          const lateness = Math.max(0, audioContext.currentTime - when);
          if (lateness > 0) windowed.noteLate();
          const skipFrames = Math.min(slice.frames, Math.ceil(lateness * playbackRate * windowed.metadata.sampleRate));
          const skippedSec = skipFrames / windowed.metadata.sampleRate;
          const duration = slice.durationSec - skippedSec;
          consumed += slice.frames;
          if (!(duration > 0)) { request.release(); continue; }
          let buffer = result.buffer;
          if (skipFrames > 0) {
            // Keep source.start's offset at zero even for late arrivals. Copy just the
            // audible suffix; its absolute time still comes from the original cursor.
            buffer = audioContext.createBuffer(buffer.numberOfChannels, slice.frames - skipFrames, buffer.sampleRate);
            for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
              buffer.getChannelData(channel).set(result.buffer.getChannelData(channel).subarray(skipFrames));
            }
          }
          const source = audioContext.createBufferSource();
          source.buffer = buffer;
          source.loop = false;
          source.playbackRate.value = item.playbackRate * transportRate;
          source.connect(baseGain);
          nodes.set(source, request.release);
          source.onended = () => {
            nodes.delete(source);
            try { source.disconnect(); } catch {}
            request.release();
            if (!windowSlice(item, windowed, consumed) && nodes.size === 0) stop();
          };
          source.start(when + skippedSec / playbackRate, 0, duration);
          bufferedUntil[key] = Math.min(item.timelineEndSec,
            item.timelineStartSec + (slice.elapsedSec + slice.durationSec) / item.playbackRate);
        }
      } catch (reason) {
        if (current()) {
          windowFailures.add(key);
          warn(`[frame-engine] ${key} PCM window could not be scheduled`, reason);
        }
      } finally {
        filling = false;
        if (current() && !itemMuted(item) && !windowFailures.has(key) && windowSlice(item, windowed, consumed)) {
          arm(retryDelay ?? WINDOW_REFILL_MS);
        }
      }
    };
    void fill();
    return true;
  };

  const regularScheduleDeclaration = (): PreviewScheduleDeclaration => {
    // ミュートで decode を省いても予定表の宣言は残す。未確定の尺は宣言・sidecar から補う。
    const mutedUnresolved = declarations.filter(item => trackMuted(item.kind, item.spec.track)
      && item.spec.sidecarState !== 'no-audio' && !regularResolved(item)).map(item => ({
        ...item, sidecar: Boolean(validSidecar(item.spec.sidecar)),
        durationSec: [item.spec.durationSec, validSidecar(item.spec.sidecar)?.durationSec]
          .find(finitePositive) ?? timelineDurationSec,
      }));
    const scheduled = [...regularDecoded, ...mutedUnresolved]
      .filter(item => isAudioItemAudible(undefined, item.spec));
    const normalized = scheduled.map(item => ({
      ...item.spec,
      ...(item.duckKey === true ? { duckKey: true,
        mute: !isAudioItemAudible({ muted: trackMuted(item.kind, item.spec.track) }, item.spec) } : {}),
      id: item.id,
      durationSec: item.durationSec,
      ...(!item.sidecar ? { sidecar: undefined } : {}),
    }));
    const bgm = normalized.find((_, index) => scheduled[index]?.kind === 'bgm');
    return {
      ...(bgm ? { bgm } : {}),
      sfx: normalized.filter((_, index) => scheduled[index]?.kind === 'sfx'),
      narration: normalized.filter((_, index) => scheduled[index]?.kind === 'narration'),
    };
  };

  const supplyKeysAt = (positionSec: number, asPlaying: boolean): {
    required: string[]; ready: string[]; pendingSidecar: string[]; failed: string[]; noAudio: string[];
  } => {
    const requiredTasks = tasks.filter(task => {
      if (task.muted() || task.at > positionSec || task.state === 'no-audio') return false;
      const regular = declarations.find(item => `${item.kind}:${item.id}` === task.key);
      if (regular) {
        if (regular.kind === 'bgm') return positionSec < timelineDurationSec;
        const durationSec = [regular.spec.durationSec, validSidecar(regular.spec.sidecar)?.durationSec,
          regularDecoded.find(item => item.kind === regular.kind && item.id === regular.id)?.durationSec]
          .find(finitePositive) ?? Infinity;
        return positionSec < firstUseRegular(regular) + durationSec;
      }
      const spoken = speech.find(item => `speech:${item.id}` === task.key);
      if (spoken) {
        const durationSec = [spoken.durationSec, spoken.sidecar?.durationSec,
          speechDecoded.get(spoken.id)?.durationSec].find(finitePositive) ?? Infinity;
        const crossfadeOutSec = finitePositive(spoken.crossfadeOutSec) ? spoken.crossfadeOutSec! : 0;
        return positionSec < spoken.atSec + durationSec + crossfadeOutSec;
      }
      return true;
    });
    const required = requiredTasks.map(task => task.key);
    const ready = tasks.filter(task => !windowFailures.has(task.key) && task.resolved()
      && (task.state === 'decode' || (task.state === 'windowed'
        && (!asPlaying || (bufferedUntil[task.key] ?? -Infinity) > positionSec))))
      .map(task => task.key);
    const pendingSidecar = tasks.filter(task => task.state === 'pending-sidecar').map(task => task.key);
    const failed = tasks.filter(task => windowFailures.has(task.key)
      || (task.failedAtMs !== null && !task.resolved())).map(task => task.key);
    const noAudio = tasks.filter(task => task.state === 'no-audio').map(task => task.key);
    return { required, ready, pendingSidecar, failed, noAudio };
  };

  /** 開始位置で鳴っているはずなのに、まだ揃っていない required。失敗と no-audio は待たない。 */
  const gateMissingKeys = (positionSec: number, asPlaying: boolean): string[] => {
    const keys = supplyKeysAt(positionSec, asPlaying);
    return keys.required.filter(key => !keys.ready.includes(key)
      && !keys.failed.includes(key) && !keys.noAudio.includes(key));
  };

  /** 開始位置の required がまだ揃っていないときの hold の理由。揃っていれば null。 */
  const gateReasonAt = (positionSec: number): 'first-window' | 'sidecar' | null => {
    const keys = supplyKeysAt(positionSec, true);
    const missing = keys.required.filter(key => !keys.ready.includes(key)
      && !keys.failed.includes(key) && !keys.noAudio.includes(key));
    if (missing.length === 0) return null;
    return missing.some(key => keys.pendingSidecar.includes(key)) ? 'sidecar' : 'first-window';
  };

  const releaseGate = (): void => {
    if (!gate.holding) return;
    gate = { holding: false, startSec: 0, sinceMs: 0, reason: null };
    gateGeneration = -1;
  };
  /** 読むたびに世代・上限・readiness を見て、解けていれば解く。 */
  const gateHolding = (): boolean => {
    if (!gate.holding) return false;
    if (gateGeneration !== generation
      || now() - gate.sinceMs >= PLAY_GATE_MAX_HOLD_SEC * 1000
      || gateMissingKeys(gate.startSec, true).length === 0) {
      releaseGate();
      return false;
    }
    return true;
  };

  /**
   * 空の予定表で gate が降りた後の backoff（500 ms）の隙間。意図の予算内は開始位置に据え置く。
   * 再試行が hold の起点を作り直さないので、絵は 0 へ戻らず先へも進まない。
   */
  const gateIntentHolding = (): boolean => {
    if (!gateIntent || playing) return false;
    if (lastStartOutcome !== 'empty') return false;
    if (now() - gateIntent.sinceMs >= PLAY_GATE_MAX_HOLD_SEC * 1000) return false;
    return gateMissingKeys(gateIntent.startSec, true).length > 0;
  };

  /**
   * 表示上の gate は「張られている gate 本体」か「backoff の隙間を埋める再生意図」のどちらか。
   * 呼び手（Web UI / webview）は 1 つの gate として読むので、ここで 1 つに畳んでから返す。
   */
  const gateView = (): {
    holding: boolean;
    gate: { startSec: number; sinceMs: number; reason: 'first-window' | 'sidecar' | null };
  } => {
    if (gateHolding()) return { holding: true, gate };
    const intent = gateIntent;
    if (intent && gateIntentHolding()) {
      return { holding: true, gate: { startSec: intent.startSec, sinceMs: intent.sinceMs, reason: gateReasonAt(intent.startSec) } };
    }
    return { holding: false, gate };
  };

  // 途中で seek / pause が世代を進めたら黙って降りる（新しい startFrom が starting を持っている）。
  // 自分が最新世代のときだけ starting を戻す。以前は superseded な呼び出しも starting=false を
  // 書いていたため、進行中の新しい startFrom と並んで 3 本目が走れた。
  const startFrom = async (seconds: number, options: { pinStart?: boolean } = {}): Promise<void> => {
    if (!context) return;
    const replanning = playing;
    if (!replanning) playbackEpoch += 1;
    const thisGeneration = ++generation;
    startingWindowController?.abort();
    const controller = new AbortController();
    startingWindowController = controller;
    starting = true;
    lastStartAttemptMs = now();
    const gateStartSec = clamp(options.pinStart ? seconds : latestRequestedSec);
    // 再生中の組み直し（replanIfNeeded の pinStart 起動）は音声時計が既に走っているので hold しない。
    if (playing) {
      releaseGate();
    } else {
      // 「その窓が実際に取れているか」で見るため readiness は再生中と同じ規則（bufferedUntil）で評価する。
      const reason = gateReasonAt(gateStartSec);
      if (reason === null) {
        releaseGate();
      } else {
        gateIntent ??= { startSec: gateStartSec, sinceMs: now() };
        if (now() - gateIntent.sinceMs >= PLAY_GATE_MAX_HOLD_SEC * 1000) {
          releaseGate();
        } else {
          gate = {
            holding: true, startSec: gateIntent.startSec, sinceMs: gateIntent.sinceMs, reason,
          };
          gateGeneration = thisGeneration;
        }
      }
    }
    let outcome: 'started' | 'empty' | 'failed' = 'failed';
    try {
      await ensureDecodedUpTo(clamp(options.pinStart ? seconds : latestRequestedSec));
      if (thisGeneration !== generation) return;
      try {
        await context.resume();
      } catch (reason) {
        warn('[frame-engine] AudioContext resume failed; keeping wall-clock playback', reason);
        return;
      }
      if (thisGeneration !== generation) return;
      // 開始位置の音（sidecar 生成待ちを含む）が揃うまで、上限 3 秒だけ予定表を先送りする。
      if (gateHolding()) {
        await waitForGateStart(gateStartSec, thisGeneration);
        if (thisGeneration !== generation) return;
      }
      const speechForSchedule = speech.flatMap(item => {
        const resolved = speechDecoded.get(item.id);
        // 準備を省いたミュート音源も予定表には残す。実際の開始ループで除外する。
        if (!resolved) return item.sidecarState !== 'no-audio' && trackMuted('speech', item.track) ? [item] : [];
        return [{
          ...item,
          ...(!resolved.sidecar ? { sidecar: undefined, atempo: undefined } : {}),
          materialDurationSec: resolved.durationSec,
        }];
      });
      // 通常の開始は「最新の要求位置」（decode 待ちの間にシークされていれば追従する）。
      // 再生中の組み直し（replanIfNeeded）は音声時計の現在位置で固定する: playbackTime() が
      // rAF ごとに壁時計の fallback を latestRequestedSec に書き戻すので、ここで
      // latestRequestedSec を優先すると音声時計から壁時計へ黙って乗り換えてしまう
      // （gpt-6-astra の指摘 P0）。`||` は 0 秒を落とすので使わない。
      // 窓待ち中に届く更新は、この予定表にはまだ含まれない。
      const planDecodedCount = decodedRevision;
      const scheduleAudio = { ...regularScheduleDeclaration(), speech: speechForSchedule };
      let plan = scheduleBuilder({
        timelineDurationSec,
        startAtSec: clamp(options.pinStart ? seconds : latestRequestedSec),
        audio: scheduleAudio,
      });
      const planWarnings = new Set(plan.warnings);
      for (const warning of planWarnings) warn(`[frame-engine] audio: ${warning}`);
      if (plan.items.length === 0 && !replanning) {
        outcome = 'empty';
        emptyPlanDecodedCount = decodedRevision;
        return;
      }
      const firstWindows = new Map<PreviewScheduledItem, PreparedWindow>();
      for (const item of plan.items) {
        if (itemMuted(item)) continue;
        if (replanning && canKeepItem(item)) continue;
        const windowed = windowedFor(item);
        if (!windowed || item.delaySec > 0 || windowFailures.has(`${item.kind}:${item.id}`)) continue;
        const slice = windowSlice(item, windowed, 0);
        if (slice) firstWindows.set(item, prepareWindow(windowed, slice, controller.signal));
      }
      const waitMs = explicitWindowStartupWaitMs ?? (gate.holding && gateGeneration === thisGeneration
        ? Math.max(0, gate.sinceMs + PLAY_GATE_MAX_HOLD_SEC * 1000 - now()) : 1500);
      await waitForFirstWindows([...firstWindows.values()], controller.signal, waitMs);
      if (thisGeneration !== generation) return;
      const effectiveStart = clamp(options.pinStart && playing ? seconds : latestRequestedSec);
      if (Math.abs(effectiveStart - plan.startAtSec) > 1e-6) {
        plan = scheduleBuilder({ timelineDurationSec, startAtSec: effectiveStart, audio: scheduleAudio });
        for (const warning of plan.warnings) {
          if (!planWarnings.has(warning)) { planWarnings.add(warning); warn(`[frame-engine] audio: ${warning}`); }
        }
        for (const prepared of firstWindows.values()) prepared.release();
        firstWindows.clear();
      }
      // Keep the previous audio alive until its replacement is ready. Explicit
      // transport stops also cancel the startup request while it is waiting.
      startingWindowController = null;
      const kept = new Set(replanning ? plan.items.filter(canKeepItem).map(item => `${item.kind}:${item.id}`) : []);
      if (replanning) {
        for (const item of [...active]) if (!kept.has(item.key)) stopActiveSource(item);
        for (const [key, stop] of [...windowStops]) if (!kept.has(key)) stop();
      } else {
        stopSources();
      }
      windowControllers.add(controller);
      const contextStart = replanning
        ? anchorContextSec + (plan.startAtSec - anchorTimelineSec) / rate
        : context.currentTime + 0.02;
      if (!replanning) {
        anchorTimelineSec = plan.startAtSec;
        anchorContextSec = contextStart;
      }
      lastPlanStartAtSec = plan.startAtSec;
      lastSchedule = plan.items;
      scheduledDecodedCount = planDecodedCount;
      lastSidecarSpeechIds = new Set(speechForSchedule
        .filter(item => item.sidecar || item.atempo).map(item => item.id));
      const skipped: string[] = [];
      for (const item of lastSchedule) {
        if (itemMuted(item) || kept.has(`${item.kind}:${item.id}`)) { firstWindows.get(item)?.release(); continue; }
        const started = windowedFor(item)
          ? startWindowedItem(item, contextStart, playbackEpoch, controller, firstWindows.get(item))
          : startItem(item, contextStart);
        if (!started) skipped.push(`${item.kind}:${item.id}`);
      }
      skippedAtSchedule = skipped;
      if (skipped.length > 0) {
        warn(`[frame-engine] audio: ${skipped.length} scheduled item(s) have no decoded buffer and stay silent: ${
          skipped.join(', ')}`);
      }
      playing = true;
      outcome = 'started';
    } finally {
      if (startingWindowController === controller) startingWindowController = null;
      // A controller remains adopted while any surviving item uses it, including
      // items from older plans. Retire controllers with no live owners.
      for (const adopted of windowControllers) {
        if (![...windowItems.values()].some(item => item.controller === adopted)) {
          windowControllers.delete(adopted);
          adopted.abort();
        }
      }
      if (!windowControllers.has(controller)) controller.abort();
      if (thisGeneration === generation) {
        // 開始できなかったときは gate を解く。空の予定表なら再生意図の予算は再試行へ引き継ぐ。
        // 開始できたときは readiness（最初の窓）と上限だけが hold を解く。
        if (outcome !== 'started') releaseGate();
        if (outcome === 'failed') gateIntent = null;
        starting = false;
        lastStartOutcome = outcome;
        if (replanPending) {
          replanPending = false;
          replanIfNeeded();
        }
      }
    }
  };

  // startFrom の例外で starting が立ったままになると、以後の playFrom / playbackTime が
  // 全部捨てられて document を作り直すまで無音になる。必ず catch して警告にする。
  const launch = (seconds: number, options: { pinStart?: boolean } = {}): void => {
    lastStartOutcome = null;
    startFrom(seconds, options).catch(reason => {
      warn('[frame-engine] audio start failed', reason);
    });
  };

  // 空の予定表（その位置に音源が無い）や失敗の直後は、playbackTime() からの再試行を 500 ms 空ける。
  // seek / pause / playFrom は outcome を消すので、位置が変わればすぐ再開する。
  const restartAllowed = (): boolean =>
    lastStartOutcome === null || now() - lastStartAttemptMs >= RESTART_BACKOFF_MS;

  const pause = (): void => {
    if (playing) latestRequestedSec = contextPosition();
    generation += 1;
    playbackEpoch += 1;
    releaseGate();
    gateIntent = null;
    playing = false;
    starting = false;
    replanPending = false;
    lastStartOutcome = null;
    stopSources();
  };

  const armPauseWatchdog = (): void => {
    if (watchdogMs === false) return;
    if (pauseTimer !== null) clearTimeout(pauseTimer);
    pauseTimer = setTimeout(pause, watchdogMs);
  };

  const debug = (): PreviewAudioSupplyDebug => {
    const latencies = [context?.baseLatency, context?.outputLatency]
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
    const sidecars = uniqueSidecars();
    const audioPositionSec = lastAudioPositionAtRenderSec;
    const perSource = sourceOrder.flatMap(src => {
      const metric = speechMetrics.get(src);
      return metric ? [metric] : [];
    });
    const positionSec = playing ? audioPosition() : latestRequestedSec;
    const { required, ready, pendingSidecar, failed, noAudio } = supplyKeysAt(positionSec, playing);
    const phase = required.length === 0 ? 'idle'
      : required.some(key => pendingSidecar.includes(key)) ? 'preparing'
        : required.some(key => failed.includes(key)) ? 'degraded'
          : required.every(key => ready.includes(key)) ? 'ready' : 'preparing';
    // gate 本体と再生意図を畳んだ 1 つの gate として読む（`gate` はこのスコープの実効値）。
    const { holding, gate } = gateView();
    return {
      supply: { phase, required, ready, pendingSidecar, failed, noAudio, bufferedUntil: { ...bufferedUntil },
        mutedTracks: { cuts: [...mutedCutTracks].sort((a, b) => a - b),
          audio: [...mutedAudioTracks].sort((a, b) => a - b), allCuts: allCutsMuted, allAudio: allAudioMuted },
        gate: { holding, startSec: holding ? gate.startSec : 0, heldMs: holding ? now() - gate.sinceMs : 0, reason: holding ? gate.reason : null } },
      contextState: context?.state ?? 'unavailable',
      outputLatencyMs: latencies.length > 0 ? latencies.reduce((sum, value) => sum + value, 0) * 1000 : null,
      renderedTimelineSec: lastRenderedTimelineSec,
      audioPositionSec,
      driftMs: audioPositionSec === null || lastRenderedTimelineSec === null
        ? null : (lastRenderedTimelineSec - audioPositionSec) * 1000,
      playing,
      rate,
      pitchPreserved: rate === 1 || stretcher === 'worklet',
      stretcher,
      scheduled: {
        startAtSec: lastSchedule.length > 0 ? lastPlanStartAtSec : null,
        itemCount: lastSchedule.length,
        bgm: lastSchedule.filter(item => item.kind === 'bgm').length,
        sfx: lastSchedule.filter(item => item.kind === 'sfx').length,
        narration: lastSchedule.filter(item => item.kind === 'narration').length,
        speech: lastSchedule.filter(item => item.kind === 'speech').length,
        skipped: [...skippedAtSchedule],
      },
      prefetch: {
        items: tasks.length,
        decodedBytes,
        elapsedMs: prefetchElapsedMs || (prefetchStartedAt ? now() - prefetchStartedAt : 0),
        pending: prefetchPending,
        failed,
        compact: [...decoded.values()].filter(entry => entry.compact).length,
        overBudget: decodedBytes > cacheLimit,
        windows: [...windowSources.values()].reduce<PcmWindowStats>((sum, source) => {
          const stats = source.debug();
          for (const name of Object.keys(sum) as Array<keyof PcmWindowStats>) sum[name] += stats[name];
          return sum;
        }, { fetched: 0, bytes: 0, cacheBytes: 0, evicted: 0, late: 0, failed: 0 }),
      },
      sidecars: {
        generated: sidecars.filter(item => item.skipped === false).length,
        skipped: sidecars.filter(item => item.skipped === true).length,
        bytes: sidecars.reduce((sum, item) => sum + (finiteNonNegative(item.bytes) ? item.bytes! : 0), 0),
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

  const replaceTask = (key: string, replacement: PrefetchTask): void => {
    const index = tasks.findIndex(task => task.key === key);
    if (index < 0) return;
    replacement.updated = true;
    tasks[index] = replacement;
    if (activePrefetchQueue && replacement.state === 'decode') {
      replacement.queued = true;
      activePrefetchQueue.push(replacement);
      prefetchPending += 1;
    }
  };

  const updateAudio: PreviewAudioSupply['updateAudio'] = next => {
    if (disposed) return;
    let changed = false;
    if (next.declarations) {
      const incoming = new Map(next.declarations.map(item => [`${item.kind}:${item.id}`, item]));
      const existing = new Set(declarations.map(item => `${item.kind}:${item.id}`));
      for (const key of incoming.keys()) {
        if (!existing.has(key)) warn(`[frame-engine] audio ${key} added; rebuild required`);
      }
      declarations.forEach((item, index) => {
        const key = `${item.kind}:${item.id}`;
        const replacement = incoming.get(key);
        if (!replacement) { warn(`[frame-engine] audio ${key} removed; rebuild required`); return; }
        if (item.spec.sidecarState === replacement.spec.sidecarState && item.url === replacement.url
          && item.sourceUrl === replacement.sourceUrl && item.duckKey === replacement.duckKey
          && JSON.stringify(item.spec) === JSON.stringify(replacement.spec)) return;
        declarations[index] = replacement;
        regularDecoded = regularDecoded.filter(value => `${value.kind}:${value.id}` !== key);
        windowFailures.delete(key);
        replaceTask(key, regularTask(replacement));
        changed = true;
      });
    }
    if (next.speech) {
      const incoming = new Map(next.speech.map(item => [item.id, item]));
      const existing = new Set(speech.map(item => item.id));
      for (const id of incoming.keys()) {
        if (!existing.has(id)) warn(`[frame-engine] audio speech:${id} added; rebuild required`);
      }
      speech.forEach((item, index) => {
        const replacement = incoming.get(item.id);
        if (!replacement) { warn(`[frame-engine] audio speech:${item.id} removed; rebuild required`); return; }
        if (item.sidecarState === replacement.sidecarState && item.url === replacement.url
          && item.sidecar?.path === replacement.sidecar?.path && item.atempo?.path === replacement.atempo?.path) return;
        speech[index] = replacement;
        speechDecoded.delete(item.id);
        windowFailures.delete(`speech:${item.id}`);
        replaceTask(`speech:${item.id}`, speechTask(replacement));
        changed = true;
      });
    }
    if (!changed) return;
    decodedRevision += 1;
    tasks.sort((left, right) => left.at - right.at);
    notifyTaskSettled();
    void ensureDecoded().then(() => replanIfNeeded()).catch(reason => {
      warn('[frame-engine] audio update failed', reason);
    });
  };

  return {
    updateAudio,
    setMutedTracks(muted) {
      if (disposed) return;
      const cuts = muted.cuts === undefined ? mutedCutTracks : new Set([...muted.cuts].map(normalizedTrack));
      const audio = muted.audio === undefined ? mutedAudioTracks : new Set([...muted.audio].map(normalizedTrack));
      const allCuts = muted.allCuts ?? allCutsMuted;
      const allAudio = muted.allAudio ?? allAudioMuted;
      const equal = (left: Set<number>, right: Set<number>): boolean =>
        left.size === right.size && [...left].every(track => right.has(track));
      if (equal(cuts, mutedCutTracks) && equal(audio, mutedAudioTracks)
        && allCuts === allCutsMuted && allAudio === allAudioMuted) return;
      const released = (before: Set<number>, after: Set<number>, allBefore: boolean, allAfter: boolean): boolean =>
        !allAfter && (allBefore || [...before].some(track => !after.has(track)));
      const unmuted = released(mutedCutTracks, cuts, allCutsMuted, allCuts)
        || released(mutedAudioTracks, audio, allAudioMuted, allAudio);
      const previous = new Map([...activeItemGains].map(entry => [entry, trackMuted(entry.kind, entry.track)]));
      mutedCutTracks = cuts;
      mutedAudioTracks = audio;
      allCutsMuted = allCuts;
      allAudioMuted = allAudio;
      if (context) for (const entry of activeItemGains) {
        const silent = trackMuted(entry.kind, entry.track);
        if (silent === previous.get(entry)) continue;
        entry.baseGain.gain.cancelScheduledValues(context.currentTime);
        if (silent) entry.baseGain.gain.setValueAtTime(0, context.currentTime);
        else applyGainEvents(entry.baseGain.gain, entry.gainEvents, entry.startTime, entry.transportRate);
      }
      notifyTaskSettled();
      // 保持されたままの PCM 窓 item は補充ループがミュートで止まっているので、解除で再開させる。
      if (unmuted) for (const entry of windowItems.values()) if (!itemMuted(entry.item)) entry.resume?.();
      if (unmuted && (playing || starting)) {
        // 進行中の先読みでミュートのため飛ばした task も、完了後にもう一度拾う。
        void ensureDecoded().then(() => ensureDecoded()).catch(reason => {
          warn('[frame-engine] audio unmute failed', reason);
        });
        launch(audioPosition(), { pinStart: true });
      } else if ((playing || starting) && declarations.some(item => item.duckKey === true)) {
        // Split speech keys must disappear along with their owning audio track.
        launch(audioPosition(), { pinStart: true });
      }
    },
    prime() {
      ensureDecoded().catch(reason => {
        warn('[frame-engine] audio prefetch failed', reason);
      });
    },
    playFrom(seconds) {
      latestRequestedSec = clamp(seconds);
      if (context && !playing && !starting) {
        gateIntent = { startSec: latestRequestedSec, sinceMs: now() };
        launch(latestRequestedSec);
      }
    },
    position(fallbackSeconds) {
      if (gateHolding()) { latestRequestedSec = gate.startSec; return gate.startSec; }
      if (gateIntentHolding()) { latestRequestedSec = gateIntent!.startSec; return gateIntent!.startSec; }
      latestRequestedSec = clamp(fallbackSeconds);
      return playing ? audioPosition() : latestRequestedSec;
    },
    playbackTime(fallbackSeconds) {
      if (gateHolding()) {
        latestRequestedSec = gate.startSec;
        armPauseWatchdog();
        return gate.startSec;
      }
      // 隙間でも開始位置を据え置いたまま、backoff 明けの再 launch は従来どおり行う。
      if (gateIntentHolding()) latestRequestedSec = gateIntent!.startSec;
      else latestRequestedSec = clamp(fallbackSeconds);
      if (!context) return latestRequestedSec;
      armPauseWatchdog();
      if (!playing && !starting && restartAllowed()) launch(latestRequestedSec);
      return playing ? audioPosition() : latestRequestedSec;
    },
    seek(seconds, continuePlaying = false) {
      latestRequestedSec = clamp(seconds);
      generation += 1;
      playbackEpoch += 1;
      releaseGate();
      playing = false;
      starting = false;
      replanPending = false;
      lastStartOutcome = null;
      stopSources();
      // 実際に再開するときだけ新しい再生意図を作る（止めるだけのシークは意図を捨てる）。
      gateIntent = null;
      if (continuePlaying && context) {
        gateIntent = { startSec: latestRequestedSec, sinceMs: now() };
        launch(latestRequestedSec);
      }
    },
    pause,
    setRate(value) {
      const nextRate = clampPlaybackRate(value);
      if (nextRate === rate) return;
      const wasPlaying = playing;
      const wasStarting = starting;
      const position = wasPlaying ? contextPosition() : latestRequestedSec;
      playbackEpoch += 1;
      rate = nextRate;
      latestRequestedSec = position;
      routeMasterBus();
      if (wasPlaying || wasStarting) {
        generation += 1;
        releaseGate();
        playing = false;
        starting = false;
        replanPending = false;
        lastStartOutcome = null;
        stopSources();
        gateIntent = { startSec: latestRequestedSec, sinceMs: now() };
        launch(latestRequestedSec);
      }
    },
    attachAnalyser() {
      if (!context || !masterGain) return null;
      if (!analyser) {
        analyser = context.createAnalyser();
        analyser.connect(context.destination);
        routeMasterBus();
      }
      return analyser;
    },
    noteRendered(seconds) {
      lastRenderedTimelineSec = clamp(seconds);
      lastAudioPositionAtRenderSec = context && playing ? audioPosition() : null;
    },
    debug,
    dispose() {
      disposed = true;
      wakePrefetch?.();
      if (pauseTimer !== null) clearTimeout(pauseTimer);
      pauseTimer = null;
      pause();
      try { masterGain?.disconnect(); } catch {}
      disconnectPitchShiftNode();
      try { analyser?.disconnect(); } catch {}
      decoded.clear();
      for (const source of windowSources.values()) source.dispose();
      windowSources.clear();
      decodedBytes = 0;
      void context?.close().catch(() => undefined);
    },
  };
}

function normalizedTrack(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0;
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

function clampPlaybackRate(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.max(0.5, Math.min(3, value))
    : 1;
}

function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function defaultOfflineContextFactory(sampleRate: number): BaseAudioContext | null {
  const scope = globalThis as typeof globalThis & { webkitOfflineAudioContext?: typeof OfflineAudioContext };
  const Ctor = scope.OfflineAudioContext ?? scope.webkitOfflineAudioContext;
  if (typeof Ctor !== 'function') return null;
  try {
    return new Ctor(1, 1, sampleRate);
  } catch {
    return null;
  }
}

/** 圧縮音声（mp3 / AAC 等）の展開倍率の粗い上限。128 kbps を 48 kHz ステレオ float32 にすると約 24 倍。長尺判定にだけ使う。 */
const COMPRESSED_DECODE_EXPANSION = 16;

/**
 * decodeAudioData 後の float32 PCM サイズ（context のレートへ resample 後）を decode 前に見積もる。
 * WAV / FLAC はヘッダから正確に、それ以外は圧縮率の粗い上限で。長尺を compact で decode するかの判定用。
 */
export function estimateDecodedBytes(encoded: ArrayBuffer, contextSampleRate: number): number {
  const view = new DataView(encoded);
  const ratio = (sourceRate: number): number =>
    finitePositive(contextSampleRate) && finitePositive(sourceRate) ? contextSampleRate / sourceRate : 1;
  const wav = parseWavHeader(view);
  if (wav) return wav.frames * ratio(wav.sampleRate) * wav.channels * 4;
  const flac = parseFlacStreamInfo(view);
  if (flac) return flac.frames * ratio(flac.sampleRate) * flac.channels * 4;
  return encoded.byteLength * COMPRESSED_DECODE_EXPANSION;
}

interface PcmShape { sampleRate: number; channels: number; frames: number }

function readAscii(view: DataView, offset: number, length: number): string {
  if (offset + length > view.byteLength) return '';
  let text = '';
  for (let index = 0; index < length; index += 1) text += String.fromCharCode(view.getUint8(offset + index));
  return text;
}

/** RIFF/WAVE: fmt チャンクのレート・ch・blockAlign と data チャンクの実バイト数からフレーム数を得る。 */
export function parseWavHeader(view: DataView): PcmShape | null {
  if (view.byteLength < 12 || readAscii(view, 0, 4) !== 'RIFF' || readAscii(view, 8, 4) !== 'WAVE') return null;
  let offset = 12;
  let format: { sampleRate: number; channels: number; blockAlign: number } | null = null;
  while (offset + 8 <= view.byteLength) {
    const id = readAscii(view, offset, 4);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (id === 'fmt ' && body + 16 <= view.byteLength) {
      const channels = view.getUint16(body + 2, true);
      const sampleRate = view.getUint32(body + 4, true);
      const blockAlign = view.getUint16(body + 12, true);
      if (channels > 0 && sampleRate > 0 && blockAlign > 0) format = { sampleRate, channels, blockAlign };
    } else if (id === 'data') {
      if (!format) return null;
      // 実ファイル全体を持っているので、宣言サイズ（ストリーミング WAV の 0xFFFFFFFF 等）より実バイト数を信じる
      const dataBytes = Math.min(size, Math.max(0, view.byteLength - body));
      return {
        sampleRate: format.sampleRate,
        channels: format.channels,
        frames: Math.floor(dataBytes / format.blockAlign),
      };
    }
    offset = body + size + (size % 2);
  }
  return null;
}

/** FLAC: 先頭 STREAMINFO（sample rate 20 bit / channels 3 bit / total samples 36 bit）。 */
export function parseFlacStreamInfo(view: DataView): PcmShape | null {
  if (view.byteLength < 42 || readAscii(view, 0, 4) !== 'fLaC') return null;
  if ((view.getUint8(4) & 0x7f) !== 0) return null;
  const base = 8;
  const b10 = view.getUint8(base + 10);
  const b11 = view.getUint8(base + 11);
  const b12 = view.getUint8(base + 12);
  const b13 = view.getUint8(base + 13);
  const sampleRate = (b10 << 12) | (b11 << 4) | (b12 >> 4);
  const channels = ((b12 >> 1) & 0x07) + 1;
  const frames = (b13 & 0x0f) * 4294967296 + view.getUint32(base + 14, false);
  if (!(sampleRate > 0) || !(frames > 0)) return null;
  return { sampleRate, channels, frames };
}

/** 多チャンネル buffer を平均でモノラルへ畳む。畳めない環境（createBuffer 無し）ではそのまま返す。 */
export function downmixToMono(buffer: AudioBuffer, context: BaseAudioContext): AudioBuffer {
  if (buffer.numberOfChannels <= 1) return buffer;
  if (typeof context.createBuffer !== 'function' || typeof buffer.getChannelData !== 'function') return buffer;
  const mono = context.createBuffer(1, buffer.length, buffer.sampleRate);
  const out = mono.getChannelData(0);
  const scale = 1 / buffer.numberOfChannels;
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let index = 0; index < out.length; index += 1) out[index] = (out[index] ?? 0) + (data[index] ?? 0) * scale;
  }
  return mono;
}
