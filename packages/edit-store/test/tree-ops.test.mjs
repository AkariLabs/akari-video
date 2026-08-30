import assert from 'node:assert/strict';
import test from 'node:test';

import {
  attachEditHelpers,
  detachItem,
  groupItems,
  moveItem,
  normalizeTracks,
  ungroupItem,
} from '../lib/tree-ops.js';

function item(id, at, duration, extra = {}) {
  return { id, at, duration, source: { kind: 'filter', filter: { type: 'invert' } }, ...extra };
}

function edit(tracks) {
  const value = { version: 2, output: { width: 640, height: 360, fps: 30 }, sources: [], tracks };
  attachEditHelpers(value);
  return value;
}

test('browser-safe tree-ops は重なる move に直上段を作り、空段を正規化する', () => {
  const value = edit([
    { id: 'v1', lane: 'visual', items: [item('a', 0, 30)] },
    { id: 'v2', lane: 'visual', items: [item('b', 0, 30)] },
  ]);
  moveItem(value, 'a', { track: 'v2' });
  assert.equal(value.tracks.length, 3);
  assert.equal(value.tracks[2].items[0].id, 'a');
  normalizeTracks(value);
  assert.deepEqual(value.tracks.map(track => track.id), ['v2', 'v3']);
});

test('写しの部品を出すと明示子・新しい段・part 名の exclude が同時に生える', () => {
  const value = edit([{ id: 'v1', lane: 'visual', items: [{
    id: 'bag', at: 10, duration: 60,
    source: { kind: 'html', path: 'overlays/bag.html', exclude: [] }, items: [],
  }] }]);
  const detached = detachItem(value, 'bag#B', { track: 'above' });
  assert.equal(detached.id, 'bag#B');
  assert.equal(detached.at, 10);
  assert.equal(detached.source.part, 'B');
  assert.deepEqual(value.find('bag').source.exclude, ['B']);
  assert.equal(value.tracks[1].items[0].id, 'bag#B');
});

test('group/ungroup は tree-ops 公開入口から親相対化と焼き込みを行う', () => {
  const value = edit([{ id: 'v1', lane: 'visual', items: [item('a', 10, 10), item('b', 20, 10)] }]);
  const grouped = groupItems(value, ['a', 'b']);
  assert.equal(grouped.group.source.kind, 'group');
  assert.deepEqual(grouped.group.items.map(child => child.at), [0, 10]);
  const children = ungroupItem(value, grouped.group.id);
  assert.deepEqual(children.map(child => child.at), [10, 20]);
});
