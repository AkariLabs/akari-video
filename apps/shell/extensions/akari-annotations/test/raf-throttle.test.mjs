import assert from 'node:assert/strict';
import test from 'node:test';

import { createRafThrottle } from '../lib/browser/raf-throttle.js';

// task/2026-09-02-preview-perf: トラックパッドのピンチズームは ctrl+wheel が 60–120 Hz で届き、
// 従来は 1 イベント = 1 回のフル renderStrip() だった。タイムライン側の写しは akari-preview の
// createRafThrottle（call / flush）に cancel / pending を足したもの。ここでは requestAnimationFrame
// の代わりにフレームを 1 個ずつ手動で進めるスタブで「同一フレーム内で何回 call() されたか」を
// 決定論的に検証する。

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
        fireFrame: () => {
            const callbacks = [...scheduled.values()];
            scheduled.clear();
            for (const callback of callbacks) callback();
        },
        pendingCount: () => scheduled.size
    };
}

test('同一フレーム内の N 回の call() は run() 1 回に折りたたまれる', () => {
    let runCount = 0;
    const stub = makeFrameStub();
    const throttle = createRafThrottle(() => { runCount += 1; }, stub.scheduleFrame, stub.cancelFrame);
    for (let i = 0; i < 40; i += 1) throttle.call();
    assert.equal(runCount, 0, 'フレーム発火前は run() が走らない');
    assert.equal(stub.pendingCount(), 1, '同一フレーム内の call() は 1 個の rAF に折りたたまれる');
    assert.equal(throttle.pending(), true);
    stub.fireFrame();
    assert.equal(runCount, 1, 'フレーム発火で run() はちょうど 1 回');
    assert.equal(throttle.pending(), false);
});

test('run() は実行時点の最新状態を読む（最後の要求が勝つ）', () => {
    let latest = 0;
    const observed = [];
    const stub = makeFrameStub();
    const throttle = createRafThrottle(() => { observed.push(latest); }, stub.scheduleFrame, stub.cancelFrame);
    latest = 10; throttle.call();
    latest = 5; throttle.call();
    latest = 2.5; throttle.call();
    stub.fireFrame();
    assert.deepEqual(observed, [2.5]);
});

test('flush() は保留を即座に同期実行し、予約済みフレームを取り消す', () => {
    let runCount = 0;
    const stub = makeFrameStub();
    const throttle = createRafThrottle(() => { runCount += 1; }, stub.scheduleFrame, stub.cancelFrame);
    throttle.call();
    throttle.flush();
    assert.equal(runCount, 1);
    assert.equal(stub.pendingCount(), 0);
    stub.fireFrame();
    assert.equal(runCount, 1, 'flush 済みのフレームが後から発火しても二重実行しない');
    throttle.flush();
    assert.equal(runCount, 1, '保留が無い flush() は no-op');
});

test('cancel() は保留を run() せずに捨てる（同期 renderStrip が別経路で走ったときの重複描画防止）', () => {
    let runCount = 0;
    const stub = makeFrameStub();
    const throttle = createRafThrottle(() => { runCount += 1; }, stub.scheduleFrame, stub.cancelFrame);
    throttle.call();
    assert.equal(throttle.pending(), true);
    throttle.cancel();
    assert.equal(throttle.pending(), false);
    assert.equal(stub.pendingCount(), 0, 'cancel() は rAF ハンドルも解放する');
    stub.fireFrame();
    assert.equal(runCount, 0, 'cancel 後にフレームが発火しても run() は走らない');
    throttle.cancel();
    assert.equal(runCount, 0, '保留が無い cancel() は no-op');
    throttle.call();
    assert.equal(stub.pendingCount(), 1, 'cancel 後の call() は新しいフレームを予約する');
    stub.fireFrame();
    assert.equal(runCount, 1);
});

test('run() の中から cancel() を呼んでも安全（renderStrip 先頭の cancel と同型）', () => {
    let runCount = 0;
    const stub = makeFrameStub();
    const throttle = createRafThrottle(() => { throttle.cancel(); runCount += 1; }, stub.scheduleFrame, stub.cancelFrame);
    throttle.call();
    stub.fireFrame();
    assert.equal(runCount, 1);
    assert.equal(throttle.pending(), false);
    throttle.call();
    assert.equal(stub.pendingCount(), 1);
});
