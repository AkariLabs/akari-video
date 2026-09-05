export interface PcmWindowMetadata {
  url: string;
  sampleRate: number;
  channels: number;
  bytesPerSample: number;
  frames: number;
  durationSec: number;
}

export interface PcmWindowStats {
  fetched: number;
  bytes: number;
  cacheBytes: number;
  evicted: number;
  late: number;
  failed: number;
}

export const DEFAULT_PCM_WINDOW_CACHE_BYTES = 64 * 1024 * 1024;

/** Kept independent of media-bin across the package boundary. End bytes are inclusive. */
export function pcmWindowByteRange(
  { sampleRate, channels, bytesPerSample, frames }: Omit<PcmWindowMetadata, 'url' | 'durationSec'>,
  startSec: number,
  endSec: number,
): { startByte: number; endByte: number; startFrame: number; frameCount: number } | null {
  if (!Number.isFinite(sampleRate) || sampleRate <= 0 || !Number.isSafeInteger(channels) || channels <= 0
    || !Number.isSafeInteger(bytesPerSample) || bytesPerSample <= 0
    || !Number.isSafeInteger(frames) || frames < 0
    || !Number.isFinite(startSec) || !Number.isFinite(endSec) || endSec <= startSec) return null;
  const startFrame = Math.min(frames, Math.max(0, Math.floor(startSec * sampleRate)));
  const endFrame = Math.min(frames, Math.max(0, Math.ceil(endSec * sampleRate)));
  if (endFrame <= startFrame) return null;
  const stride = channels * bytesPerSample;
  return { startByte: startFrame * stride, endByte: endFrame * stride - 1,
    startFrame, frameCount: endFrame - startFrame };
}

interface CacheEntry { buffer: AudioBuffer; bytes: number }
interface PendingWindow {
  controller: AbortController;
  promise: Promise<AudioBuffer>;
  users: number;
}

const abortError = (): DOMException => new DOMException('PCM window cancelled', 'AbortError');

/** Range-only s16le supply. Pins can be acquired before a request to protect its eventual buffer. */
export class PcmWindowSource {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly pins = new Map<string, number>();
  private readonly pending = new Map<string, PendingWindow>();
  private readonly stats: PcmWindowStats = { fetched: 0, bytes: 0, cacheBytes: 0, evicted: 0, late: 0, failed: 0 };
  private readonly cacheLimit: number;

  constructor(
    readonly metadata: PcmWindowMetadata,
    private readonly fetchImpl: typeof fetch,
    private readonly context: Pick<BaseAudioContext, 'createBuffer'>,
    options: { cacheBytes?: number } = {},
  ) {
    if (!Number.isFinite(metadata.sampleRate) || metadata.sampleRate <= 0
      || !Number.isSafeInteger(metadata.channels) || metadata.channels <= 0
      || metadata.bytesPerSample !== 2 || !Number.isSafeInteger(metadata.frames) || metadata.frames < 0
      || !Number.isFinite(metadata.durationSec) || metadata.durationSec < 0) {
      throw new Error('Invalid s16le sidecar metadata');
    }
    this.cacheLimit = Number.isFinite(options.cacheBytes) && options.cacheBytes! >= 0
      ? options.cacheBytes! : DEFAULT_PCM_WINDOW_CACHE_BYTES;
  }

  debug(): PcmWindowStats { return { ...this.stats }; }
  noteLate(): void { this.stats.late += 1; }

  private key(startSec: number, endSec: number): string {
    const range = pcmWindowByteRange(this.metadata, startSec, endSec);
    return range ? `${range.startFrame}:${range.startFrame + range.frameCount}` : 'empty';
  }

  pin(startSec: number, endSec: number): () => void {
    const key = this.key(startSec, endSec);
    this.pins.set(key, (this.pins.get(key) ?? 0) + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const count = (this.pins.get(key) ?? 1) - 1;
      if (count > 0) this.pins.set(key, count);
      else this.pins.delete(key);
      this.evict();
    };
  }

  private evict(): void {
    for (const [key, entry] of this.cache) {
      if (this.stats.cacheBytes <= this.cacheLimit) break;
      if (this.pins.has(key)) continue;
      this.cache.delete(key);
      this.stats.cacheBytes -= entry.bytes;
      this.stats.evicted += 1;
    }
  }

  window(startSec: number, endSec: number, signal?: AbortSignal): Promise<AudioBuffer> {
    if (signal?.aborted) return Promise.reject(abortError());
    const range = pcmWindowByteRange(this.metadata, startSec, endSec);
    // Web Audio requires a positive buffer length. An empty range produces one silent
    // frame without an HTTP request; the scheduler never submits empty ranges.
    if (!range) return Promise.resolve(this.context.createBuffer(this.metadata.channels, 1, this.metadata.sampleRate));
    const key = this.key(startSec, endSec);
    const cached = this.cache.get(key);
    if (cached) {
      this.cache.delete(key);
      this.cache.set(key, cached);
      return Promise.resolve(cached.buffer);
    }
    let pending = this.pending.get(key);
    if (!pending || pending.controller.signal.aborted) {
      const controller = new AbortController();
      const entry: PendingWindow = { controller, users: 0, promise: Promise.resolve(null as unknown as AudioBuffer) };
      this.pending.set(key, entry);
      entry.promise = this.fetchWindow(range, key, controller.signal).finally(() => {
        if (this.pending.get(key) === entry) this.pending.delete(key);
      });
      pending = entry;
    }
    const request = pending;
    request.users += 1;
    // Each caller can cancel independently. The underlying fetch is cancelled when
    // its last consumer leaves, and a new generation never joins an aborted request.
    return new Promise<AudioBuffer>((resolve, reject) => {
      let settled = false;
      const finish = (buffer?: AudioBuffer, reason?: unknown): void => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener('abort', cancel);
        request.users -= 1;
        if (request.users === 0 && !buffer) request.controller.abort();
        if (buffer) resolve(buffer);
        else reject(reason);
      };
      const cancel = (): void => finish(undefined, abortError());
      signal?.addEventListener('abort', cancel, { once: true });
      request.promise.then(buffer => finish(buffer), reason => finish(undefined, reason));
      if (signal?.aborted) cancel();
    });
  }

  private async fetchWindow(
    range: NonNullable<ReturnType<typeof pcmWindowByteRange>>, key: string, signal: AbortSignal,
  ): Promise<AudioBuffer> {
    try {
      const response = await this.fetchImpl(this.metadata.url, {
        headers: { Range: `bytes=${range.startByte}-${range.endByte}` }, signal,
      });
      if (signal.aborted || response.status !== 206) {
        try { await response.body?.cancel?.(); } catch {}
        if (signal.aborted) throw abortError();
        throw new Error(`PCM Range status=${response.status}; expected 206`);
      }
      const contentRange = /^bytes (\d+)-(\d+)\/(\d+|\*)$/i.exec(response.headers.get('content-range') ?? '');
      if (!contentRange || Number(contentRange[1]) !== range.startByte
        || Number(contentRange[2]) !== range.endByte) {
        try { await response.body?.cancel?.(); } catch {}
        throw new Error('PCM Content-Range does not match request');
      }
      const encoded = await response.arrayBuffer();
      if (signal.aborted) throw abortError();
      const { channels, sampleRate, bytesPerSample } = this.metadata;
      const stride = channels * bytesPerSample;
      if (encoded.byteLength % stride !== 0 || encoded.byteLength !== range.frameCount * stride) {
        throw new Error('PCM Range body has an invalid frame count');
      }
      const buffer = this.context.createBuffer(channels, range.frameCount, sampleRate);
      const view = new DataView(encoded);
      for (let channel = 0; channel < channels; channel += 1) {
        const output = buffer.getChannelData(channel);
        for (let frame = 0; frame < range.frameCount; frame += 1) {
          output[frame] = view.getInt16(frame * stride + channel * bytesPerSample, true) / 32768;
        }
      }
      if (signal.aborted) throw abortError();
      const bytes = range.frameCount * channels * 4;
      this.cache.set(key, { buffer, bytes });
      this.stats.fetched += 1;
      this.stats.bytes += encoded.byteLength;
      this.stats.cacheBytes += bytes;
      this.evict();
      return buffer;
    } catch (reason) {
      if (!signal.aborted) this.stats.failed += 1;
      throw reason;
    }
  }

  dispose(): void {
    for (const request of this.pending.values()) request.controller.abort();
    this.pending.clear();
    this.cache.clear();
    this.pins.clear();
    this.stats.cacheBytes = 0;
  }
}
