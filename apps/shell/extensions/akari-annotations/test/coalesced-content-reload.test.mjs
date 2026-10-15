import assert from 'node:assert/strict';
import test from 'node:test';
import { CoalescedContentReload } from '../lib/common/coalesced-content-reload.js';

const flush = () => new Promise(resolve => setImmediate(resolve));

test('同じ tick の通知は一度だけ読み、同じ内容は描かない', async () => {
    let source = '保存した内容';
    let applied = source;
    let reads = 0;
    let paints = 0;
    const reload = new CoalescedContentReload(async () => {
        reads++;
        if (source !== applied) { applied = source; paints++; }
    });
    reload.request(); reload.request(); reload.request();
    await flush();
    assert.equal(reads, 1);
    assert.equal(paints, 0);
    source = '外部の変更';
    reload.request();
    await flush();
    assert.equal(applied, '外部の変更');
    assert.equal(paints, 1);
    reload.dispose();
});

test('読みの途中で届いた通知は次に読む', async () => {
    let release;
    let reads = 0;
    const reload = new CoalescedContentReload(async () => {
        reads++;
        if (reads === 1) await new Promise(resolve => { release = resolve; });
    });
    reload.request();
    await flush();
    reload.request();
    release();
    await flush();
    assert.equal(reads, 2);
    reload.dispose();
});
