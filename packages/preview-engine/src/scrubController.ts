// E1: tolerance スクラブのスケジューリング層。
// 契約: 30Hz スロットル・保留は最新1件のみ・毎回陳腐シーク破棄。
// キーフレームへのスナップ自体（近似解決の中身）は clipSession.ts が担当し、
// このクラスは「いつ・どの frame で」執行するかのタイミング制御に専念する。

export type ScrubExecutor = (frame: number, generation: number) => Promise<void>;

export class ScrubController {
  private throttleMs: number;
  private executor: ScrubExecutor;
  private lastDispatchAt = -Infinity;
  private pendingFrame: number | null = null;
  private throttleTimer: ReturnType<typeof setTimeout> | null = null;
  private generation = 0;
  // 重要: 下層の MP4Clip.tick() は同一インスタンスへの並行呼び出しを想定していない
  // （内部状態を同期的にリセットしてから非同期に歩くため、並行実行すると内部状態が壊れうる —
  // 実測で発見。clipSession.ts のコメント参照）。そのため「保留は最新1件のみ」に加えて
  // 「実行中は新規ディスパッチしない（完了後にまとめて最新へ進む）」を徹底する。
  private executing = false;

  constructor(throttleMs: number, executor: ScrubExecutor) {
    this.throttleMs = throttleMs;
    this.executor = executor;
  }

  /** ドラッグ中の新しい目標フレーム。保留は最新1件のみに上書きされる */
  requestScrub(frame: number): void {
    this.pendingFrame = frame;
    this.scheduleFlushIfNeeded();
  }

  private scheduleFlushIfNeeded(): void {
    if (this.executing) return; // 実行完了時に自動的に最新の pending を拾う
    if (this.throttleTimer != null) return; // 既にタイマー待ち。flush 時に最新値を使う
    const elapsed = performance.now() - this.lastDispatchAt;
    const delay = Math.max(0, this.throttleMs - elapsed);
    this.throttleTimer = setTimeout(() => this.flush(), delay);
  }

  private flush(): void {
    this.throttleTimer = null;
    if (this.pendingFrame == null || this.executing) return;
    const frame = this.pendingFrame;
    this.pendingFrame = null;
    this.lastDispatchAt = performance.now();
    // generation はディスパッチ時にのみ進める（入力イベントごとに進めると、
    // 30Hz を大幅に上回る入力レートの下で「実行結果が返る頃には常に陳腐」になり、
    // ほぼ全ての近似フレームが破棄される実装ミスになる — 実測で発見）。
    this.generation += 1;
    const gen = this.generation;
    this.executing = true;
    void this.executor(frame, gen).finally(() => {
      this.executing = false;
      if (this.pendingFrame != null) this.scheduleFlushIfNeeded();
    });
  }

  /** executor 側が「自分の実行結果はもう陳腐か」を確認するために呼ぶ */
  isStale(generation: number): boolean {
    return generation !== this.generation;
  }

  currentGeneration(): number {
    return this.generation;
  }

  /** リリース/exact シーク時など、保留中の近似シークを破棄する */
  cancelPending(): void {
    this.pendingFrame = null;
    if (this.throttleTimer != null) {
      clearTimeout(this.throttleTimer);
      this.throttleTimer = null;
    }
    // 進行中の generation も陳腐化させる（在途中の tick 結果を破棄させる）
    this.generation += 1;
  }

  dispose(): void {
    this.cancelPending();
  }
}
