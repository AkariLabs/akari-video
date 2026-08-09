import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTimelineClipMenuItems } from '../lib/common/timeline-context-menu-items.js';

function ids(kind, hasClipboard) {
    return buildTimelineClipMenuItems(kind, hasClipboard).map(item => item.id);
}

test('cut・clipboard 無し: 分割/削除のみ（コピー/ペースト無し）', () => {
    assert.deepEqual(ids('cut', false), ['split', 'delete']);
});

test('cut・clipboard 有り: ペースト → 分割 → 削除', () => {
    assert.deepEqual(ids('cut', true), ['paste', 'split', 'delete']);
});

test('overlay・clipboard 無し: コピー → 削除', () => {
    assert.deepEqual(ids('overlay', false), ['copy', 'delete']);
});

test('overlay・clipboard 有り: コピー → ペースト → 削除', () => {
    assert.deepEqual(ids('overlay', true), ['copy', 'paste', 'delete']);
});

test('caption・clipboard 無し: コピー → 削除', () => {
    assert.deepEqual(ids('caption', false), ['copy', 'delete']);
});

test('caption・clipboard 有り: コピー → ペースト → 削除', () => {
    assert.deepEqual(ids('caption', true), ['copy', 'paste', 'delete']);
});

test('layer・clipboard 無し: 削除のみ（コピー/ペースト/分割は既存ハンドラ非対応）', () => {
    assert.deepEqual(ids('layer', false), ['delete']);
});

test('layer・clipboard 有り: ペースト → 削除', () => {
    assert.deepEqual(ids('layer', true), ['paste', 'delete']);
});

test('audio・clipboard 無し: 削除のみ', () => {
    assert.deepEqual(ids('audio', false), ['delete']);
});

test('audio・clipboard 有り: ペースト → 削除', () => {
    assert.deepEqual(ids('audio', true), ['paste', 'delete']);
});

test('削除項目は常に danger: true を持つ', () => {
    for (const kind of ['cut', 'overlay', 'caption', 'layer', 'audio']) {
        for (const hasClipboard of [true, false]) {
            const deleteItem = buildTimelineClipMenuItems(kind, hasClipboard).find(item => item.id === 'delete');
            assert.equal(deleteItem?.danger, true, `${kind}/${hasClipboard}`);
        }
    }
});

test('司令塔裁定3: 並びは常にコピー → ペースト → 分割 → 削除の順序を守る', () => {
    const order = { copy: 0, paste: 1, split: 2, delete: 3 };
    for (const kind of ['cut', 'overlay', 'caption', 'layer', 'audio']) {
        for (const hasClipboard of [true, false]) {
            const indexes = buildTimelineClipMenuItems(kind, hasClipboard).map(item => order[item.id]);
            const sorted = [...indexes].sort((a, b) => a - b);
            assert.deepEqual(indexes, sorted, `${kind}/${hasClipboard}`);
        }
    }
});
