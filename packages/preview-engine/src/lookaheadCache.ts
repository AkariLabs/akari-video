// E2: 先読みキャッシュ。
// プレイヘッド近傍の順方向デコード結果を保持し、小ジャンプ/巻き戻しはキャッシュ命中で返す。
//
// VideoFrame のライフサイクルに注意: WebCodecs の VideoFrame は close() 後は再利用不可。
// キャッシュは「マスター」フレームを保持したまま呼び出し側には常に clone() を渡す
// （呼び出し側は自由に close() してよい。マスターは LRU 追い出し時にのみ close() される）。

export interface CacheEntry {
  frame: VideoFrame;
  tickMs: number;
}

export class LookaheadCache {
  private capacity: number;
  private map = new Map<number, CacheEntry>(); // key: frame number, insertion順=LRU順

  constructor(capacity: number) {
    this.capacity = Math.max(1, capacity);
  }

  get(frameNumber: number): CacheEntry | null {
    const hit = this.map.get(frameNumber);
    if (!hit) return null;
    // LRU: touch — 再挿入して末尾に移動
    this.map.delete(frameNumber);
    this.map.set(frameNumber, hit);
    return hit;
  }

  /** clone を返す（呼び出し側が close() してよい）。ヒットしなければ null */
  getClone(frameNumber: number): { frame: VideoFrame; tickMs: number } | null {
    const hit = this.get(frameNumber);
    if (!hit) return null;
    return { frame: hit.frame.clone(), tickMs: hit.tickMs };
  }

  put(frameNumber: number, frame: VideoFrame, tickMs: number): void {
    const existing = this.map.get(frameNumber);
    if (existing) existing.frame.close();
    this.map.set(frameNumber, { frame, tickMs });
    while (this.map.size > this.capacity) {
      const oldestKey = this.map.keys().next().value as number | undefined;
      if (oldestKey == null) break;
      const entry = this.map.get(oldestKey);
      entry?.frame.close();
      this.map.delete(oldestKey);
    }
  }

  has(frameNumber: number): boolean {
    return this.map.has(frameNumber);
  }

  get size(): number {
    return this.map.size;
  }

  clear(): void {
    for (const entry of this.map.values()) entry.frame.close();
    this.map.clear();
  }
}
