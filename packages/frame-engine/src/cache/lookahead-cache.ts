// Adapted from packages/preview-engine/src/lookaheadCache.ts.
import { cloneWithRotation } from '../types.js';

export interface CachedFrame {
  frame: VideoFrame;
  decodeMs: number;
}

export class LookaheadCache {
  private readonly entries = new Map<number, CachedFrame>();
  private readonly capacity: number;

  constructor(capacity: number) {
    this.capacity = Math.max(1, capacity);
  }

  getClone(frameNumber: number): CachedFrame | null {
    const entry = this.entries.get(frameNumber);
    if (!entry) return null;
    this.entries.delete(frameNumber);
    this.entries.set(frameNumber, entry);
    return { frame: cloneWithRotation(entry.frame), decodeMs: entry.decodeMs };
  }

  /**
   * Frees one slot *before* a decode starts. Cached frames are decoder-backed clones that share
   * the decoder's output surface, so holding a full cache while the next decode is pending can
   * starve the decoder of surfaces (issue #28). Callers on the cache-miss path must call this
   * before awaiting the underlying decode, never only after it resolves.
   */
  makeRoom(): void {
    while (this.entries.size >= this.capacity) {
      if (!this.evictOldest()) break;
    }
  }

  put(frameNumber: number, frame: VideoFrame, decodeMs: number): void {
    this.entries.get(frameNumber)?.frame.close();
    this.entries.delete(frameNumber);
    this.entries.set(frameNumber, { frame, decodeMs });
    while (this.entries.size > this.capacity) {
      if (!this.evictOldest()) break;
    }
  }

  has(frameNumber: number): boolean {
    return this.entries.has(frameNumber);
  }

  get size(): number {
    return this.entries.size;
  }

  clear(): void {
    for (const entry of this.entries.values()) entry.frame.close();
    this.entries.clear();
  }

  private evictOldest(): boolean {
    const oldest = this.entries.keys().next().value as number | undefined;
    if (oldest == null) return false;
    this.entries.get(oldest)?.frame.close();
    this.entries.delete(oldest);
    return true;
  }
}
