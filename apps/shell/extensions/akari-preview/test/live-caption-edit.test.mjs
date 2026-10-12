import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { LiveCaptionEdit } = require('../lib/common/live-caption-edit.js');
const { updateCaptionTextSource } = require('../lib/common/caption-zone-write.js');

test('入力の 150ms 後に書き、連続入力中も 300ms 以内に書く', async t => {
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    const writes = [];
    const edit = new LiveCaptionEdit('元', async value => { writes.push(value); });
    edit.input('元A');
    t.mock.timers.tick(149);
    assert.deepEqual(writes, []);
    t.mock.timers.tick(1);
    await Promise.resolve();
    assert.deepEqual(writes, ['元A']);
    for (let index = 0; index < 5; index++) {
        edit.input(`元A${index}`);
        t.mock.timers.tick(70);
    }
    await Promise.resolve();
    assert.ok(writes.length >= 2);
    assert.equal(writes[1], '元A4');
});

test('IME 中と空欄では書かず、compositionend から保存する', async t => {
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    const writes = [];
    const edit = new LiveCaptionEdit('元', async value => { writes.push(value); });
    edit.input('元X');
    edit.compositionStart();
    await Promise.resolve();
    edit.input('元Xに', true);
    t.mock.timers.tick(1400);
    assert.deepEqual(writes, ['元X']);
    edit.compositionEnd('元X日本');
    t.mock.timers.tick(150);
    await Promise.resolve();
    assert.deepEqual(writes, ['元X', '元X日本']);
    edit.input('');
    t.mock.timers.tick(500);
    assert.deepEqual(writes, ['元X', '元X日本']);
});

test('古い応答の後に最新だけを書き、1 編集の確定だけを履歴へ積む', async () => {
    const writes = [];
    let release;
    const first = new Promise(resolve => { release = resolve; });
    const edit = new LiveCaptionEdit('元', async value => {
        writes.push(value);
        if (writes.length === 1) await first;
    });
    edit.input('元A');
    const flushing = edit.flush();
    edit.input('元AB');
    edit.input('元ABC');
    release();
    await flushing;
    const history = [];
    if (await edit.finish('元ABC')) history.push(['元', '元ABC']);
    assert.deepEqual(writes, ['元A', '元ABC']);
    assert.deepEqual(history, [['元', '元ABC']]);
    const cancelled = new LiveCaptionEdit('元', async () => {});
    cancelled.input('元A');
    await cancelled.cancel();
    assert.deepEqual(history, [['元', '元ABC']]);
});

test('直前の保存待ちに IME が始まっても確定前の文字だけを書く', async t => {
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    const writes = [];
    let release;
    const first = new Promise(resolve => { release = resolve; });
    const edit = new LiveCaptionEdit('元', async value => {
        writes.push(value);
        if (writes.length === 1) await first;
    });
    edit.input('元A');
    const writing = edit.flush();
    edit.input('元AX');
    edit.compositionStart();
    edit.input('元AXにほ', true);
    t.mock.timers.tick(1400);
    release();
    await writing;
    await Promise.resolve();
    await Promise.resolve();
    assert.deepEqual(writes, ['元A', '元AX']);
    edit.compositionEnd('元AX日本');
    t.mock.timers.tick(150);
    await Promise.resolve();
    assert.deepEqual(writes, ['元A', '元AX', '元AX日本']);
});

test('プレビューの途中保存を重ねても文字範囲の色を伸ばさない', () => {
    let source = JSON.stringify({ captions: [{ id: 'c', start: 0, end: 1, text: '前後',
        runs: [{ from: 0, to: 1, style: { color: '#ffffff' } }] }] });
    for (const value of ['前A後', '前AB後', '前ABC後']) source = updateCaptionTextSource(source, 'c', value);
    assert.deepEqual(JSON.parse(source).captions[0].runs.map(run => [run.from, run.to]), [[0, 1]]);
});
