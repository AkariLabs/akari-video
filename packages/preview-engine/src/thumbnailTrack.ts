// E5: スクラブ中に即時表示する、メモリ内だけの低解像度サムネイル列。
// 既存の ClipSession.tickBackground() を利用し、foreground decode より低い優先度で生成する。
import type { ClipSession } from './clipSession.js';

export interface ThumbnailEntry {
  timeUs: number;
  bitmap: ImageBitmap;
}

export interface ThumbnailTrackOptions {
  maxThumbnails: number;
  intervalSec: number;
  thumbWidth: number;
}

export class ThumbnailTrack {
  private entries: ThumbnailEntry[] = [];
  private buildPromise: Promise<void> | null = null;
  private generation = 0;
  private opts: ThumbnailTrackOptions;

  constructor(options: ThumbnailTrackOptions) {
    this.opts = {
      maxThumbnails: Math.max(1, Math.floor(options.maxThumbnails)),
      intervalSec: Math.max(0.1, options.intervalSec),
      thumbWidth: Math.max(1, Math.floor(options.thumbWidth)),
    };
  }

  isReady(): boolean {
    return this.entries.length > 0;
  }

  /** 疎なトラックでも動作する、時刻差の絶対値による最近傍二分探索。 */
  nearest(timeUs: number): ThumbnailEntry | null {
    if (this.entries.length === 0) return null;
    let lo = 0;
    let hi = this.entries.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.entries[mid]!.timeUs < timeUs) lo = mid + 1;
      else hi = mid;
    }
    if (lo === 0) return this.entries[0] ?? null;
    if (lo >= this.entries.length) return this.entries[this.entries.length - 1] ?? null;
    const before = this.entries[lo - 1]!;
    const after = this.entries[lo]!;
    return timeUs - before.timeUs <= after.timeUs - timeUs ? before : after;
  }

  /**
   * 冪等かつ best-effort。キーフレーム時刻を優先し、無い場合だけ粗い等間隔へフォールバックする。
   * 生成途中でも entries を公開するため、最初の1枚ができた時点からスクラブ表示に利用できる。
   */
  build(
    session: ClipSession,
    sourceStartUs: number,
    sourceEndUs: number,
    keyframeTimesUs: number[] | null
  ): Promise<void> {
    if (this.buildPromise) return this.buildPromise;
    const generation = this.generation;
    this.buildPromise = this.doBuild(session, sourceStartUs, sourceEndUs, keyframeTimesUs, generation);
    return this.buildPromise;
  }

  clear(): void {
    this.generation += 1;
    for (const entry of this.entries) entry.bitmap.close();
    this.entries = [];
    this.buildPromise = null;
  }

  private async doBuild(
    session: ClipSession,
    sourceStartUs: number,
    sourceEndUs: number,
    keyframeTimesUs: number[] | null,
    generation: number
  ): Promise<void> {
    if (!session.meta || !Number.isFinite(sourceStartUs) || !Number.isFinite(sourceEndUs)) return;
    const boundedStartUs = Math.max(0, sourceStartUs);
    const boundedEndUs = Math.min(session.meta.duration, sourceEndUs);
    if (boundedEndUs <= boundedStartUs) return;
    const sampleTimes = this.sampleTimes(boundedStartUs, boundedEndUs, keyframeTimesUs);
    if (sampleTimes.length === 0) return;

    const width = this.opts.thumbWidth;
    const height = Math.max(1, Math.round(width * (session.meta.height / Math.max(1, session.meta.width))));
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    for (const timeUs of sampleTimes) {
      if (generation !== this.generation) return;
      const ret = await session.tickBackground(timeUs);
      const video = ret.video;
      if (!video) continue;

      try {
        ctx.drawImage(video, 0, 0, width, height);
      } finally {
        video.close();
      }

      const bitmap = await createImageBitmap(canvas);
      if (generation !== this.generation) {
        bitmap.close();
        return;
      }
      this.entries.push({ timeUs, bitmap });
    }
  }

  private sampleTimes(sourceStartUs: number, sourceEndUs: number, keyframeTimesUs: number[] | null): number[] {
    const validKeyframes = [...new Set(keyframeTimesUs ?? [])]
      .filter((timeUs) => Number.isFinite(timeUs) && timeUs >= sourceStartUs && timeUs < sourceEndUs)
      .sort((a, b) => a - b);
    if (validKeyframes.length > 0) return this.limitEvenly(validKeyframes);

    const intervalUs = this.opts.intervalSec * 1e6;
    const fallback: number[] = [];
    for (let timeUs = Math.ceil(sourceStartUs); timeUs < sourceEndUs; timeUs += intervalUs) {
      fallback.push(Math.floor(timeUs));
    }
    return this.limitEvenly(fallback);
  }

  private limitEvenly(times: number[]): number[] {
    if (times.length <= this.opts.maxThumbnails) return times;
    if (this.opts.maxThumbnails === 1) return [times[0]!];
    const selected: number[] = [];
    for (let i = 0; i < this.opts.maxThumbnails; i++) {
      const index = Math.round((i * (times.length - 1)) / (this.opts.maxThumbnails - 1));
      const timeUs = times[index]!;
      if (selected[selected.length - 1] !== timeUs) selected.push(timeUs);
    }
    return selected;
  }
}
