import type { FrameMetricsRecorder, NativeFrameSource } from '../types.js';
import { LookaheadCache } from './lookahead-cache.js';

export interface LookaheadAccess {
  streamId: string;
  frameNumber: number;
  hit: boolean;
  decodeMs: number;
}

export interface LookaheadFrameSourceOptions {
  fps: number;
  capacity?: number;
  onAccess?: (access: LookaheadAccess) => void;
}

/**
 * NativeFrameSource adapter used directly by evaluateFrame. Playback prefetches and
 * evaluator reads share the same per-stream cache, while every caller receives its own clone.
 */
export class LookaheadFrameSource implements NativeFrameSource {
  private readonly caches = new Map<string, LookaheadCache>();
  private readonly inFlight = new Map<string, Promise<void>>();
  private readonly fps: number;
  private readonly capacity: number;

  constructor(
    private readonly source: NativeFrameSource,
    private readonly options: LookaheadFrameSourceOptions
  ) {
    this.fps = Number.isFinite(options.fps) && options.fps > 0 ? options.fps : 30;
    this.capacity = Math.max(1, options.capacity ?? 8);
  }

  async decode(
    timeUs: number,
    metrics?: FrameMetricsRecorder,
    request?: { streamId: string }
  ): Promise<VideoFrame> {
    const streamId = request?.streamId ?? 'default';
    const frameNumber = this.frameNumber(timeUs);
    const cache = this.cacheFor(streamId);
    let cached = cache.getClone(frameNumber);
    const key = `${streamId}:${frameNumber}`;
    const pending = this.inFlight.get(key);
    if (!cached && pending) {
      await pending;
      cached = cache.getClone(frameNumber);
    }
    if (cached) {
      this.options.onAccess?.({ streamId, frameNumber, hit: true, decodeMs: cached.decodeMs });
      return cached.frame;
    }

    const started = performance.now();
    const frame = await this.source.decode(timeUs, metrics, request);
    const decodeMs = performance.now() - started;
    cache.put(frameNumber, frame.clone(), decodeMs);
    this.options.onAccess?.({ streamId, frameNumber, hit: false, decodeMs });
    return frame;
  }

  prefetch(timeUs: number, request?: { streamId: string }): Promise<void> {
    const streamId = request?.streamId ?? 'default';
    const frameNumber = this.frameNumber(timeUs);
    const cache = this.cacheFor(streamId);
    if (cache.has(frameNumber)) return Promise.resolve();
    const key = `${streamId}:${frameNumber}`;
    const existing = this.inFlight.get(key);
    if (existing) return existing;
    const operation = (async () => {
      const started = performance.now();
      const frame = await this.source.decode(timeUs, undefined, request);
      cache.put(frameNumber, frame, performance.now() - started);
    })().finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, operation);
    return operation;
  }

  clear(): void {
    for (const cache of this.caches.values()) cache.clear();
    this.caches.clear();
    this.inFlight.clear();
  }

  private frameNumber(timeUs: number): number {
    return Math.max(0, Math.round(timeUs * this.fps / 1e6));
  }

  private cacheFor(streamId: string): LookaheadCache {
    let cache = this.caches.get(streamId);
    if (!cache) {
      cache = new LookaheadCache(this.capacity);
      this.caches.set(streamId, cache);
    }
    return cache;
  }
}
