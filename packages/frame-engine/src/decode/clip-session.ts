// Adapted from packages/preview-engine/src/clipSession.ts.
import { MP4Clip } from '@webav/av-cliper';
import type { FrameMetricsRecorder, NativeFrameSource } from '../types.js';
import { isDecoderErrorMessage, withTimeout, watchDecoderErrors } from './guard.js';
import { buildKeyframeIndexFromHeader, type KeyframeIndex } from './keyframe-index.js';

export type ClipSessionState = 'idle' | 'loading' | 'ready' | 'degraded' | 'unavailable';

export interface ClipSessionOptions {
  loadTimeoutMs?: number;
  tickTimeoutMs?: number;
  onWarning?: (message: string) => void;
}

class DecoderGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DecoderGuardError';
  }
}

const AV_CLIPER_RESET_WINDOW_US = 3_000_000;
const MAX_EXACT_FRAME_TICKS = 4;

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
  private lastFrameStartUs: number | null = null;
  private decoderTimestampOffsetUs = 0;
  private lastTickTargetUs: number | null = null;
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
          await this.loadKeyframes(candidate);
          const primeTarget = this.toDecoderTime(0);
          const rawPrimed = await withTimeout(
            Promise.race([candidate.tick(primeTarget), decoderError]),
            this.options.tickTimeoutMs,
            `prime ${this.id}`
          );
          const primed = this.normalizeTickResult(rawPrimed);
          this.lastTickTargetUs = primeTarget;
          if (primed.video) this.coverage.adopt(primed.video);
        } finally {
          stopWatching();
        }
        this.clip = candidate;
        this.meta = {
          ...candidate.meta,
          duration: this.keyframes?.presentationDurationUs
            ?? Math.max(0, candidate.meta.duration - this.decoderTimestampOffsetUs),
        };
        this.state = attempt.state;
        if (attempt.state === 'degraded') this.options.onWarning?.(`${this.id}: software decoder fallback active`);
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
    this.state = 'unavailable';
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  private async loadKeyframes(clip: MP4Clip): Promise<void> {
    try {
      const header = await withTimeout(clip.getFileHeaderBinData(), 2_000, `header ${this.id}`);
      this.keyframes = await withTimeout(buildKeyframeIndexFromHeader(header), 2_000, `keyframes ${this.id}`);
      this.lastFrameStartUs = this.keyframes.lastFrameStartUs;
      this.decoderTimestampOffsetUs = this.keyframes.decoderTimestampOffsetUs;
    } catch (error) {
      this.keyframes = null;
      this.lastFrameStartUs = null;
      this.decoderTimestampOffsetUs = 0;
      this.options.onWarning?.(`${this.id}: keyframe index unavailable: ${String(error)}`);
    }
  }

  async decode(timeUs: number, metrics?: FrameMetricsRecorder): Promise<VideoFrame> {
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
    fork.lastFrameStartUs = this.lastFrameStartUs;
    fork.decoderTimestampOffsetUs = this.decoderTimestampOffsetUs;
    // MP4Clip.clone() constructs a fresh, unprimed VideoFrameFinder.
    fork.lastTickTargetUs = null;
    const coverageSeed = this.coverage.cloneStored();
    if (coverageSeed) fork.coverage.adopt(coverageSeed);
    fork.loadPromise = Promise.resolve();
    return fork;
  }

  destroy(): void {
    this.clip?.destroy();
    this.clip = null;
    this.meta = null;
    this.coverage.clear();
    this.keyframes = null;
    this.lastFrameStartUs = null;
    this.decoderTimestampOffsetUs = 0;
    this.lastTickTargetUs = null;
    this.loadPromise = null;
    this.state = 'idle';
  }

  private async guardedTick(target: number): Promise<{ video?: VideoFrame }> {
    if (!this.clip) throw new Error(`clip ${this.id} is unavailable`);
    let rejectDecoder: ((message: string) => void) | null = null;
    const decoderError = new Promise<never>((_resolve, reject) => {
      rejectDecoder = message => reject(new DecoderGuardError(message));
    });
    decoderError.catch(() => undefined);
    const stopWatching = watchDecoderErrors(message => {
      this.options.onWarning?.(`${this.id}: decoder runtime error: ${message}`);
      rejectDecoder?.(message);
    });
    try {
      const decoderTarget = this.toDecoderTime(target);
      const result = await withTimeout(
        Promise.race([this.clip.tick(decoderTarget), decoderError]),
        this.options.tickTimeoutMs,
        `tick ${this.id}`
      );
      this.lastTickTargetUs = decoderTarget;
      return this.normalizeTickResult(result);
    } finally {
      stopWatching();
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
