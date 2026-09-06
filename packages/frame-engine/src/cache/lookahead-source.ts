import { cloneWithRotation, type FrameMetricsRecorder, type NativeFrameSource } from '../types.js';
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
  private readonly pinRequests = new Set<string>();
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

    // Free the slot before the decode is awaited: a cached decoder-backed clone must never be
    // held while the next decode is pending, or the decoder can run out of output surfaces
    // (issue #28). put() below still evicts as a safety net, but must not be the only path.
    cache.makeRoom();
    const started = performance.now();
    const frame = await this.source.decode(timeUs, metrics, request);
    const decodeMs = performance.now() - started;
    cache.put(frameNumber, cloneWithRotation(frame), decodeMs);
    this.options.onAccess?.({ streamId, frameNumber, hit: false, decodeMs });
    return frame;
  }

  prefetch(timeUs: number, request?: { streamId: string; pin?: boolean }): Promise<void> {
    const streamId = request?.streamId ?? 'default';
    const frameNumber = this.frameNumber(timeUs);
    const cache = this.cacheFor(streamId);
    if (cache.has(frameNumber)) {
      if (request?.pin) cache.pin(frameNumber);
      return Promise.resolve();
    }
    const key = `${streamId}:${frameNumber}`;
    if (request?.pin) this.pinRequests.add(key);
    const existing = this.inFlight.get(key);
    if (existing) return existing;
    const operation = (async () => {
      // Same ordering as decode(): release the oldest cached clone before awaiting the decode.
      cache.makeRoom();
      const started = performance.now();
      const frame = await this.source.decode(timeUs, undefined, request);
      cache.put(frameNumber, frame, performance.now() - started);
      // Apply joined pin requests before waking decode() waiters, so presentation unpins last.
      if (this.pinRequests.has(key)) cache.pin(frameNumber);
    })().finally(() => {
      this.inFlight.delete(key);
      this.pinRequests.delete(key);
    });
    this.inFlight.set(key, operation);
    return operation;
  }

  has(timeUs: number, request?: { streamId: string }): boolean {
    return this.caches.get(request?.streamId ?? 'default')?.has(this.frameNumber(timeUs)) ?? false;
  }

  clear(): void {
    for (const cache of this.caches.values()) cache.clear();
    this.caches.clear();
    this.inFlight.clear();
    this.pinRequests.clear();
  }

  /**
   * 生きている stream（キャッシュを持つもの + 内側のソースが掴んでいるデコーダのレーン）。
   * StreamReaper がこの一覧を見て「plan に載っていない stream」を選ぶ。
   */
  liveStreamIds(): readonly string[] {
    const ids = new Set(this.caches.keys());
    const inner = this.source as { liveStreamIds?: () => readonly string[] };
    if (typeof inner.liveStreamIds === 'function') {
      for (const streamId of inner.liveStreamIds()) ids.add(streamId);
    }
    return [...ids];
  }

  /**
   * stream 1 本ぶんのキャッシュと、内側のデコーダセッションを解放する。書き出しは厳密に前方順で
   * 過去フレームを読み直さないので、plan から外れたカットはここで捨ててよい（issue #52）。
   * 進行中の prefetch は握っている frame を put() でキャッシュへ戻すため、in-flight の間は
   * 解放しない（次のフレームで回収される）。
   */
  releaseStream(streamId: string): boolean {
    for (const key of this.inFlight.keys()) {
      if (key.slice(0, key.lastIndexOf(':')) === streamId) return false;
    }
    const cache = this.caches.get(streamId);
    if (cache) {
      cache.clear();
      this.caches.delete(streamId);
    }
    const inner = this.source as { releaseSession?: (streamId: string) => boolean };
    const releasedSession = typeof inner.releaseSession === 'function'
      ? inner.releaseSession(streamId)
      : false;
    return Boolean(cache) || releasedSession;
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
