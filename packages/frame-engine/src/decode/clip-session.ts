// Adapted from packages/preview-engine/src/clipSession.ts.
import { MP4Clip } from '../../vendor/av-cliper/av-cliper.js';
import type { FrameMetricsRecorder, NativeFrameSource } from '../types.js';
import {
  evaluateCodecSupport,
  readVideoCodecFromMoov,
  type CodecSupport,
} from './codec-probe.js';
import {
  createDecoderErrorGuard,
  isDecoderErrorMessage,
  withProgressBudget,
  withTimeout,
} from './guard.js';
import { buildKeyframeIndexFromHeader, type KeyframeIndex } from './keyframe-index.js';
import {
  calculateLoadBudgetMs,
  DEFAULT_LOAD_BYTES_PER_SECOND,
  RetainedSourceBytes,
} from './source-bytes.js';
import { RangeMp4Source, type RangeFetchStats } from './range-mp4-source.js';

export type ClipSessionState = 'idle' | 'loading' | 'ready' | 'degraded' | 'unavailable';

export interface ClipSessionOptions {
  loadTimeoutMs?: number;
  loadBudgetMs?: number;
  loadStallMs?: number;
  loadBytesPerSecond?: number;
  retainBudgetBytes?: number;
  tickTimeoutMs?: number;
  decoderErrorGraceMs?: number;
  hardwareAcceleration?: HardwarePreference;
  codecSupport?: CodecSupport | null;
  onWarning?: (message: string) => void;
  onDecoderDegraded?: () => void;
  onCodecSupport?: (support: CodecSupport) => void;
  onSoftwareFallbackDenied?: (support: CodecSupport) => void;
}

class DecoderGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DecoderGuardError';
  }
}

const AV_CLIPER_RESET_WINDOW_US = 3_000_000;
const MAX_EXACT_FRAME_TICKS = 4;

export type FrameEngineSourceMode = 'range' | 'mp4clip';

export function resolveFrameEngineSourceMode(
  environment?: Readonly<Record<string, string | undefined>>,
): FrameEngineSourceMode {
  const runtime = globalThis as typeof globalThis & {
    process?: { env?: Record<string, string | undefined> };
    __AKARI_FRAME_ENGINE_SOURCE__?: string;
  };
  const value = environment
    ? environment.AKARI_FRAME_ENGINE_SOURCE
    : runtime.__AKARI_FRAME_ENGINE_SOURCE__
      ?? runtime.process?.env?.AKARI_FRAME_ENGINE_SOURCE;
  return value === 'mp4clip' ? 'mp4clip' : 'range';
}

export function describeUnusableDecoder(
  clipId: string,
  attempted: readonly string[],
  lastMessage: string,
): string | null {
  if (!lastMessage.includes('Unsupported configuration')) return null;
  return [
    `clip ${clipId}: this runtime has no usable decoder for this clip's codec`,
    `after trying hardwareAcceleration [${attempted.join(', ')}].`,
    'Environments with hardware acceleration disabled require a software decoder bundled with the runtime.',
    `Original decoder error: ${lastMessage}`,
  ].join(' ');
}

/** Owns one decoded frame and answers every timestamp covered by its declared duration. */
export class DecodedFrameCoverageCache {
  private frame: VideoFrame | null = null;

  cloneAt(targetUs: number): VideoFrame | null {
    return this.frame && frameCoversTimestamp(this.frame, targetUs) ? this.frame.clone() : null;
  }

  adopt(frame: VideoFrame): void {
    this.frame?.close();
    this.frame = frame;
  }

  remember(frame: VideoFrame): void {
    this.adopt(frame.clone());
  }

  cloneStored(): VideoFrame | null {
    return this.frame?.clone() ?? null;
  }

  cloneNearestAtOrBefore(targetUs: number): VideoFrame | null {
    return this.frame && this.frame.timestamp <= targetUs ? this.frame.clone() : null;
  }

  clear(): void {
    this.frame?.close();
    this.frame = null;
  }
}

export class ClipSession implements NativeFrameSource {
  readonly id: string;
  readonly src: string;
  state: ClipSessionState = 'idle';
  meta: { duration: number; width: number; height: number } | null = null;
  private clip: MP4Clip | null = null;
  private range: RangeMp4Source | null = null;
  private keyframes: KeyframeIndex | null = null;
  private lastFrameStartUs: number | null = null;
  private decoderTimestampOffsetUs = 0;
  private lastTickTargetUs: number | null = null;
  private activeAcceleration: HardwarePreference | undefined;
  private readonly coverage = new DecodedFrameCoverageCache();
  private loadPromise: Promise<void> | null = null;
  private preparePromise: Promise<void> | null = null;
  private preparedCandidate: MP4Clip | null = null;
  private preparedRange: RangeMp4Source | null = null;
  private preparedKeyframes: KeyframeIndex | null = null;
  private cachedHeader: ArrayBuffer | null = null;
  private cachedKeyframes: KeyframeIndex | null = null;
  private learnedSupport: CodecSupport | null = null;
  private codecLearningStarted = false;
  private softwareFallbackWarningShown = false;
  private prepareGeneration = 0;
  private queue: Promise<unknown> = Promise.resolve();
  private sourceBytes: RetainedSourceBytes;
  private ownsSourceBytes = true;
  private readonly sourceMode: FrameEngineSourceMode;
  private readonly options: {
    loadTimeoutMs?: number;
    loadBudgetMs?: number;
    loadStallMs: number;
    loadBytesPerSecond: number;
    tickTimeoutMs: number;
    decoderErrorGraceMs: number;
    hardwareAcceleration?: HardwarePreference;
    codecSupport?: CodecSupport | null;
    onWarning?: (message: string) => void;
    onDecoderDegraded?: () => void;
    onCodecSupport?: (support: CodecSupport) => void;
    onSoftwareFallbackDenied?: (support: CodecSupport) => void;
  };

  constructor(id: string, src: string, options: ClipSessionOptions = {}) {
    this.id = id;
    this.src = src;
    this.sourceMode = resolveFrameEngineSourceMode();
    this.options = {
      loadTimeoutMs: options.loadTimeoutMs,
      loadBudgetMs: options.loadBudgetMs,
      loadStallMs: options.loadStallMs ?? 5_000,
      loadBytesPerSecond: options.loadBytesPerSecond ?? DEFAULT_LOAD_BYTES_PER_SECOND,
      tickTimeoutMs: options.tickTimeoutMs ?? 10_000,
      decoderErrorGraceMs: options.decoderErrorGraceMs ?? 1_000,
      hardwareAcceleration: options.hardwareAcceleration,
      codecSupport: options.codecSupport,
      onWarning: options.onWarning,
      onDecoderDegraded: options.onDecoderDegraded,
      onCodecSupport: options.onCodecSupport,
      onSoftwareFallbackDenied: options.onSoftwareFallbackDenied,
    };
    this.sourceBytes = new RetainedSourceBytes(src, {
      retainBudgetBytes: options.retainBudgetBytes,
      loadBudgetMs: options.loadBudgetMs ?? options.loadTimeoutMs,
      loadStallMs: options.loadStallMs,
      loadBytesPerSecond: options.loadBytesPerSecond,
      onWarning: options.onWarning,
      label: id,
    });
  }

  getFetchCount(): number {
    return this.sourceBytes.getFetchCount();
  }

  load(): Promise<void> {
    this.loadPromise ??= this.doLoad();
    return this.loadPromise;
  }

  /** Parses the MP4 header and keyframe table without creating a VideoDecoder. */
  prepare(): Promise<void> {
    if (this.clip || this.range || this.loadPromise || this.preparedCandidate || this.preparedRange) {
      return Promise.resolve();
    }
    if (this.preparePromise) return this.preparePromise;
    const generation = this.prepareGeneration;
    let tracked: Promise<void>;
    tracked = this.doPrepare(generation).finally(() => {
      if (this.preparePromise === tracked) this.preparePromise = null;
    });
    this.preparePromise = tracked;
    return tracked;
  }

  private async doPrepare(generation: number): Promise<void> {
    if (this.sourceMode === 'range') {
      let candidate: RangeMp4Source | null = null;
      try {
        candidate = this.createRangeSource();
        await candidate.prepare();
        if (generation !== this.prepareGeneration) {
          candidate.destroy();
          return;
        }
        this.preparedRange = candidate;
      } catch (error) {
        candidate?.destroy();
        if (generation === this.prepareGeneration) {
          this.preparedRange = null;
          this.options.onWarning?.(`${this.id}: prepare failed: ${String(error)}`);
        }
      }
      return;
    }
    let candidate: MP4Clip | null = null;
    try {
      const source = await this.sourceBytes.open();
      candidate = new MP4Clip(source.stream, {
        audio: false,
        __unsafe_hardwareAcceleration__: this.options.hardwareAcceleration ?? 'prefer-hardware'
      });
      await this.waitForReady(candidate.ready, source, `prepare ${this.id}`);
      const keyframes = await this.readKeyframes(candidate);
      if (generation !== this.prepareGeneration) {
        candidate.destroy();
        candidate = null;
        return;
      }
      this.preparedKeyframes = keyframes;
      this.preparedCandidate = candidate;
      candidate = null;
    } catch (error) {
      candidate?.destroy();
      if (generation === this.prepareGeneration) {
        this.preparedCandidate = null;
        this.preparedKeyframes = null;
        this.options.onWarning?.(`${this.id}: prepare failed: ${String(error)}`);
      }
    }
  }

  private async doLoad(): Promise<void> {
    if (this.sourceMode === 'range') return this.doLoadRange();
    this.state = 'loading';
    this.coverage.clear();
    let lastError: unknown;
    const attemptedAccelerations: HardwarePreference[] = [];
    for (let round = 0; round < 3; round += 1) {
      if (round > 0) {
        await new Promise(resolve => setTimeout(resolve, round * 150));
      }
      for (const attempt of this.loadAttempts()) {
        attemptedAccelerations.push(attempt.hardwareAcceleration);
        let candidate: MP4Clip | null = null;
        try {
          const guard = createDecoderErrorGuard({
            acceleration: attempt.hardwareAcceleration,
            graceMs: this.options.decoderErrorGraceMs,
          });
          let usedPrepared = false;
          try {
            if (attempt.hardwareAcceleration === (this.options.hardwareAcceleration ?? 'prefer-hardware')) {
              await this.preparePromise;
              if (this.preparedCandidate) {
                candidate = this.preparedCandidate;
                this.preparedCandidate = null;
                this.applyKeyframes(this.preparedKeyframes);
                this.preparedKeyframes = null;
                usedPrepared = true;
              }
            }
            if (!candidate) {
              const source = await this.sourceBytes.open();
              candidate = new MP4Clip(source.stream, {
                audio: false,
                __unsafe_hardwareAcceleration__: attempt.hardwareAcceleration
              });
              await this.waitForReady(
                Promise.race([candidate.ready, guard.failure]),
                source,
                `ready ${this.id}`,
              );
            }
            if (!usedPrepared) {
              this.applyKeyframes(await this.readKeyframes(candidate));
            }
            const primeTarget = this.toDecoderTime(0);
            const rawPrimed = await withTimeout(
              Promise.race([candidate.tick(primeTarget), guard.failure]),
              this.options.tickTimeoutMs,
              `prime ${this.id}`
            );
            const primed = this.normalizeTickResult(rawPrimed);
            if (!primed.video) {
              const observed = guard.observed();
              if (observed) throw new Error(`decoder error: ${observed}`);
            }
            this.lastTickTargetUs = primeTarget;
            if (primed.video) this.coverage.adopt(primed.video);
          } finally {
            guard.stop();
          }
          this.clip = candidate;
          this.activeAcceleration = attempt.hardwareAcceleration;
          this.meta = {
            ...candidate.meta,
            duration: this.keyframes?.presentationDurationUs
              ?? Math.max(0, candidate.meta.duration - this.decoderTimestampOffsetUs),
          };
          this.state = attempt.state;
          if (attempt.state === 'degraded') {
            this.options.onDecoderDegraded?.();
            this.options.onWarning?.(`${this.id}: software decoder fallback active`);
          }
          return;
        } catch (error) {
          this.coverage.clear();
          this.keyframes = null;
          this.lastFrameStartUs = null;
          this.decoderTimestampOffsetUs = 0;
          candidate?.destroy();
          lastError = error;
          this.options.onWarning?.(`${this.id}: ${String(error)}`);
        }
      }
      if (!isDecoderErrorMessage(lastError)) break;
    }
    this.state = 'unavailable';
    const lastMessage = lastError instanceof Error ? lastError.message : String(lastError);
    const diagnostic = describeUnusableDecoder(
      this.id,
      attemptedAccelerations,
      lastMessage,
    );
    if (diagnostic) throw new Error(diagnostic, { cause: lastError });
    throw lastError instanceof Error ? lastError : new Error(lastMessage);
  }

  private createRangeSource(): RangeMp4Source {
    return new RangeMp4Source(this.id, this.src, {
      loadTimeoutMs: this.options.loadTimeoutMs,
      decodeTimeoutMs: this.options.tickTimeoutMs,
      hardwareAcceleration: this.options.hardwareAcceleration,
      codecSupport: this.options.codecSupport ?? this.learnedSupport,
      onWarning: this.options.onWarning,
      onCodecSupport: support => {
        this.learnedSupport = support;
        this.options.onCodecSupport?.(support);
      },
      onSoftwareFallbackDenied: this.options.onSoftwareFallbackDenied,
    });
  }

  private async doLoadRange(): Promise<void> {
    this.state = 'loading';
    let candidate: RangeMp4Source | null = null;
    try {
      await this.preparePromise;
      candidate = this.preparedRange ?? this.createRangeSource();
      this.preparedRange = null;
      await candidate.load();
      this.range = candidate;
      candidate = null;
      this.applyKeyframes(this.range.keyframes);
      this.meta = { ...this.range.meta };
      this.state = this.range.decoderAcceleration === 'prefer-software' ? 'degraded' : 'ready';
      if (this.state === 'degraded') {
        this.options.onDecoderDegraded?.();
        this.options.onWarning?.(`${this.id}: software decoder fallback active`);
      }
    } catch (error) {
      candidate?.destroy();
      this.range?.destroy();
      this.range = null;
      this.state = 'unavailable';
      throw error;
    }
  }

  private async readKeyframes(clip: MP4Clip): Promise<KeyframeIndex | null> {
    if (this.cachedKeyframes) return this.cachedKeyframes;
    try {
      const header = this.cachedHeader
        ?? await withTimeout(clip.getFileHeaderBinData(), 2_000, `header ${this.id}`);
      if (!this.cachedHeader) {
        this.cachedHeader = header;
        this.learnCodecSupport(header);
      }
      const keyframes = await withTimeout(buildKeyframeIndexFromHeader(header), 2_000, `keyframes ${this.id}`);
      this.cachedKeyframes = keyframes;
      return keyframes;
    } catch (error) {
      this.options.onWarning?.(`${this.id}: keyframe index unavailable: ${String(error)}`);
      return null;
    }
  }

  private waitForReady<T>(
    promise: Promise<T>,
    source: { totalBytes: number | null; progress: () => number },
    label: string,
  ): Promise<T> {
    const budgetMs = this.options.loadBudgetMs
      ?? this.options.loadTimeoutMs
      ?? calculateLoadBudgetMs(source.totalBytes, this.options.loadBytesPerSecond);
    return withProgressBudget(promise, {
      budgetMs,
      stallMs: this.options.loadStallMs,
      progress: source.progress,
      label,
    });
  }

  private effectiveSupport(): CodecSupport | null {
    return this.options.codecSupport ?? this.learnedSupport;
  }

  private loadAttempts(): Array<{
    hardwareAcceleration: HardwarePreference;
    state: 'ready' | 'degraded';
  }> {
    if (this.options.hardwareAcceleration) {
      return [{
        hardwareAcceleration: this.options.hardwareAcceleration,
        state: this.options.hardwareAcceleration === 'prefer-software' ? 'degraded' : 'ready',
      }];
    }
    const support = this.effectiveSupport();
    if (support?.sw === false) {
      if (!this.softwareFallbackWarningShown) {
        this.softwareFallbackWarningShown = true;
        this.options.onWarning?.(
          `${this.id}: software decoder fallback is unavailable for ${support.codec}`,
        );
        this.options.onSoftwareFallbackDenied?.(support);
      }
      return [{ hardwareAcceleration: 'prefer-hardware', state: 'ready' }];
    }
    return [
      { hardwareAcceleration: 'prefer-hardware', state: 'ready' },
      { hardwareAcceleration: 'prefer-software', state: 'degraded' },
    ];
  }

  private learnCodecSupport(header: ArrayBuffer): void {
    if (this.codecLearningStarted || this.options.codecSupport) return;
    const info = readVideoCodecFromMoov(header);
    if (!info || typeof VideoDecoder === 'undefined') return;
    this.codecLearningStarted = true;
    void evaluateCodecSupport(info.codec, info).then(support => {
      this.learnedSupport = support;
      this.options.onCodecSupport?.(support);
    }, error => {
      this.options.onWarning?.(`${this.id}: codec support probe failed: ${String(error)}`);
    });
  }

  private applyKeyframes(keyframes: KeyframeIndex | null): void {
    this.keyframes = keyframes;
    this.lastFrameStartUs = keyframes?.lastFrameStartUs ?? null;
    this.decoderTimestampOffsetUs = keyframes?.decoderTimestampOffsetUs ?? 0;
  }

  private async ensureParsed(): Promise<void> {
    if (this.sourceMode === 'range') {
      if (this.range) return;
      await this.prepare();
      if (this.preparedRange) {
        this.range = this.preparedRange;
        this.preparedRange = null;
        this.applyKeyframes(this.range.keyframes);
        this.meta = { ...this.range.meta };
        this.state = 'ready';
        this.loadPromise = Promise.resolve();
        return;
      }
      await this.load();
      return;
    }
    if (this.clip) return;
    await this.prepare();
    if (this.preparedCandidate) {
      this.clip = this.preparedCandidate;
      this.preparedCandidate = null;
      this.applyKeyframes(this.preparedKeyframes);
      this.preparedKeyframes = null;
      this.meta = {
        ...this.clip.meta,
        duration: this.keyframes?.presentationDurationUs
          ?? Math.max(0, this.clip.meta.duration - this.decoderTimestampOffsetUs)
      };
      this.state = this.options.hardwareAcceleration === 'prefer-software' ? 'degraded' : 'ready';
      this.activeAcceleration = this.options.hardwareAcceleration ?? 'prefer-hardware';
      this.lastTickTargetUs = null;
      this.loadPromise = Promise.resolve();
      return;
    }
    await this.load();
  }

  async decode(timeUs: number, metrics?: FrameMetricsRecorder): Promise<VideoFrame> {
    if (this.sourceMode === 'range') {
      await this.load();
      if (!this.range || this.state === 'unavailable') throw new Error(`clip ${this.id} is unavailable`);
      const tickStarted = performance.now();
      const frame = await this.serialize(() => this.range!.decode(timeUs));
      if (this.range.decoderAcceleration === 'prefer-software' && this.state !== 'degraded') {
        this.state = 'degraded';
        this.options.onDecoderDegraded?.();
        this.options.onWarning?.(`${this.id}: software decoder fallback active`);
      }
      metrics?.record('tick', performance.now() - tickStarted);
      return frame;
    }
    await this.load();
    if (!this.clip || this.state === 'unavailable') throw new Error(`clip ${this.id} is unavailable`);
    const duration = this.meta?.duration ?? Number.POSITIVE_INFINITY;
    const fallbackLimit = Math.max(0, duration - 1);
    const safeLimit = this.lastFrameStartUs ?? fallbackLimit;
    const target = Math.max(0, Math.min(Math.floor(timeUs), safeLimit));
    const covered = this.coverage.cloneAt(target);
    if (covered) return covered;
    const tickStarted = performance.now();
    const result = await this.serialize(async () => {
      try {
        return await this.guardedExactTick(target);
      } catch (error) {
        if (!(error instanceof DecoderGuardError) && !isDecoderErrorMessage(error)) throw error;
        if (!(error instanceof DecoderGuardError)) {
          this.options.onWarning?.(`${this.id}: decoder runtime error: ${String(error)}`);
        }
        await this.recreateDecoder();
        return this.guardedExactTick(target);
      }
    });
    metrics?.record('tick', performance.now() - tickStarted);
    if (!result.video) {
      const coveredAfterTick = this.coverage.cloneAt(target);
      if (coveredAfterTick) return coveredAfterTick;
      if (this.lastFrameStartUs != null && target >= this.lastFrameStartUs) {
        const nearest = this.coverage.cloneNearestAtOrBefore(target);
        if (nearest) return nearest;
      }
      throw new Error(`clip ${this.id} returned no video frame at ${target}us`);
    }
    this.coverage.remember(result.video);
    return result.video;
  }

  async decodeApprox(timeUs: number, toleranceUs: number, snapBeyondTolerance = true): Promise<VideoFrame> {
    await this.load();
    const within = this.keyframes?.withinTolerance(timeUs, toleranceUs) ?? null;
    const target = within ?? (snapBeyondTolerance ? this.keyframes?.nearestAtOrBefore(timeUs) : null) ?? timeUs;
    return this.decode(target);
  }

  async warmup(nearStartUs: number, frameDurationUs = 1e6 / 30): Promise<number> {
    const started = performance.now();
    const frame = await this.decode(Math.max(0, nearStartUs - Math.round(frameDurationUs)));
    frame.close();
    return performance.now() - started;
  }

  getKeyframeTimesUs(): readonly number[] {
    return this.keyframes?.keyframeTimesUs ?? [];
  }

  getLastFrameStartUs(): number | null {
    return this.lastFrameStartUs;
  }

  getDecoderTimestampOffsetUs(): number {
    return this.decoderTimestampOffsetUs;
  }

  getSourceMode(): FrameEngineSourceMode {
    return this.sourceMode;
  }

  getRangeFetchStats(): RangeFetchStats | null {
    return this.range?.stats ?? null;
  }

  /** Creates an independent decoder state while reusing the parsed local MP4 backing store. */
  async fork(id: string): Promise<ClipSession> {
    await this.ensureParsed();
    if (this.sourceMode === 'range') {
      if (!this.range || !this.meta || this.state === 'unavailable') {
        throw new Error(`clip ${this.id} cannot be forked while unavailable`);
      }
      const fork = new ClipSession(id, this.src, this.options);
      fork.range = await this.range.fork(id);
      fork.meta = { ...this.meta };
      fork.state = this.state;
      fork.keyframes = this.keyframes;
      fork.lastFrameStartUs = this.lastFrameStartUs;
      fork.decoderTimestampOffsetUs = this.decoderTimestampOffsetUs;
      fork.loadPromise = Promise.resolve();
      return fork;
    }
    if (!this.clip || !this.meta || this.state === 'unavailable') {
      throw new Error(`clip ${this.id} cannot be forked while unavailable`);
    }
    const fork = new ClipSession(id, this.src, this.options);
    fork.sourceBytes = this.sourceBytes;
    fork.ownsSourceBytes = false;
    fork.clip = await this.clip.clone();
    fork.meta = { ...this.meta };
    fork.state = this.state;
    fork.activeAcceleration = this.activeAcceleration;
    fork.keyframes = this.keyframes;
    fork.lastFrameStartUs = this.lastFrameStartUs;
    fork.decoderTimestampOffsetUs = this.decoderTimestampOffsetUs;
    fork.cachedHeader = this.cachedHeader;
    fork.cachedKeyframes = this.cachedKeyframes;
    fork.learnedSupport = this.learnedSupport;
    fork.codecLearningStarted = this.codecLearningStarted;
    // MP4Clip.clone() constructs a fresh, unprimed VideoFrameFinder.
    fork.lastTickTargetUs = null;
    const coverageSeed = this.coverage.cloneStored();
    if (coverageSeed) fork.coverage.adopt(coverageSeed);
    fork.loadPromise = Promise.resolve();
    return fork;
  }

  destroy(): void {
    this.clip?.destroy();
    this.preparedCandidate?.destroy();
    this.range?.destroy();
    this.preparedRange?.destroy();
    this.clip = null;
    this.preparedCandidate = null;
    this.range = null;
    this.preparedRange = null;
    this.preparedKeyframes = null;
    this.preparePromise = null;
    this.prepareGeneration += 1;
    this.meta = null;
    this.coverage.clear();
    this.keyframes = null;
    this.lastFrameStartUs = null;
    this.decoderTimestampOffsetUs = 0;
    this.lastTickTargetUs = null;
    this.activeAcceleration = undefined;
    this.loadPromise = null;
    this.cachedHeader = null;
    this.cachedKeyframes = null;
    this.learnedSupport = null;
    this.codecLearningStarted = false;
    if (this.ownsSourceBytes) this.sourceBytes.destroy();
    this.state = 'idle';
  }

  private async guardedTick(target: number): Promise<{ video?: VideoFrame }> {
    if (!this.clip) throw new Error(`clip ${this.id} is unavailable`);
    const guard = createDecoderErrorGuard({
      acceleration: this.activeAcceleration,
      graceMs: this.options.decoderErrorGraceMs,
      createError: message => new DecoderGuardError(message),
      onDetect: message => this.options.onWarning?.(`${this.id}: decoder runtime error: ${message}`),
    });
    try {
      const decoderTarget = this.toDecoderTime(target);
      const rawResult = await withTimeout(
        Promise.race([this.clip.tick(decoderTarget), guard.failure]),
        this.options.tickTimeoutMs,
        `tick ${this.id}`
      );
      const result = this.normalizeTickResult(rawResult);
      if (!result.video) {
        const observed = guard.observed();
        if (observed) throw new DecoderGuardError(observed);
      }
      this.lastTickTargetUs = decoderTarget;
      return result;
    } finally {
      guard.stop();
    }
  }

  private async guardedExactTick(target: number): Promise<{ video?: VideoFrame }> {
    const decoderTarget = this.toDecoderTime(target);
    const willReset = this.lastTickTargetUs == null
      || decoderTarget <= this.lastTickTargetUs
      || decoderTarget - this.lastTickTargetUs > AV_CLIPER_RESET_WINDOW_US;
    let seeded = false;

    if (willReset && this.shouldSeedFromKeyframe(target)) {
      await this.seedFromKeyframe(target);
      seeded = true;
    }

    let tickTarget = target;
    for (let attempt = 0; attempt < MAX_EXACT_FRAME_TICKS; attempt += 1) {
      const result = await this.guardedTick(tickTarget);
      const frame = result.video;
      if (frame && frameCoversTimestamp(frame, target)) return result;

      const hasUsableDuration = frame != null
        && typeof frame.duration === 'number'
        && Number.isFinite(frame.duration)
        && frame.duration > 0;
      // Preserve legacy best-effort decoding when a malformed frame has no usable boundary.
      if (frame && !hasUsableDuration && frame.timestamp <= target) return result;

      const wentPastTarget = frame != null && frame.timestamp > target;
      const endedBeforeTarget = frame != null
        && hasUsableDuration
        && frame.timestamp + frame.duration <= target;
      if (frame && frame.timestamp <= target) this.coverage.remember(frame);
      frame?.close();

      if ((frame == null || wentPastTarget) && !seeded && this.shouldSeedFromKeyframe(target)) {
        await this.seedFromKeyframe(target);
        seeded = true;
        tickTarget = target;
        continue;
      }
      if (endedBeforeTarget) {
        // av-cliper treats the prior frame's end timestamp as inclusive. Moving one
        // microsecond into the requested frame preserves exact frame selection.
        tickTarget = target + 1;
        continue;
      }
      break;
    }
    return {};
  }

  private shouldSeedFromKeyframe(target: number): boolean {
    if (!this.keyframes || this.keyframes.keyframeTimesUs.length === 0) return false;
    const anchor = this.keyframes.nearestAtOrBefore(target);
    const anchorEnd = this.keyframes.frameEndUs(anchor);
    return anchorEnd == null ? target > anchor : target >= anchorEnd;
  }

  private async seedFromKeyframe(target: number): Promise<void> {
    if (!this.keyframes) return;
    const anchor = this.keyframes.nearestAtOrBefore(target);
    const seeded = await this.guardedTick(anchor + 1);
    if (seeded.video) this.coverage.remember(seeded.video);
    seeded.video?.close();
  }

  private async recreateDecoder(): Promise<void> {
    this.clip?.destroy();
    this.clip = null;
    this.meta = null;
    this.coverage.clear();
    this.keyframes = null;
    this.lastFrameStartUs = null;
    this.decoderTimestampOffsetUs = 0;
    this.lastTickTargetUs = null;
    this.activeAcceleration = undefined;
    this.loadPromise = null;
    this.state = 'idle';
    await this.load();
  }

  private toDecoderTime(presentationTimeUs: number): number {
    return Math.max(0, presentationTimeUs + this.decoderTimestampOffsetUs);
  }

  private normalizeTickResult<T extends { video?: VideoFrame }>(result: T): T {
    if (!result.video) return result;
    const source = result.video;
    const unbounded = presentationFrameTiming(source, this.decoderTimestampOffsetUs);
    const nextFrameStartUs = this.keyframes?.nextFrameStartUs(unbounded.timestamp) ?? null;
    const timing = presentationFrameTiming(
      source,
      this.decoderTimestampOffsetUs,
      nextFrameStartUs,
    );
    if (timing.timestamp === source.timestamp && timing.duration === source.duration) return result;
    const init: VideoFrameInit = { timestamp: timing.timestamp };
    if (typeof timing.duration === 'number') init.duration = timing.duration;
    const video = new VideoFrame(source, init);
    source.close();
    return { ...result, video };
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation, operation);
    this.queue = result.then(() => undefined, () => undefined);
    return result;
  }
}

export function frameCoversTimestamp(
  frame: Pick<VideoFrame, 'timestamp' | 'duration'>,
  targetUs: number
): boolean {
  const duration = frame.duration;
  return typeof duration === 'number' && Number.isFinite(duration) && duration > 0
    && targetUs >= frame.timestamp
    && targetUs < frame.timestamp + duration;
}

export function presentationFrameTiming(
  frame: Pick<VideoFrame, 'timestamp' | 'duration'>,
  decoderTimestampOffsetUs: number,
  nextFrameStartUs: number | null = null,
): { timestamp: number; duration: number | null } {
  const offsetUs = Math.max(0, decoderTimestampOffsetUs);
  const hiddenPrefixUs = Math.max(0, offsetUs - frame.timestamp);
  const timestamp = Math.max(0, frame.timestamp - offsetUs);
  let duration = typeof frame.duration === 'number'
    ? Math.max(1, frame.duration - hiddenPrefixUs)
    : frame.duration;
  if (typeof duration === 'number'
    && nextFrameStartUs != null
    && nextFrameStartUs > timestamp
    && timestamp + duration > nextFrameStartUs + 1) {
    duration = nextFrameStartUs - timestamp;
  }
  return { timestamp, duration };
}
