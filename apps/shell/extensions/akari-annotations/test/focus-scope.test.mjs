import assert from 'node:assert/strict';
import test from 'node:test';

import {
  enterFocusScope,
  exitFocusScope,
  focusScopeAtBreadcrumb,
  initialFocusScope,
  rowsInFocusScope,
  timelineDoubleClickAction,
} from '../lib/browser/focus/focus-scope.js';

const rows = [
  { id: 'g', label: 'フック', itemKind: 'group', sourceKind: 'group', trackId: 'v1', depth: 0, hasChildren: true, collapsed: false, at: 10, duration: 70, ticks: [] },
  { id: 'h', label: '見出し', itemKind: 'group', sourceKind: 'group', trackId: 'v1', parentId: 'g', depth: 1, hasChildren: true, collapsed: false, at: 20, duration: 40, ticks: [] },
  { id: 'part', label: 'タイトル', itemKind: 'part', sourceKind: 'html', trackId: 'v1', parentId: 'h', depth: 2, hasChildren: false, collapsed: false, at: 20, duration: 40, ticks: [] },
  { id: 'outside', label: '外', itemKind: 'item', sourceKind: 'html', trackId: 'v2', depth: 0, hasChildren: false, collapsed: false, at: 0, duration: 100, ticks: [] },
];

test('フォーカスは部分木・パンくず・対象 span を返す', () => {
  const state = enterFocusScope(rows, 'h');
  assert.deepEqual(state, {
    rootId: 'h', breadcrumbs: ['全体', 'フック', '見出し'], span: { at: 20, duration: 40 }
  });
  assert.deepEqual(rowsInFocusScope(rows, state).map(row => [row.id, row.depth]), [['h', 0], ['part', 1]]);
});

test('Esc 相当は 1 段ずつ戻り、パンくずクリックで任意段へ戻る', () => {
  const nested = enterFocusScope(rows, 'part');
  assert.equal(exitFocusScope(rows, nested).rootId, 'h');
  assert.equal(focusScopeAtBreadcrumb(rows, nested, 1).rootId, 'g');
  assert.deepEqual(exitFocusScope(rows, enterFocusScope(rows, 'g')), initialFocusScope(rows));
});

test('ダブルクリック割り当ては動画だけ trimmer、その他は focus', () => {
  assert.equal(timelineDoubleClickAction('media', 'media'), 'trimmer');
  assert.equal(timelineDoubleClickAction('group', 'group'), 'focus');
  assert.equal(timelineDoubleClickAction('part', 'html'), 'focus');
  assert.equal(timelineDoubleClickAction('telop', 'telop'), 'focus');
});

test('全体スコープは全行の最小開始から最大終端までを span にする', () => {
  assert.deepEqual(initialFocusScope(rows).span, { at: 0, duration: 100 });
  assert.deepEqual(rowsInFocusScope(rows, initialFocusScope(rows)).map(row => row.id), rows.map(row => row.id));
});

test('存在しないフォーカス対象は黙って空表示にせずエラーにする', () => {
  assert.throws(() => enterFocusScope(rows, 'missing'), /見つかりません/);
});
