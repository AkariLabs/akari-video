import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyTimelineCollapsedRows,
  buildTimelineTreeRows,
  childRow,
  parentRow,
  visibleTimelineTreeRows,
} from '../lib/browser/timeline/timeline-tree-model.js';

function internalItem(id, at, duration, source, children = [], declaration = {}) {
  return {
    id, at, duration, atFrames: at * 30, durationFrames: duration * 30,
    source, children, declaration: { id, at: at * 30, duration: duration * 30, ...declaration },
    legacy: { collection: 'items', index: 0 },
  };
}

test('袋は通常ヘッダ行を増やさず、全 item 索引では写しと親子関係を保つ', () => {
  const bag = internalItem('bag', 2, 4, { kind: 'html', html: 'overlays/bag.html', exclude: [] });
  const options = {
    partsByHtml: new Map([['overlays/bag.html', [
      { id: 'A', order: 0 }, { id: 'B', order: 1 }, { id: 'C', order: 2 },
    ]]])
  };
  assert.deepEqual(buildTimelineTreeRows([{ id: 'v1', items: [bag] }], options), []);
  const rows = buildTimelineTreeRows([{ id: 'v1', items: [bag] }], {
    ...options, includeAllItems: true
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
  assert.deepEqual(row.ticks, [{ id: 'a', position: 0, row: 0 }, { id: 'b', position: 0.5, row: 0 }]);
});

test('captions 袋は行を写し、同時刻の刻みを別の段へ割り付ける', () => {
  const bag = internalItem('captions-bag', 0, 10, {
    kind: 'captions', path: 'captions.json', exclude: ['c-3']
  });
  const [row] = buildTimelineTreeRows([{ id: 'v1', items: [bag] }], {
    includeAllItems: true,
    captionsByPath: new Map([['captions.json', [
      { id: 'c-1', at: 1, duration: 2 },
      { id: 'c-2', at: 1, duration: 3 },
      { id: 'c-3', at: 6, duration: 1 },
    ]]])
  });
  assert.deepEqual(row.ticks, [
    { id: 'captions-bag#c-1', position: 0.1, row: 0 },
    { id: 'captions-bag#c-2', position: 0.1, row: 1 },
  ]);
});

test('captions 袋とトップレベル葉は通常ヘッダ行にならない', () => {
  const bag = internalItem('captions-bag', 0, 10, { kind: 'captions', path: 'captions.json' });
  const detached = internalItem('cap-c-3', 6, 1, { kind: 'caption', path: 'captions.json', id: 'c-3' });
  const options = {
    captionsByPath: new Map([['captions.json', [
      { id: 'c-1', at: 1, duration: 2 },
      { id: 'c-2', at: 4, duration: 1 },
    ]]])
  };
  assert.deepEqual(buildTimelineTreeRows([{ id: 'v1', items: [bag, detached] }], options), []);
  const rows = buildTimelineTreeRows([{ id: 'v1', items: [bag, detached] }], {
    ...options, includeAllItems: true
  });
  assert.deepEqual(rows.map(row => row.id), [
    'captions-bag', 'captions-bag#c-1', 'captions-bag#c-2', 'cap-c-3'
  ]);
  assert.deepEqual(visibleTimelineTreeRows(rows), []);
});

test('名札無し overlay はヘッダ行にならず帯のチップに留まる', () => {
  const overlay = internalItem('plain', 0, 3, { kind: 'html', html: 'overlays/plain.html' });
  const rows = buildTimelineTreeRows([{ id: 'v1', items: [overlay] }], {
    partsByHtml: new Map([['overlays/plain.html', []]])
  });
  assert.equal(rows.length, 0);
});

test('展開済み行へ折りたたみを同期適用し、再読込なしで子を隠して再展開できる', () => {
  const child = internalItem('child', 1, 1, { kind: 'filter', filter: {} });
  const group = internalItem('group', 0, 4, { kind: 'group' }, [child]);
  const expanded = buildTimelineTreeRows([{ id: 'v1', items: [group] }], { includeAllItems: true });
  const collapsed = applyTimelineCollapsedRows(expanded, new Set(['group']));
  assert.deepEqual(collapsed.map(row => row.id), ['group']);
  assert.equal(collapsed[0].collapsed, true);
  assert.deepEqual(applyTimelineCollapsedRows(expanded, new Set()).map(row => row.id), ['group', 'child']);
});

test('展開中の純グループだけが子行を増やし、子の袋はそれ以上展開しない', () => {
  const bagChild = internalItem('bag-child', 1, 2, { kind: 'html', html: 'bag.html' });
  const leaf = internalItem('leaf', 0, 1, { kind: 'media', src: 'a' });
  const group = internalItem('group', 0, 4, { kind: 'group' }, [bagChild, leaf]);
  const rows = buildTimelineTreeRows([{ id: 'v1', items: [group] }], {
    partsByHtml: new Map([['bag.html', [{ id: 'A', order: 0 }]]])
  });
  assert.deepEqual(rows.map(row => row.id), ['group', 'bag-child', 'leaf']);
  assert.deepEqual(rows.map(row => row.depth), [0, 1, 1]);
  assert.equal(rows.find(row => row.id === 'bag-child').ticks.length, 1);
  assert.equal(rows.some(row => row.id === 'bag-child#A'), false);
});

test('袋 id が折りたたみ集合に混ざっても子索引を隠さず、袋自身も collapsed にならない', () => {
  const bag = internalItem('bag', 0, 4, { kind: 'html', html: 'bag.html' });
  const all = buildTimelineTreeRows([{ id: 'v1', items: [bag] }], {
    includeAllItems: true,
    partsByHtml: new Map([['bag.html', [{ id: 'A', order: 0 }]]])
  });
  const applied = applyTimelineCollapsedRows(all, new Set(['bag']));
  assert.deepEqual(applied.map(row => row.id), ['bag', 'bag#A']);
  assert.equal(applied[0].collapsed, false);
});
