// Adapted from packages/preview-engine/src/warmupManager.ts.
import type { ClipSession } from '../decode/clip-session.js';

export class WarmupManager {
  private readonly warmed = new Set<string>();
  private readonly inFlight = new Map<string, Promise<number>>();

  constructor(private readonly leadInSeconds: number) {}

  maybeWarmup(
    secondsToBoundary: number | null,
    session: ClipSession | null,
    sourceInUs: number,
    onWarmed: (clipId: string, elapsedMs: number) => void
  ): void {
    if (secondsToBoundary == null || secondsToBoundary > this.leadInSeconds || !session) return;
    if (this.warmed.has(session.id) || this.inFlight.has(session.id)) return;
    const operation = session.warmup(sourceInUs);
    this.inFlight.set(session.id, operation);
    void operation.then(elapsedMs => {
      this.inFlight.delete(session.id);
      this.warmed.add(session.id);
      onWarmed(session.id, elapsedMs);
    }, () => {
      this.inFlight.delete(session.id);
    });
  }

  notifyClipChanged(clipId: string): void {
    this.warmed.delete(clipId);
  }

  reset(): void {
    this.warmed.clear();
    this.inFlight.clear();
  }
}
