import assert from 'node:assert/strict';
import test from 'node:test';
import { applyCaptionStyleBatch, commitCaptionStyleBatch } from '../lib/browser/inspector/caption-style-batch.js';

test('source 域と output 域の効果を一つの captions.json 更新にまとめる', () => {
    const source = JSON.stringify({ captions: [
        { id: 'spoken', start: 0, end: 2, text: '話した言葉', time_domain: 'source' },
        { id: 'placed', start: 0, end: 2, text: '置いた文字', time_domain: 'output' }
    ] });
    const patch = { stroke: { color: '#123456', widthPx: 4 } };
    const result = JSON.parse(applyCaptionStyleBatch(source, [
        { id: 'spoken', style: patch }, { id: 'placed', style: patch }
    ]));
    assert.deepEqual(result.captions.map(caption => caption.text_style.stroke), [
        { color: '#123456', width_px: 4 }, { color: '#123456', width_px: 4 }
    ]);
});

test('複数字幕への変更は一回だけ保存する', async () => {
    const source = JSON.stringify({ captions: [
        { id: 'spoken', start: 0, end: 1, text: '話した言葉' },
        { id: 'placed', start: 0, end: 1, text: '置いた文字', time_domain: 'output' }
    ] });
    const writes = [];
    await commitCaptionStyleBatch([
        { id: 'spoken', style: { color: '#ff0000' } },
        { id: 'placed', style: { color: '#ff0000' } }
    ], source, async () => { throw new Error('既読の本文をもう一度読みました'); },
    async next => { writes.push(next); });
    assert.equal(writes.length, 1);
    assert.deepEqual(JSON.parse(writes[0]).captions.map(caption => caption.text_style.color),
        ['#ff0000', '#ff0000']);
});
