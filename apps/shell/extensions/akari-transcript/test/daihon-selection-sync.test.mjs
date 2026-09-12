import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  planRowClick,
  selectedRowIds,
  selectionSyncPayload
} = require('../lib/common/daihon-selection.js');

test('行クリックは無修飾なら seek、⌘/Ctrl または Shift なら select を計画する', () => {
  assert.deepEqual(planRowClick({ meta: false, shift: false }), { kind: 'seek' });
  assert.deepEqual(planRowClick({ meta: true, shift: false }), {
    kind: 'select', modifiers: { meta: true, shift: false }
  });
  assert.deepEqual(planRowClick({ meta: false, shift: true }), {
    kind: 'select', modifiers: { meta: false, shift: true }
  });
  assert.deepEqual(planRowClick({ meta: true, shift: true }), {
    kind: 'select', modifiers: { meta: true, shift: true }
  });
});

test('選択同期 payload は順序を保ったコピーを返し、元の選択を変更しない', () => {
  const selection = { selected: ['c-2', 'c-4'], anchorId: 'c-4' };
  const payload = selectionSyncPayload('file:///project/edit.json', selection);
  assert.deepEqual(payload, {
    editUri: 'file:///project/edit.json', captionIds: ['c-2', 'c-4']
  });
  assert.notEqual(payload.captionIds, selection.selected);
  payload.captionIds.push('c-5');
  assert.deepEqual(selection.selected, ['c-2', 'c-4']);
});

test('行の見た目は通常時に実選択だけ、⌥ 全体モード中に全行を選ぶ', () => {
  const order = ['c-1', 'c-2', 'c-3'];
  const selection = { selected: ['c-3', 'c-1'], anchorId: 'c-3' };
  assert.deepEqual(selectedRowIds(order, selection, false), ['c-1', 'c-3']);
  assert.deepEqual(selectedRowIds(order, selection, true), order);
});
