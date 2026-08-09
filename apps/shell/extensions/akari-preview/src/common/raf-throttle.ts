// RAF スロットリング（2026-08-08 オーナー実機フィードバック「サイズ変更がすごくもたつく」/
// 2026-08-09 raf-throttle タスク）。layer/cut のハンドルドラッグは window の pointermove 毎に
// フル layout 再計算（akari-preview-open-handler.ts の updateStageScale = 全レイヤーの
// style/clipPath/matrix3d 再計算 + stage/pen-layer 再配置。querySelectorAll('video') も含む）を
// 同期実行しており、1 pointermove イベント = 1 フル実行になっていた。ドラッグ中は
// pointermove がフレームレートを大きく超える頻度で届くため、同じフレーム内で何度も同じ重い
// 処理を繰り返していたのが「もたつく」の実体。
//
// createRafThrottle(run) は run() の実行を「次の requestAnimationFrame まで最大1回」に
// 折りたたむ。呼び出し側（各 apply*Now 系関数）は毎回まず対象要素の dataset へ最新値を
// 同期で書き込み、その後にこれを呼ぶだけでよい —— pointerup の確定読み取りは常に dataset
// から直接読むため（このファイルとは無関係な既存の書き込み契約）、スロットリングの影響を
// 受けるのは「見た目の再計算タイミング」だけで、確定値そのものは常に最新のまま保たれる。
//
// flush() は保留中の呼び出しがあれば RAF を待たず即座に同期実行し、無ければ何もしない
// （何度呼んでも安全な冪等操作）。ドラッグ終了（pointerup/Escape キャンセル/書き込み失敗時の
// 巻き戻し）の直後に呼ぶことで、確定値が次の描画フレームを待たずに画面へ反映されることを
// 保証する（「追従性を落とさない」契約 — ドラッグ終了時に最終値の反映が1フレームぶん遅れる
// ことを防ぐ）。
//
// Serialized into the preview webview via Function.prototype.toString() -- see
// preview-composite-layout.ts's fitPreviewCompositeRect for the established pattern. Keep this
// self-contained: no closures over module state, no calls to sibling functions in this file.
// scheduleFrame/cancelFrame default to window.requestAnimationFrame/cancelAnimationFrame,
// resolved lazily at call time (only ever needed inside the real webview) so Node-side unit
// tests can pass explicit stubs instead and never touch the browser globals.

export interface RafThrottle {
    /** Record a pending update. Coalesces with any other call() in the same animation frame. */
    call(): void;
    /** Run a pending update synchronously right now (no-op if nothing is pending). */
    flush(): void;
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
    const flush = (): void => {
        if (!pendingHandle) return;
        cancelFrame(pendingHandle);
        pendingHandle = 0;
        run();
    };
    return { call, flush };
}
