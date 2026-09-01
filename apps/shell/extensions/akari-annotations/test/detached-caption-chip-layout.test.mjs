import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assignDetachedCaptionChipSubRows,
  detachedCaptionChipRows,
} from '../lib/browser/timeline/detached-caption-chip-layout.js';
import { visibleTimelineTreeRows } from '../lib/browser/timeline/timeline-tree-model.js';

const row = (id, overrides = {}) => ({
  id,
  label: id,
  itemKind: 'caption',
  trackId: 'v1',
  depth: 0,
  hasChildren: false,
  collapsed: false,
  at: 0,
  duration: 1,
  ticks: [],
  sourceKind: 'caption',
  ...overrides,
});

test('トップレベル caption 葉はヘッダではなく帯チップ行だけに入る', () => {
  const detached = row('cap-c-1');
  const rows = [detached];
  const headers = visibleTimelineTreeRows(rows);

  assert.deepEqual(headers, []);
  assert.deepEqual(detachedCaptionChipRows(rows, headers).map(candidate => candidate.id), ['cap-c-1']);
});

test('袋の子 caption は帯チップ行へ重複追加しない', () => {
  const bagChild = row('caps#c-1', { parentId: 'caps', depth: 1 });
  assert.deepEqual(detachedCaptionChipRows([bagChild], []), []);
});

test('純グループの子 caption は headerRows 側にあるため重複追加しない', () => {
  const group = row('group', {
    itemKind: 'group', sourceKind: 'group', hasChildren: true,
  });
  const child = row('group-caption', { parentId: 'group', depth: 1 });
  const rows = [group, child];
  const headers = visibleTimelineTreeRows(rows);

  assert.deepEqual(headers.map(candidate => candidate.id), ['group', 'group-caption']);
  assert.deepEqual(detachedCaptionChipRows(rows, headers), []);
});

test('通常 item と caption 葉の重なりを別段へ割り当てる', () => {
  const layout = assignDetachedCaptionChipSubRows(
    [{ id: 'ordinary', start: 0, end: 2 }],
    [row('cap-c-1', { at: 1, duration: 2 })],
  );

  assert.notEqual(layout.rowById.get('ordinary'), layout.rowById.get('cap-c-1'));
  assert.equal(layout.subrowCount, 2);
});

test('caption 葉だけのトラックは空段を挟まず 1 段になる', () => {
  const layout = assignDetachedCaptionChipSubRows([], [row('cap-c-1', { at: 1, duration: 2 })]);

  assert.equal(layout.rowById.get('cap-c-1'), 0);
  assert.equal(layout.subrowCount, 1);
});

test('overlays 段では通常 overlay と caption 葉を同じ段割りへ混ぜる', () => {
  const layout = assignDetachedCaptionChipSubRows(
    [{ id: 'overlay', start: 0, end: 3 }],
    [row('cap-c-1', { at: 1, duration: 1 })],
    { placement: 'mix', baseHeight: 24, subrowStride: 24 },
  );

  assert.equal(layout.rowById.get('overlay'), 0);
  assert.equal(layout.rowById.get('cap-c-1'), 1);
  assert.equal(layout.height, 48);
});

test('cuts 段では既存配置を変更せず baseHeight の直下へ caption 葉を積む', () => {
  const layout = assignDetachedCaptionChipSubRows(
    [{ id: 'cut-1', start: 0, end: 3 }],
    [row('cap-c-1', { at: 1, duration: 1 })],
    { placement: 'append', baseHeight: 48, subrowStride: 24 },
  );

  assert.equal(layout.rowById.has('cut-1'), false);
  assert.equal(layout.rowById.get('cap-c-1'), 2);
  assert.equal(layout.height, 72);
});
