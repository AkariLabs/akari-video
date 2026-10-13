import assert from 'node:assert/strict';
import test from 'node:test';
import { CoalescedCaptionWrites } from '../lib/common/coalesced-caption-writes.js';

test('進行中の一件と保留の最新一件だけを送る', async () => {
    const sent = [];
    const releases = [];
    const queue = new CoalescedCaptionWrites(value => {
        sent.push(value);
        return new Promise(resolve => releases.push(resolve));
    });
    const first = queue.enqueue('caption-1:size', 1);
    const second = queue.enqueue('caption-1:size', 2);
    const third = queue.enqueue('caption-1:size', 3);
    const fourth = queue.enqueue('caption-1:size', 4);
    assert.deepEqual(sent, [1]);
    releases.shift()({ ok: true });
    await first;
    assert.deepEqual(sent, [1, 4]);
    releases.shift()({ ok: true });
    await Promise.all([second, third, fourth]);
});

test('異なる項目は順序どおり両方送る', async () => {
    const sent = [];
    const queue = new CoalescedCaptionWrites(async value => { sent.push(value); return { ok: true }; });
    await Promise.all([queue.enqueue('size', 1), queue.enqueue('color', 2)]);
    assert.deepEqual(sent, [1, 2]);
});

test('失敗した項目の保留は送らず失敗を返す', async () => {
    const sent = [];
    let release;
    const queue = new CoalescedCaptionWrites(value => {
        sent.push(value);
        return new Promise(resolve => { release = resolve; });
    });
    const first = queue.enqueue('size', 1);
    const last = queue.enqueue('size', 3);
    release({ ok: false, message: '保存できませんでした。' });
    assert.equal((await first).ok, false);
    assert.equal((await last).ok, false);
    assert.deepEqual(sent, [1]);
});
