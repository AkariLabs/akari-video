import test from 'node:test';
import assert from 'node:assert/strict';
import { captionRunRows } from '../lib/browser/inspector/caption-run-rows.js';

test('インスペクターの文字範囲は表示文字列の書記素で示す', () => {
    assert.deepEqual(captionRunRows('A👩‍👩‍👧‍👦最高', [
        { from: 1, to: 2, role: 'keyword' },
        { from: 2, to: 4, style: { color: '#ff0000' } }
    ]), [
        { from: 1, to: 2, text: '👩‍👩‍👧‍👦', chip: 'キーワード' },
        { from: 2, to: 4, text: '最高', chip: '色' }
    ]);
});
