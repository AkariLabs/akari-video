import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTimelineClipMenuItems } from '../lib/common/timeline-context-menu-items.js';

function ids(kind, hasClipboard) {
    return buildTimelineClipMenuItems(kind, hasClipboard).map(item => item.id);
}

test('cut・clipboard 無し: コピー → 分割 → 削除', () => {
    assert.deepEqual(ids('cut', false), ['copy', 'split', 'delete']);
});

test('cut・clipboard 有り: コピー → ペースト → 分割 → 削除', () => {
    assert.deepEqual(ids('cut', true), ['copy', 'paste', 'split', 'delete']);
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

test('layer・clipboard 無し: コピー → 削除', () => {
    assert.deepEqual(ids('layer', false), ['copy', 'delete']);
});

test('layer・clipboard 有り: コピー → ペースト → 削除', () => {
    assert.deepEqual(ids('layer', true), ['copy', 'paste', 'delete']);
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

test('木アイテムには出す・まとめる・ばらす・折りたたみ・親選択を既存項目の前へ足す', () => {
    const items = buildTimelineClipMenuItems('overlay', false, {
        canDetach: true, canGroup: true, canUngroup: true,
        canToggleCollapse: true, collapsed: false, hasParent: true
    });
    assert.deepEqual(items.map(item => item.label), [
        'コピー', '出す', 'まとめる', 'ばらす', '折りたたむ', '親を選択', '削除'
    ]);
});

test('字幕の木アイテムだけにテロップ変換を既存項目順を崩さず足す', () => {
    const items = buildTimelineClipMenuItems('overlay', false, {
        canDetach: true, canConvertToTelop: true
    });
    assert.deepEqual(items.map(item => item.id), ['copy', 'detach', 'convert-to-telop', 'delete']);
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
