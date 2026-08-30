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

  put(frameNumber: number, frame: VideoFrame, decodeMs: number): void {
    this.entries.get(frameNumber)?.frame.close();
    this.entries.delete(frameNumber);
    this.entries.set(frameNumber, { frame, decodeMs });
    while (this.entries.size > this.capacity) {
      const oldest = this.entries.keys().next().value as number | undefined;
      if (oldest == null) break;
      this.entries.get(oldest)?.frame.close();
      this.entries.delete(oldest);
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
}
