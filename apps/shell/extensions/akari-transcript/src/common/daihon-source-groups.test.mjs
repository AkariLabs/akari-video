import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { groupSourceRows, normalizeSourceGroupState, sourceGroupStorageKey, shouldAutoExpandPlayback } =
  require('../../lib/common/daihon-source-groups.js');

test('出力順を保った連続区間に分け、同じ素材の再登場と指定なしを区別する', () => {
  const rows = [
    { id: 'a', sourceId: 'video', start: 1, end: 3 },
    { id: 'b', sourceId: 'video', start: 4, end: 7 },
    { id: 'c', sourceId: 'audio', start: 0, end: 2 },
    { id: 'd', sourceId: 'video', start: 8, end: 10 },
    { id: 'e', start: 10, end: 12 }
  ];
  const groups = groupSourceRows(rows);
  assert.deepEqual(groups.map(group => [group.key, group.rowIds, group.duration]), [
    ['source:video', ['a', 'b'], 6], ['source:audio', ['c'], 2],
    ['source:video', ['d'], 2], ['unspecified', ['e'], 2]
  ]);
  assert.deepEqual(rows.map(row => row.id), ['a', 'b', 'c', 'd', 'e']);
  assert.deepEqual(groupSourceRows([]), []);
});

test('保存値は開いた素材だけに正規化し、プロジェクト別キーを作る', () => {
  assert.deepEqual(normalizeSourceGroupState(null), { openSourceIds: [], chipsExpanded: false });
  assert.deepEqual(normalizeSourceGroupState({ openSourceIds: ['source:a', 1, 'source:a', 'unspecified'], chipsExpanded: 1 }),
    { openSourceIds: ['source:a', 'unspecified'], chipsExpanded: false });
  assert.notEqual(sourceGroupStorageKey('file:///a/edit.json'), sourceGroupStorageKey('file:///b/edit.json'));
});

test('再生の初回同期を抑え、行移動と再生開始だけ開く', () => {
  assert.equal(shouldAutoExpandPlayback(null, 'a', false, true, false, null), false);
  assert.equal(shouldAutoExpandPlayback('a', 'a', true, true, true, null), false);
  assert.equal(shouldAutoExpandPlayback('a', 'a', true, true, true, 'a'), true);
  assert.equal(shouldAutoExpandPlayback('a', 'a', false, true, true, null), true);
  assert.equal(shouldAutoExpandPlayback('a', 'b', false, false, true, null), true);
  assert.equal(shouldAutoExpandPlayback('a', null, true, true, true, null), false);
});
