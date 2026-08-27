// Adapted from packages/preview-engine/src/clipSession.ts.
import { MP4Clip } from '@webav/av-cliper';
import type { FrameMetricsRecorder, NativeFrameSource } from '../types.js';
import { withTimeout, watchDecoderErrors } from './guard.js';
import { buildKeyframeIndexFromHeader, type KeyframeIndex } from './keyframe-index.js';

export type ClipSessionState = 'idle' | 'loading' | 'ready' | 'degraded' | 'unavailable';

export interface ClipSessionOptions {
  loadTimeoutMs?: number;
  tickTimeoutMs?: number;
  tailMarginUs?: number;
  onWarning?: (message: string) => void;
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
  private keyframes: KeyframeIndex | null = null;
  private tailSafeLimitUs: number | null = null;
  private readonly coverage = new DecodedFrameCoverageCache();
  private loadPromise: Promise<void> | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private readonly options: Required<Omit<ClipSessionOptions, 'onWarning'>> & Pick<ClipSessionOptions, 'onWarning'>;

  constructor(id: string, src: string, options: ClipSessionOptions = {}) {
    this.id = id;
    this.src = src;
    this.options = {
      loadTimeoutMs: options.loadTimeoutMs ?? 10_000,
      tickTimeoutMs: options.tickTimeoutMs ?? 10_000,
      tailMarginUs: options.tailMarginUs ?? Math.round(2e6 / 30),
      onWarning: options.onWarning
    };
  }

  load(): Promise<void> {
    this.loadPromise ??= this.doLoad();
    return this.loadPromise;
  }

  private async doLoad(): Promise<void> {
    this.state = 'loading';
    this.coverage.clear();
    let lastError: unknown;
    const attempts: Array<{ hardwareAcceleration: HardwarePreference; state: ClipSessionState }> = [
      { hardwareAcceleration: 'prefer-hardware', state: 'ready' },
      { hardwareAcceleration: 'prefer-software', state: 'degraded' }
    ];
    for (const attempt of attempts) {
      let candidate: MP4Clip | null = null;
      try {
        const response = await fetch(this.src);
        if (!response.ok || !response.body) throw new Error(`fetch failed: ${response.status}`);
        candidate = new MP4Clip(response.body, {
          audio: false,
          __unsafe_hardwareAcceleration__: attempt.hardwareAcceleration
        });
        let rejectDecoder: ((message: string) => void) | null = null;
        const decoderError = new Promise<never>((_resolve, reject) => {
          rejectDecoder = message => reject(new Error(`decoder error: ${message}`));
        });
        decoderError.catch(() => undefined);
        const stopWatching = watchDecoderErrors(message => rejectDecoder?.(message));
        try {
          await withTimeout(
            Promise.race([candidate.ready, decoderError]),
            this.options.loadTimeoutMs,
            `ready ${this.id}`
          );
          const primed = await withTimeout(
            Promise.race([candidate.tick(0), decoderError]),
            this.options.tickTimeoutMs,
            `prime ${this.id}`
          );
          if (primed.video) this.coverage.adopt(primed.video);
        } finally {
          stopWatching();
        }
        this.clip = candidate;
        this.meta = candidate.meta;
        this.state = attempt.state;
        if (attempt.state === 'degraded') this.options.onWarning?.(`${this.id}: software decoder fallback active`);
        await this.loadKeyframes(candidate);
        return;
      } catch (error) {
        this.coverage.clear();
        candidate?.destroy();
        lastError = error;
        this.options.onWarning?.(`${this.id}: ${String(error)}`);
      }
    }
    this.state = 'unavailable';
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  private async loadKeyframes(clip: MP4Clip): Promise<void> {
    try {
      const header = await withTimeout(clip.getFileHeaderBinData(), 2_000, `header ${this.id}`);
      this.keyframes = await withTimeout(buildKeyframeIndexFromHeader(header), 2_000, `keyframes ${this.id}`);
      const times = this.keyframes.keyframeTimesUs;
      if (times.length >= 2) this.tailSafeLimitUs = Math.max(0, times[times.length - 1]! - 1_000_000);
    } catch (error) {
      this.options.onWarning?.(`${this.id}: keyframe index unavailable: ${String(error)}`);
    }
  }

  async decode(timeUs: number, metrics?: FrameMetricsRecorder): Promise<VideoFrame> {
    await this.load();
    if (!this.clip || this.state === 'unavailable') throw new Error(`clip ${this.id} is unavailable`);
    const duration = this.meta?.duration ?? Number.POSITIVE_INFINITY;
    const fallbackLimit = Math.max(0, duration - this.options.tailMarginUs);
    const safeLimit = this.tailSafeLimitUs == null ? fallbackLimit : Math.min(fallbackLimit, this.tailSafeLimitUs);
    const target = Math.max(0, Math.min(Math.floor(timeUs), safeLimit));
    const covered = this.coverage.cloneAt(target);
    if (covered) return covered;
    const tickStarted = performance.now();
    const result = await this.serialize(() => withTimeout(
      this.clip!.tick(target),
      this.options.tickTimeoutMs,
      `tick ${this.id}`
    ));
    metrics?.record('tick', performance.now() - tickStarted);
    if (!result.video) {
      const coveredAfterTick = this.coverage.cloneAt(target);
      if (coveredAfterTick) return coveredAfterTick;
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

  /** Creates an independent decoder state while reusing the parsed local MP4 backing store. */
  async fork(id: string): Promise<ClipSession> {
    await this.load();
    if (!this.clip || !this.meta || this.state === 'unavailable') {
      throw new Error(`clip ${this.id} cannot be forked while unavailable`);
    }
    const fork = new ClipSession(id, this.src, this.options);
    fork.clip = await this.clip.clone();
    fork.meta = { ...this.meta };
    fork.state = this.state;
    fork.keyframes = this.keyframes;
    fork.tailSafeLimitUs = this.tailSafeLimitUs;
    const coverageSeed = this.coverage.cloneStored();
    if (coverageSeed) fork.coverage.adopt(coverageSeed);
    fork.loadPromise = Promise.resolve();
    return fork;
  }

  destroy(): void {
    this.clip?.destroy();
    this.clip = null;
    this.coverage.clear();
    this.loadPromise = null;
    this.state = 'idle';
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
