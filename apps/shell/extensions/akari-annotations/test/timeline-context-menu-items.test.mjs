import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTimelineClipMenuItems } from '../lib/common/timeline-context-menu-items.js';

function ids(kind, hasClipboard) {
    return buildTimelineClipMenuItems(kind, hasClipboard).map(item => item.id);
}

for (const kind of ['cut', 'overlay', 'caption', 'layer', 'audio']) {
    test(`${kind}: コピー・切り取り・貼り付け・複製を全種別に出す`, () => {
        const suffix = kind === 'cut' ? ['split', 'delete'] : ['delete'];
        for (const hasClipboard of [false, true]) {
            assert.deepEqual(ids(kind, hasClipboard), ['copy', 'cut', 'paste', 'duplicate', ...suffix]);
            assert.equal(!!buildTimelineClipMenuItems(kind, hasClipboard).find(item => item.id === 'paste').disabled, !hasClipboard);
        }
    });
}

test('BGM とナレーションはコピー・切り取り・複製を出さない', () => {
    assert.deepEqual(buildTimelineClipMenuItems('audio', true, {}, { copyable: false }).map(item => item.id), ['paste', 'delete']);
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
        'コピー', '切り取り', '貼り付け', '複製', '出す', 'まとめる', 'ばらす', '折りたたむ', '親を選択', '削除'
    ]);
});

test('字幕の木アイテムだけにテロップ変換を既存項目順を崩さず足す', () => {
    const items = buildTimelineClipMenuItems('overlay', false, {
        canDetach: true, canConvertToTelop: true
    });
    assert.deepEqual(items.map(item => item.id), ['copy', 'cut', 'paste', 'duplicate', 'detach', 'convert-to-telop', 'delete']);
});

test('司令塔裁定3: 並びは常にコピー → ペースト → 分割 → 削除の順序を守る', () => {
    const order = { copy: 0, cut: 1, paste: 2, duplicate: 3, split: 4, delete: 5 };
    for (const kind of ['cut', 'overlay', 'caption', 'layer', 'audio']) {
        for (const hasClipboard of [true, false]) {
            const indexes = buildTimelineClipMenuItems(kind, hasClipboard).map(item => order[item.id]);
            const sorted = [...indexes].sort((a, b) => a - b);
            assert.deepEqual(indexes, sorted, `${kind}/${hasClipboard}`);
        }
    }
});

test('shared item capability enables split for projected video layers and HTML on any track', () => {
  for (const kind of ['cut', 'layer', 'overlay']) {
    assert.ok(buildTimelineClipMenuItems(kind, false, { canSplit: true }).some(item => item.id === 'split'));
    assert.ok(!buildTimelineClipMenuItems(kind, false, { canSplit: false }).some(item => item.id === 'split'));
  }
});
