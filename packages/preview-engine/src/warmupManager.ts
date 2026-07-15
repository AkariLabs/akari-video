// E3: カット点ウォームアップ。
// タイムライン上の次カットの 0.5〜1s 手前で次クリップのデコーダを事前 configure + prime する。
import type { ClipSession } from './clipSession.js';

export class WarmupManager {
  private leadInSec: number;
  private warmedClipIds = new Set<string>();
  private inFlight = new Map<string, Promise<number>>();

  constructor(leadInSec: number) {
    this.leadInSec = leadInSec;
  }

  /** 毎フレーム/毎シークで呼ぶ。境界が近ければウォームアップを起動する（冪等・多重発火防止） */
  maybeWarmup(
    secondsToBoundary: number | null,
    nextClipSession: ClipSession | null,
    nextClipSourceInUs: number,
    onWarmed: (clipId: string, tookMs: number) => void,
    frameDurationUs = 1e6 / 30
  ): void {
    if (secondsToBoundary == null || nextClipSession == null) return;
    if (secondsToBoundary > this.leadInSec) return;
    if (this.warmedClipIds.has(nextClipSession.id) || this.inFlight.has(nextClipSession.id)) return;

    const p = nextClipSession.warmup(nextClipSourceInUs, frameDurationUs);
    this.inFlight.set(nextClipSession.id, p);
    void p.then((tookMs) => {
      this.warmedClipIds.add(nextClipSession.id);
      this.inFlight.delete(nextClipSession.id);
      onWarmed(nextClipSession.id, tookMs);
    });
  }

  /** クリップが実際に切り替わったら呼ぶ（次の境界に向けて再びウォームアップ可能にする） */
  notifyClipChanged(currentClipId: string): void {
    // 現在再生中のクリップ以外の「済み」マークは維持してよいが、
    // 巻き戻し等で同じクリップに再度接近した場合に再ウォームアップできるよう
    // 現在クリップ自身の済みマークだけ解除する。
    this.warmedClipIds.delete(currentClipId);
  }

  reset(): void {
    this.warmedClipIds.clear();
    this.inFlight.clear();
  }
}
