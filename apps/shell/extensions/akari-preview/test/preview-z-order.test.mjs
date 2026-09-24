import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { PREVIEW_Z_ORDER_MENU_ITEMS, previewZOrderMenuVisible } from '../lib/common/preview-context-menu.js';

const host = readFileSync(new URL('../src/browser/akari-preview-open-handler.ts', import.meta.url), 'utf8');
const contribution = readFileSync(new URL('../../akari-annotations/src/browser/akari-annotations-contribution.ts', import.meta.url), 'utf8');

test('four z menu commands are visible only for one real output-preview selection', () => {
  const selected = { source: 'akari-output-preview', selectionKind: 'leaf', selectedNodeKind: 'leaf', selectedIds: ['a'] };
  assert.equal(previewZOrderMenuVisible(selected), true);
  assert.equal(previewZOrderMenuVisible({ ...selected, selectionKind: 'group', selectedNodeKind: 'group' }), true);
  // interaction.js marks every selected non-leaf, including a top-level bag, as a group selection.
  assert.equal(previewZOrderMenuVisible({ ...selected, selectionKind: 'group',
    selectedNodeKind: 'bag', selectedIds: ['bag'] }), true);
  for (const invalid of [undefined, { ...selected, source: 'other-webview' },
    { ...selected, selectedIds: [] }, { ...selected, selectedIds: ['a', 'b'], selectionKind: 'multi' },
    { ...selected, selectedIds: ['bag#A'] }, { ...selected, scopeNodeKind: 'bag' }]) {
    assert.equal(previewZOrderMenuVisible(invalid), false);
  }
  assert.deepEqual(PREVIEW_Z_ORDER_MENU_ITEMS.map(({ id, label, op, order }) => [id, label, op, order]), [
    ['akari.preview.zOrder.front', '最前面へ', 'front', '1'],
    ['akari.preview.zOrder.forward', '前面へ', 'forward', '2'],
    ['akari.preview.zOrder.backward', '背面へ', 'backward', '3'],
    ['akari.preview.zOrder.back', '最背面へ', 'back', '4']
  ]);
  assert.match(host, /Z_ORDER_PREVIEW_MENU = \[\.\.\.WEBVIEW_CONTEXT_MENU, 'akari-preview-z-order'\]/u);
  assert.match(host, /registerMenuAction\(Z_ORDER_PREVIEW_MENU, \{\s*commandId: id, label, order/u);
  assert.match(host, /context === this\.previewGroupMenuContext && previewZOrderMenuVisible\(context\)/u);
  assert.match(host, /akari\.preview\.zOrderCommand/u);
  assert.match(contribution, /runPreviewZOrderCommand\(request\.editUri, request\.op, request\.selectedIds\)/u);
});

test('L1 runner checks z-menu order and deep selection before group-child commands', () => {
  const runner = readFileSync(new URL('../evidence/preview-context-z-order-v1/scripts/run-l1.mjs', import.meta.url), 'utf8');
  assert.match(runner, /'z menu order', menu/u);
  assert.match(runner, /await click\('nested', mod\);[\s\S]*selected\.id === 'nested' && selected\.scope === 'g'/u);
  assert.match(runner, /await click\('nested2', mod\);[\s\S]*selected\.id === 'nested2' && selected\.scope === 'g'/u);
});
