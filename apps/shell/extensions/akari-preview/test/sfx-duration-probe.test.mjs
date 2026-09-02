import assert from 'node:assert/strict';
import test from 'node:test';

import { createSharedDurationProbe } from '../lib/common/sfx-duration-probe.js';

// 2026-09-02 preview-perf: probeSfxDurations（akari-preview-open-handler.ts の preview webview）は
// summary.audio.sfx[] の *挿入ごと* に new Audio() で尺を取り、その Promise.all を初回描画の
// ゲートにしていた。createSharedDurationProbe は (1) URL 単位でプローブを共有し、(2) 同時に走る
// 本数を制限し、(3) 1 本ごとに打ち切って null で解決する。ここでは実タイマーの代わりに手動で
// 発火させるスタブを使う（「打ち切りが他を塞がない」ことを決定論的に検証するため）。

function makeTimerStub() {
    let nextHandle = 1;
    const timers = new Map();
    return {
        scheduleTimeout: (callback, ms) => {
            const handle = nextHandle++;
            timers.set(handle, { callback, ms });
            return handle;
        },
        cancelTimeout: handle => {
            timers.delete(handle);
        },
        fire: handle => {
            const timer = timers.get(handle);
            timers.delete(handle);
            timer.callback();
        },
        handles: () => [...timers.keys()],
        pendingCount: () => timers.size
    };
}

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}

// Promise の連鎖（probe().then → finish → pump）を落ち着かせる。
const settle = () => new Promise(resolve => setImmediate(resolve));

test('159 挿入 / 37 ユニーク URL → プローブ呼び出しは 37 回（挿入ごとに new Audio() していた修正前は 159 回）', async () => {
    const uniqueSrcs = Array.from({ length: 37 }, (_, index) => 'sfx/' + index + '.wav');
    const items = Array.from({ length: 159 }, (_, index) => ({ src: uniqueSrcs[index % uniqueSrcs.length] }));
    const durationFor = src => 1 + Number(src.match(/(\d+)\.wav$/)[1]) / 10;

    // 修正前: 挿入ごとに 1 プローブ。
    let beforeCount = 0;
    const beforeProbe = src => { beforeCount += 1; return Promise.resolve(durationFor(src)); };
    await Promise.all(items.map(item => beforeProbe(item.src)));
    assert.equal(beforeCount, 159, '修正前: 1 挿入 = 1 プローブ');

    // 修正後: ユニーク URL ごとに 1 プローブ。既定オプション（実 setTimeout）でも即解決なら
    // タイマーはすべてキャンセルされ、テストプロセスを引き留めない。
    const calls = [];
    const probe = src => { calls.push(src); return Promise.resolve(durationFor(src)); };
    const shared = createSharedDurationProbe(probe);
    const results = await Promise.all(items.map(item => shared(item.src)));
    assert.equal(calls.length, 37, '修正後: ユニーク URL 数だけプローブする');
    assert.deepEqual([...new Set(calls)].sort(), [...uniqueSrcs].sort(), '各ユニーク URL がちょうど 1 回ずつ');
    items.forEach((item, index) => {
        assert.equal(results[index], durationFor(item.src), '各挿入は自分の URL の尺を受け取る: ' + item.src);
    });
    assert.equal(shared(uniqueSrcs[0]), shared(uniqueSrcs[0]), '同じ URL は同じ Promise を共有する（解決後も）');
});

test('同時に走るプローブは maxInFlight（4）本を超えない — 残りは待ち行列で 1 本終わるごとに 1 本始まる', async () => {
    const pending = new Map();
    let inFlightNow = 0;
    let maxObserved = 0;
    const probe = src => {
        inFlightNow += 1;
        maxObserved = Math.max(maxObserved, inFlightNow);
        const entry = deferred();
        pending.set(src, entry);
        return entry.promise;
    };
    const timers = makeTimerStub();
    const shared = createSharedDurationProbe(probe, {
        maxInFlight: 4,
        scheduleTimeout: timers.scheduleTimeout,
        cancelTimeout: timers.cancelTimeout
    });
    const srcs = Array.from({ length: 10 }, (_, index) => 'sfx/' + index + '.wav');
    const results = srcs.map(src => shared(src));
    assert.equal(pending.size, 4, '10 本要求しても最初に始まるのは 4 本');
    assert.equal(timers.pendingCount(), 4, '打ち切りタイマーは走っているプローブの分だけ');

    const finish = (src, value) => {
        inFlightNow -= 1;
        pending.get(src).resolve(value);
    };
    finish('sfx/0.wav', 1.5);
    await settle();
    assert.equal(pending.size, 5, '1 本終わると次の 1 本だけ始まる');
    assert.ok(pending.has('sfx/4.wav'), '待ち行列は要求順（FIFO）');

    for (const src of srcs.slice(1)) {
        while (!pending.has(src)) await settle();
        finish(src, 2);
        await settle();
    }
    assert.deepEqual(await Promise.all(results), [1.5, 2, 2, 2, 2, 2, 2, 2, 2, 2]);
    assert.equal(maxObserved, 4, '同時実行数は一度も 4 を超えない');
    assert.equal(timers.pendingCount(), 0, '正常終了したプローブの打ち切りタイマーはすべてキャンセルされる');
});

test('永久に解決しないプローブは timeoutMs で null に打ち切られ、枠を解放して残りを塞がない', async () => {
    const pending = new Map();
    const probe = src => {
        const entry = deferred();
        pending.set(src, entry);
        return entry.promise;
    };
    const timers = makeTimerStub();
    const timedOut = [];
    const shared = createSharedDurationProbe(probe, {
        maxInFlight: 2,
        timeoutMs: 8000,
        onTimeout: src => timedOut.push(src),
        scheduleTimeout: timers.scheduleTimeout,
        cancelTimeout: timers.cancelTimeout
    });

    const hang = shared('sfx/hang.wav');    // loadedmetadata が永久に来ない素材
    const a = shared('sfx/a.wav');
    const b = shared('sfx/b.wav');
    assert.deepEqual([...pending.keys()], ['sfx/hang.wav', 'sfx/a.wav'], '2 本目までが走り b は待つ');

    pending.get('sfx/a.wav').resolve(3);
    await settle();
    assert.equal(await a, 3);
    assert.ok(pending.has('sfx/b.wav'), 'a が終わると b が始まる（hang が 1 枠を占有したまま）');
    pending.get('sfx/b.wav').resolve(4);
    assert.equal(await b, 4, 'hang とは無関係に b は解決する');

    // ここで hang のタイマーだけが残っている。発火 = 8 s 経過。
    assert.equal(timers.pendingCount(), 1, '残る打ち切りタイマーは hang の 1 本だけ');
    const c = shared('sfx/c.wav');
    await settle();
    assert.ok(pending.has('sfx/c.wav'), '空き枠が 1 つあるので c はすぐ始まる');
    const d = shared('sfx/d.wav');
    await settle();
    assert.ok(!pending.has('sfx/d.wav'), 'hang + c で 2 枠が埋まり d は待つ');

    timers.fire(timers.handles()[0]);
    assert.equal(await hang, null, '打ち切られたプローブは null（尺不明）で解決する');
    assert.deepEqual(timedOut, ['sfx/hang.wav'], 'onTimeout は打ち切られた URL ごとに 1 回');
    await settle();
    assert.ok(pending.has('sfx/d.wav'), '打ち切りで枠が解放され d が始まる');

    pending.get('sfx/c.wav').resolve(5);
    pending.get('sfx/d.wav').resolve(6);
    assert.deepEqual(await Promise.all([c, d]), [5, 6]);

    // 打ち切り後に元のプローブが遅れて解決しても、結果は変わらず二重に枠を返さない。
    pending.get('sfx/hang.wav').resolve(99);
    await settle();
    assert.equal(await hang, null);
    const e = shared('sfx/e.wav');
    const f = shared('sfx/f.wav');
    const g = shared('sfx/g.wav');
    await settle();
    assert.equal([...pending.keys()].filter(src => ['sfx/e.wav', 'sfx/f.wav', 'sfx/g.wav'].includes(src)).length, 2,
        '遅れて解決した hang が枠を二重に返していない（同時実行は依然 2 本）');
    for (const src of ['sfx/e.wav', 'sfx/f.wav', 'sfx/g.wav']) {
        while (!pending.has(src)) await settle();
        pending.get(src).resolve(1);
        await settle();
    }
    assert.deepEqual(await Promise.all([e, f, g]), [1, 1, 1]);
});

test('reject / 同期 throw / 不正な尺（0・NaN・負）は null になり、枠を解放する', async () => {
    const timers = makeTimerStub();
    const probe = src => {
        if (src === 'throw') throw new Error('sync failure');
        if (src === 'reject') return Promise.reject(new Error('network'));
        if (src === 'zero') return Promise.resolve(0);
        if (src === 'nan') return Promise.resolve(NaN);
        if (src === 'negative') return Promise.resolve(-1);
        if (src === 'undefined') return Promise.resolve(undefined);
        return Promise.resolve(2.5);
    };
    const shared = createSharedDurationProbe(probe, {
        maxInFlight: 1,
        scheduleTimeout: timers.scheduleTimeout,
        cancelTimeout: timers.cancelTimeout
    });
    const results = await Promise.all(['throw', 'reject', 'zero', 'nan', 'negative', 'undefined', 'ok'].map(shared));
    assert.deepEqual(results, [null, null, null, null, null, null, 2.5],
        'maxInFlight=1 でも失敗したプローブが後続を塞がず、最後の ok まで到達する');
    assert.equal(timers.pendingCount(), 0);
});

test('createSharedDurationProbe は toString() で webview へ注入できる自己完結の関数（外部識別子を閉じ込めていない）', async () => {
    const source = createSharedDurationProbe.toString();
    assert.match(source, /^function createSharedDurationProbe\(/);
    assert.doesNotMatch(source, /\brequire\(|\bexports\.|\bimport\b/, 'モジュール機構への参照を含まない');
    // eslint-disable-next-line no-new-func
    const revived = new Function('return (' + source + ');')();
    assert.equal(typeof revived, 'function');
    const shared = revived(src => Promise.resolve(src.length));
    assert.equal(await shared('abc'), 3);
});
