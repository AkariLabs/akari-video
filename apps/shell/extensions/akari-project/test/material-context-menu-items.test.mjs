import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMaterialContextMenuItems } from '../lib/common/material-context-menu-items.js';

function ids(target, isOSX, context) {
    return buildMaterialContextMenuItems(target, isOSX, context).map(item => item.id);
}

test('material（macOS）: open/reveal/copy-file/copy-path/rename/delete/ask-agent の順', () => {
    assert.deepEqual(ids('material', true), [
        'open', 'reveal', 'copy-file', 'copy-path', 'rename', 'delete', 'ask-agent'
    ]);
});

test('material（非 macOS）: copy-file が出ない', () => {
    assert.deepEqual(ids('material', false), [
        'open', 'reveal', 'copy-path', 'rename', 'delete', 'ask-agent'
    ]);
});

test('assetGroup（meta.json ディレクトリ）は material と同じ target を使い、同じ項目集合になる', () => {
    // buildAssetGroupEntry は MaterialCardEntry.assetGroup を持つが、メニュー項目の
    // 組み立てでは通常素材と同じ 'material' ターゲットを渡す（widget 側の設計）。
    assert.deepEqual(ids('material', true), ids('material', true));
    assert.deepEqual(buildMaterialContextMenuItems('material', true).map(item => item.id).includes('rename'), true);
});

test('unorganized（macOS）: material の項目 + move-to-assets が末尾', () => {
    assert.deepEqual(ids('unorganized', true), [
        'open', 'reveal', 'copy-file', 'copy-path', 'rename', 'delete', 'ask-agent', 'move-to-assets'
    ]);
});

test('unorganized（非 macOS）: copy-file が出ず move-to-assets は残る', () => {
    assert.deepEqual(ids('unorganized', false), [
        'open', 'reveal', 'copy-path', 'rename', 'delete', 'ask-agent', 'move-to-assets'
    ]);
});

test('export（macOS）: material と同じ破壊操作セット（move-to-assets は無し）', () => {
    assert.deepEqual(ids('export', true), [
        'open', 'reveal', 'copy-file', 'copy-path', 'rename', 'delete', 'ask-agent'
    ]);
});

test('export（非 macOS）: copy-file が出ない', () => {
    assert.deepEqual(ids('export', false), [
        'open', 'reveal', 'copy-path', 'rename', 'delete', 'ask-agent'
    ]);
});

for (const target of ['data', 'plan', 'report']) {
    test(`${target}（macOS）: 開く系のみ（rename/delete/ask-agent/move-to-assets 無し）`, () => {
        assert.deepEqual(ids(target, true), ['open', 'reveal', 'copy-file', 'copy-path']);
    });

    test(`${target}（非 macOS）: copy-file も無い`, () => {
        assert.deepEqual(ids(target, false), ['open', 'reveal', 'copy-path']);
    });
}

test('delete 項目は danger: true を持つ（破壊操作の可視化）', () => {
    const deleteItem = buildMaterialContextMenuItems('material', true).find(item => item.id === 'delete');
    assert.equal(deleteItem?.danger, true);
});

test('data/plan/report には danger 項目自体が存在しない', () => {
    for (const target of ['data', 'plan', 'report']) {
        const dangerItems = buildMaterialContextMenuItems(target, true).filter(item => item.danger);
        assert.deepEqual(dangerItems, []);
    }
});

// --- task 2026-08-10-material-menu-r2: add-to-timeline / show-info ---

test('material × video（macOS）: add-to-timeline と show-info が追加される（並び順込み）', () => {
    assert.deepEqual(ids('material', true, { materialKind: 'video' }), [
        'open', 'add-to-timeline', 'reveal', 'copy-file', 'copy-path', 'show-info', 'rename', 'delete', 'ask-agent'
    ]);
});

test('material × audio（非 macOS）: add-to-timeline と show-info が追加される（copy-file は無し）', () => {
    assert.deepEqual(ids('material', false, { materialKind: 'audio' }), [
        'open', 'add-to-timeline', 'reveal', 'copy-path', 'show-info', 'rename', 'delete', 'ask-agent'
    ]);
});

test('material × image: add-to-timeline と show-info が追加される（task 2026-08-10-material-dnd-timeline で解禁）', () => {
    assert.deepEqual(ids('material', true, { materialKind: 'image' }), [
        'open', 'add-to-timeline', 'reveal', 'copy-file', 'copy-path', 'show-info', 'rename', 'delete', 'ask-agent'
    ]);
});

test('material × other: add-to-timeline は出ず、show-info だけ出る', () => {
    assert.deepEqual(ids('material', true, { materialKind: 'other' }), [
        'open', 'reveal', 'copy-file', 'copy-path', 'show-info', 'rename', 'delete', 'ask-agent'
    ]);
});

test('unorganized: context ありでも add-to-timeline/show-info はどちらも出ない', () => {
    assert.deepEqual(ids('unorganized', true, { materialKind: 'video' }), [
        'open', 'reveal', 'copy-file', 'copy-path', 'rename', 'delete', 'ask-agent', 'move-to-assets'
    ]);
});

test('export: context ありでも add-to-timeline/show-info はどちらも出ない', () => {
    assert.deepEqual(ids('export', true, { materialKind: 'video' }), [
        'open', 'reveal', 'copy-file', 'copy-path', 'rename', 'delete', 'ask-agent'
    ]);
});

test('data: context ありでも add-to-timeline/show-info はどちらも出ない', () => {
    assert.deepEqual(ids('data', true, { materialKind: 'video' }), [
        'open', 'reveal', 'copy-file', 'copy-path'
    ]);
});

test('context 省略時は前タスクと完全に同じ項目列（後方互換）', () => {
    assert.deepEqual(ids('material', true), [
        'open', 'reveal', 'copy-file', 'copy-path', 'rename', 'delete', 'ask-agent'
    ]);
    assert.deepEqual(ids('material', false), [
        'open', 'reveal', 'copy-path', 'rename', 'delete', 'ask-agent'
    ]);
    assert.deepEqual(ids('unorganized', true), [
        'open', 'reveal', 'copy-file', 'copy-path', 'rename', 'delete', 'ask-agent', 'move-to-assets'
    ]);
});
