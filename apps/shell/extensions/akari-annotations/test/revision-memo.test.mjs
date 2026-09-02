import assert from 'node:assert/strict';
import test from 'node:test';

import { createRevisionMemo } from '../lib/browser/revision-memo.js';

// task/2026-09-02-preview-perf: contentEndDuration() は O(items) の集計で、ズーム 1 イベントに
// totalDuration() 経由で 8 回前後呼ばれていた。リビジョン番号が同じあいだは計算済みの値を返す。

test('同じリビジョンのあいだは compute() を 1 回しか呼ばない', () => {
    let computeCount = 0;
    const memo = createRevisionMemo(() => { computeCount += 1; return 42; });
    for (let i = 0; i < 8; i += 1) assert.equal(memo.read(0), 42);
    assert.equal(computeCount, 1);
});

test('リビジョンが進むと再計算し、以降はまた新しい値をメモする', () => {
    let value = 10;
    let computeCount = 0;
    const memo = createRevisionMemo(() => { computeCount += 1; return value; });
    assert.equal(memo.read(0), 10);
    value = 20;
    assert.equal(memo.read(0), 10, 'リビジョンが同じなら古い値のまま（モデル変更はリビジョンで告知する契約）');
    assert.equal(memo.read(1), 20);
    assert.equal(memo.read(1), 20);
    assert.equal(computeCount, 2);
});

test('compute() が例外を投げたときは何もメモしない', () => {
    let fail = true;
    let computeCount = 0;
    const memo = createRevisionMemo(() => {
        computeCount += 1;
        if (fail) throw new Error('boom');
        return 1;
    });
    assert.throws(() => memo.read(0), /boom/);
    fail = false;
    assert.equal(memo.read(0), 1, '同じリビジョンでも失敗はキャッシュされず再計算される');
    assert.equal(computeCount, 2);
});
