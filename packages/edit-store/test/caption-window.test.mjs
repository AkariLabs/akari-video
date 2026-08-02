import { test } from 'node:test';
import assert from 'node:assert/strict';
import { captionWindowSeconds, findActiveCaption } from '../lib/caption-window.js';

test('captionWindowSeconds: start/end がそのまま窓になる（正典形）', () => {
    assert.deepEqual(captionWindowSeconds({ start: 3, end: 4 }), { start: 3, end: 4 });
});

test('captionWindowSeconds: end 欠落は duration フォールバック（互換形）', () => {
    assert.deepEqual(captionWindowSeconds({ start: 2, duration: 1.5 }), { start: 2, end: 3.5 });
});

test('captionWindowSeconds: end があるとき duration は無視される', () => {
    assert.deepEqual(captionWindowSeconds({ start: 2, end: 5, duration: 99 }), { start: 2, end: 5 });
});

test('captionWindowSeconds: 不正値は 0 幅の窓（表示されない）', () => {
    assert.deepEqual(captionWindowSeconds({ start: 'x', end: undefined }), { start: 0, end: 0 });
    assert.deepEqual(captionWindowSeconds({}), { start: 0, end: 0 });
});

test('findActiveCaption: 半開区間 [start, end) で最初のヒットを返す', () => {
    const captions = [
        { id: 'a', start: 1, end: 2 },
        { id: 'b', start: 2, end: 3 },
        { id: 'c', start: 2.5, end: 4 }
    ];
    assert.equal(findActiveCaption(captions, 1.0)?.id, 'a');
    // end は排他: t=2 で a は終わり b が始まる
    assert.equal(findActiveCaption(captions, 2.0)?.id, 'b');
    // 重複窓は先勝ち（配列順）
    assert.equal(findActiveCaption(captions, 2.7)?.id, 'b');
    assert.equal(findActiveCaption(captions, 3.5)?.id, 'c');
    assert.equal(findActiveCaption(captions, 5.0), undefined);
});
