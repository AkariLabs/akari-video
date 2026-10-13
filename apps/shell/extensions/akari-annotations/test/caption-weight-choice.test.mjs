import assert from 'node:assert/strict';
import test from 'node:test';

import { writeCaptionWeightOptimistically } from '../lib/browser/inspector/caption-weight-choice.js';

test('太さの印とプレビューは保存応答より先に変わり、失敗時に戻る', async () => {
    const painted = [];
    const previews = [];
    let finish;
    const pending = writeCaptionWeightOptimistically('400', '900', value => painted.push(value),
        (state, weight) => previews.push([state, weight]),
        () => new Promise(resolve => { finish = resolve; }), () => true);
    assert.deepEqual(painted, ['900']);
    assert.deepEqual(previews, [['start', 900]]);
    finish({ ok: false });
    await pending;
    assert.deepEqual(painted, ['900', '400']);
    assert.deepEqual(previews.at(-1), ['failed', 900]);
});

test('古い保存応答は新しい選択印を巻き戻さない', async () => {
    const painted = [];
    const previews = [];
    let latest = true;
    const pending = writeCaptionWeightOptimistically('400', '700', value => painted.push(value),
        state => previews.push(state), async () => ({ ok: false }), () => latest);
    latest = false;
    await pending;
    assert.deepEqual(painted, ['700']);
    assert.deepEqual(previews, ['start']);
});
