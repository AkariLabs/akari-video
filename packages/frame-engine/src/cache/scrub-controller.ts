// Adapted from packages/preview-engine/src/scrubController.ts.
export type ScrubExecutor = (frameNumber: number, generation: number) => Promise<void>;

export class ScrubController {
  private lastDispatchAt = Number.NEGATIVE_INFINITY;
  private pendingFrame: number | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private generation = 0;
  private executing = false;

  constructor(
    private readonly throttleMs: number,
    private readonly executor: ScrubExecutor
  ) {}

  requestScrub(frameNumber: number): void {
    this.pendingFrame = frameNumber;
    this.schedule();
  }

  isStale(generation: number): boolean {
    return generation !== this.generation;
  }

  cancelPending(): void {
    this.pendingFrame = null;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.generation += 1;
  }

  dispose(): void {
    this.cancelPending();
  }

  private schedule(): void {
    if (this.executing || this.timer) return;
    const delay = Math.max(0, this.throttleMs - (performance.now() - this.lastDispatchAt));
    this.timer = setTimeout(() => this.flush(), delay);
  }

  private flush(): void {
    this.timer = null;
    if (this.pendingFrame == null || this.executing) return;
    const frame = this.pendingFrame;
    this.pendingFrame = null;
    this.lastDispatchAt = performance.now();
    const generation = ++this.generation;
    this.executing = true;
    void this.executor(frame, generation).finally(() => {
      this.executing = false;
      if (this.pendingFrame != null) this.schedule();
    });
  }
}
