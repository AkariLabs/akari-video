// rAF スロットリング（task/2026-09-02-preview-perf: トラックパッドのピンチズームで
// 「タイムラインがとても重く、プレビューまでカクつく」オーナー実機フィードバック）。
//
// ズームは wheel（ctrlKey）が 60–120 Hz で届き、従来は 1 イベント = 1 回のフル renderStrip()
// （全チップの keyed 差分・フィルムストリップ・波形 canvas の作り直し）を同期実行していた。
// createRafThrottle(run) は run() を「次の requestAnimationFrame まで最大 1 回」に折りたたむ。
// 呼び出し側は状態（viewStart / viewDuration・キャッシュ）を同期で更新してから call() する
// だけでよく、run() は実行時点の最新状態を読むため「最後の要求が勝つ」。
//
// flush() は保留があれば rAF を待たず即座に同期実行する（無ければ何もしない冪等操作）。
// pointerdown / keydown など「直後に確定したレイアウト幾何を読む」経路の入口で呼ぶ。
// cancel() は保留を捨てる。同期 renderStrip() が別経路で走ったとき、次フレームの重複描画を
// 1 回ぶん省くために renderStrip() の先頭から呼ぶ。
//
// apps/shell/extensions/akari-preview/src/common/raf-throttle.ts の写し（extension 間の
// import は行わない契約）に cancel() / pending() を足したもの。scheduleFrame / cancelFrame は
// 既定で window.requestAnimationFrame / cancelAnimationFrame を呼び出し時に解決するため、
// Node 側の単体テストはスタブを渡してブラウザ globals に触れずに検証できる。

export interface RafThrottle {
    /** Record a pending update. Coalesces with any other call() in the same animation frame. */
    call(): void;
    /** Run a pending update synchronously right now (no-op if nothing is pending). */
    flush(): void;
    /** Drop a pending update without running it (no-op if nothing is pending). */
    cancel(): void;
    /** Whether an update is scheduled for the next frame. */
    pending(): boolean;
}

export function createRafThrottle(
    run: () => void,
    scheduleFrame: (callback: () => void) => number = callback => requestAnimationFrame(callback),
    cancelFrame: (handle: number) => void = handle => cancelAnimationFrame(handle)
): RafThrottle {
    let pendingHandle = 0;
    const call = (): void => {
        if (pendingHandle) return;
        pendingHandle = scheduleFrame(() => {
            pendingHandle = 0;
            run();
        });
    };
    const cancel = (): void => {
        if (!pendingHandle) return;
        cancelFrame(pendingHandle);
        pendingHandle = 0;
    };
    const flush = (): void => {
        if (!pendingHandle) return;
        cancel();
        run();
    };
    const pending = (): boolean => pendingHandle !== 0;
    return { call, flush, cancel, pending };
}
