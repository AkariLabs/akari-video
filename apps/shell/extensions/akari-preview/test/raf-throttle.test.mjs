import assert from 'node:assert/strict';
import test from 'node:test';

import { createRafThrottle } from '../lib/common/raf-throttle.js';

// 2026-08-09 raf-throttle: オーナー実機フィードバック「サイズ変更がすごくもたつく」の恒久対応。
// akari-preview-open-handler.ts の apply*Now 系（レイヤー移動/拡縮/回転・crop ハンドル・cut
// transform）は、ハンドルドラッグ中の window pointermove *毎* に重い updateStageScale
// （updateLayerLayout。全レイヤーの style/clipPath/matrix3d 再計算 + stage/pen-layer 再配置）を
// 同期実行していた。createRafThrottle(run) はこの「重い方」の実行を1フレームに最大1回へ間引く。
//
// ここでは実ブラウザの requestAnimationFrame の代わりに、フレームを明示的に1個ずつ手動で
// 進められるスタブスケジューラを使う（フレーム境界を自分でコントロールしないと「1フレーム内で
// 何回 call() されたか」を決定論的に検証できないため）。

function makeFrameStub() {
    let nextHandle = 1;
    const scheduled = new Map();
    return {
        scheduleFrame: callback => {
            const handle = nextHandle++;
            scheduled.set(handle, callback);
            return handle;
        },
        cancelFrame: handle => {
            scheduled.delete(handle);
        },
        // Runs every callback currently scheduled (simulates the browser firing one RAF tick).
        fireFrame: () => {
            const callbacks = [...scheduled.values()];
            scheduled.clear();
            for (const callback of callbacks) callback();
        },
        pendingCount: () => scheduled.size
    };
}

test('N pointermove-style call()s within the same frame collapse into exactly 1 run() -- before/after evidence', () => {
    // "修正前": ハンドルの pointermove ハンドラが素の関数を毎回同期呼び出ししていた場合の回数。
    let beforeCount = 0;
    const beforeRun = () => { beforeCount += 1; };
    const N = 12; // a plausible pointermove burst within a single animation frame during a fast drag
    for (let i = 0; i < N; i += 1) beforeRun();
    assert.equal(beforeCount, N, '修正前: 1 pointermove = 1 回のフル実行 (N 回)');

    // "修正後": 同じ N 回の呼び出しを createRafThrottle 経由にすると、フレームが1回発火するまで
    // run() は1回も走らず、フレーム発火時にちょうど1回だけ走る。
    let afterCount = 0;
    const stub = makeFrameStub();
    const throttle = createRafThrottle(() => { afterCount += 1; }, stub.scheduleFrame, stub.cancelFrame);
    for (let i = 0; i < N; i += 1) throttle.call();
    assert.equal(afterCount, 0, '修正後: フレーム発火前は run() が1度も走らない（dataset 書き込みのみ）');
    assert.equal(stub.pendingCount(), 1, '同一フレーム内の N 回の call() は1個の RAF ハンドルに折りたたまれる');
    stub.fireFrame();
    assert.equal(afterCount, 1, '修正後: フレーム発火で run() はちょうど1回だけ走る');
});

test('call() bursts across multiple frames run once per frame (not suppressed forever)', () => {
    let runCount = 0;
    const stub = makeFrameStub();
    const throttle = createRafThrottle(() => { runCount += 1; }, stub.scheduleFrame, stub.cancelFrame);

    for (let frame = 0; frame < 3; frame += 1) {
        for (let i = 0; i < 5; i += 1) throttle.call();
        stub.fireFrame();
    }
    assert.equal(runCount, 3, '3フレーム分のバーストはそれぞれ1回ずつ、計3回 run() される');
});

test('run() observes the latest state at flush time, not the state when call() was first scheduled', () => {
    // dataset への書き込みは常に同期、スロットリングされるのは「見た目の反映」だけ、という設計の
    // 検証: call() を複数回呼んでも、実行時に読むのは呼び出し側が直近で書いた最新値。
    let latest = 0;
    const observed = [];
    const stub = makeFrameStub();
    const throttle = createRafThrottle(() => { observed.push(latest); }, stub.scheduleFrame, stub.cancelFrame);

    latest = 1; throttle.call();
    latest = 2; throttle.call();
    latest = 3; throttle.call();
    stub.fireFrame();

    assert.deepEqual(observed, [3], 'run() は最後に書かれた値だけを1回反映する（中間値は描画されない）');
});

test('flush() runs a pending call synchronously without waiting for the frame, and cancels the scheduled frame', () => {
    let runCount = 0;
    const stub = makeFrameStub();
    const throttle = createRafThrottle(() => { runCount += 1; }, stub.scheduleFrame, stub.cancelFrame);

    throttle.call();
    assert.equal(runCount, 0);
    assert.equal(stub.pendingCount(), 1);

    throttle.flush();
    assert.equal(runCount, 1, 'flush() は保留中の run() を即座に同期実行する');
    assert.equal(stub.pendingCount(), 0, 'flush() は元々スケジュールされていたフレームをキャンセルする');

    // フレームが実際に発火しても、flush 済みなので二重実行されない。
    stub.fireFrame();
    assert.equal(runCount, 1, 'flush 済みのフレームが後から発火しても run() は増えない');
});

test('flush() is a safe no-op when nothing is pending', () => {
    let runCount = 0;
    const stub = makeFrameStub();
    const throttle = createRafThrottle(() => { runCount += 1; }, stub.scheduleFrame, stub.cancelFrame);

    throttle.flush();
    throttle.flush();
    assert.equal(runCount, 0, '保留が無い状態での flush() は run() を呼ばない（ドラッグ終了時の常時呼び出しが安全な理由）');
});

test('call() immediately after flush() schedules a fresh frame (does not stay collapsed)', () => {
    let runCount = 0;
    const stub = makeFrameStub();
    const throttle = createRafThrottle(() => { runCount += 1; }, stub.scheduleFrame, stub.cancelFrame);

    throttle.call();
    throttle.flush();
    assert.equal(runCount, 1);

    throttle.call();
    assert.equal(stub.pendingCount(), 1, 'flush 後の新しい call() はちゃんと次のフレームを新規スケジュールする');
    stub.fireFrame();
    assert.equal(runCount, 2);
});
