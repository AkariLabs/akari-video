import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyTimelineCollapsedRows,
  buildTimelineTreeRows,
  childRow,
  parentRow,
} from '../lib/browser/timeline/timeline-tree-model.js';

function internalItem(id, at, duration, source, children = [], declaration = {}) {
  return {
    id, at, duration, atFrames: at * 30, durationFrames: duration * 30,
    source, children, declaration: { id, at: at * 30, duration: duration * 30, ...declaration },
    legacy: { collection: 'items', index: 0 },
  };
}

test('木の行は写しを名札順に展開し、親子探索が共通 id を使う', () => {
  const bag = internalItem('bag', 2, 4, { kind: 'html', html: 'overlays/bag.html', exclude: [] });
  const rows = buildTimelineTreeRows([{ id: 'v1', items: [bag] }], {
    partsByHtml: new Map([['overlays/bag.html', [
      { id: 'A', order: 0 }, { id: 'B', order: 1 }, { id: 'C', order: 2 },
    ]]])
  });
  assert.deepEqual(rows.map(row => row.id), ['bag', 'bag#A', 'bag#B', 'bag#C']);
  assert.deepEqual(rows.map(row => row.depth), [0, 1, 1, 1]);
  assert.equal(childRow(rows, 'bag').id, 'bag#A');
  assert.equal(parentRow(rows, 'bag#B').id, 'bag');
});

test('折りたたむと親 1 行だけになり、子の位置を tick に保つ', () => {
  const childA = internalItem('a', 2, 1, { kind: 'filter', filter: {} });
  const childB = internalItem('b', 4, 1, { kind: 'filter', filter: {} });
  const group = internalItem('g', 2, 4, { kind: 'group' }, [childA, childB]);
  const [row] = buildTimelineTreeRows([{ id: 'v1', items: [group] }], { collapsed: new Set(['g']) });
  assert.equal(row.collapsed, true);
  assert.deepEqual(row.ticks, [{ id: 'a', position: 0 }, { id: 'b', position: 0.5 }]);
});

test('名札無し overlay は 1 行・トグル無しのまま', () => {
  const overlay = internalItem('plain', 0, 3, { kind: 'html', html: 'overlays/plain.html' });
  const rows = buildTimelineTreeRows([{ id: 'v1', items: [overlay] }], {
    partsByHtml: new Map([['overlays/plain.html', []]])
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].hasChildren, false);
  assert.equal(rows[0].itemKind, 'item');
});

test('展開済み行へ折りたたみを同期適用し、再読込なしで子を隠して再展開できる', () => {
  const child = internalItem('child', 1, 1, { kind: 'filter', filter: {} });
  const group = internalItem('group', 0, 4, { kind: 'group' }, [child]);
  const expanded = buildTimelineTreeRows([{ id: 'v1', items: [group] }]);
  const collapsed = applyTimelineCollapsedRows(expanded, new Set(['group']));
  assert.deepEqual(collapsed.map(row => row.id), ['group']);
  assert.equal(collapsed[0].collapsed, true);
  assert.deepEqual(applyTimelineCollapsedRows(expanded, new Set()).map(row => row.id), ['group', 'child']);
});
