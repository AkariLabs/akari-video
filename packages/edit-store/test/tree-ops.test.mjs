import assert from 'node:assert/strict';
import test from 'node:test';

import {
  attachEditHelpers,
  collectExcludedCaptionIds,
  convertCaptionToTelop,
  detachItem,
  filterCaptionRootByExcludedIds,
  groupItems,
  materializeProjectedPart,
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

test('captions の写しは参照行と出力フレームを持つ明示子になる', () => {
  const value = edit([{ id: 'v1', lane: 'visual', items: [{
    id: 'captions-bag', at: 0, duration: 300,
    source: { kind: 'captions', path: 'captions.json' }, items: [],
  }] }]);
  const location = materializeProjectedPart(value, 'captions-bag#c-0001', { at: 42, duration: 18 });
  assert.deepEqual(location.item, {
    id: 'cap-c-0001', at: 42, duration: 18,
    source: { kind: 'caption', path: 'captions.json', id: 'c-0001' },
  });
});

test('captions の写しを出すと行 id を exclude へ積み、必ず新しい段へ置く', () => {
  const value = edit([{ id: 'v1', lane: 'visual', items: [{
    id: 'captions-bag', at: 0, duration: 300,
    source: { kind: 'captions', path: 'captions.json', exclude: [] }, items: [],
  }] }]);
  const detached = detachItem(value, 'captions-bag#c-0001', { track: 'above' }, { at: 42, duration: 18 });
  assert.equal(detached.id, 'cap-c-0001');
  assert.deepEqual(value.find('captions-bag').source.exclude, ['c-0001']);
  assert.equal(value.tracks.length, 2);
  assert.equal(value.tracks[1].items[0], detached);
});

test('captions の写しをテロップへ変換すると来歴・本文・exclude を保つ', () => {
  const value = edit([{ id: 'v1', lane: 'visual', items: [{
    id: 'captions-bag', at: 0, duration: 300,
    source: { kind: 'captions', path: 'captions.json', exclude: [] }, items: [],
  }] }]);
  const converted = convertCaptionToTelop(value, 'captions-bag#c-0002', {
    at: 69, duration: 48, text: '同じ文字をテロップにする'
  });
  assert.deepEqual(converted.source, {
    kind: 'telop', preset: 'ref3_particle_min',
    params: { text: '同じ文字をテロップにする' }, from: 'captions.json#c-0002'
  });
  assert.deepEqual(value.find('captions-bag').source.exclude, ['c-0002']);
  assert.equal('baked' in converted.source, false);
});

test('すでに出した caption は同じ段のまま telop へ置換する', () => {
  const value = edit([
    { id: 'v1', lane: 'visual', items: [{
      id: 'captions-bag', at: 0, duration: 300,
      source: { kind: 'captions', path: 'captions.json', exclude: ['c-0001'] }, items: [],
    }] },
    { id: 'v2', lane: 'visual', items: [{
      id: 'cap-c-0001', at: 42, duration: 18,
      source: { kind: 'caption', path: 'captions.json', id: 'c-0001' },
    }] },
  ]);
  const converted = convertCaptionToTelop(value, 'cap-c-0001', { text: '出した字幕' });
  assert.equal(value.tracks.length, 2);
  assert.equal(value.tracks[1].items[0], converted);
  assert.equal(converted.source.from, 'captions.json#c-0001');
  assert.deepEqual(value.find('captions-bag').source.exclude, ['c-0001']);
});

test('字幕除外は items / children を再帰し array / object root の形を保つ', () => {
  const excluded = collectExcludedCaptionIds({ tracks: [{ items: [{
    source: { kind: 'group' }, children: [{
      source: { kind: 'captions', exclude: ['c-1', 'c-2'] }, items: []
    }]
  }] }] });
  assert.deepEqual([...excluded], ['c-1', 'c-2']);
  const rows = [{ id: 'c-1' }, { id: 'c-3' }];
  assert.deepEqual(filterCaptionRootByExcludedIds(rows, excluded), [{ id: 'c-3' }]);
  assert.deepEqual(filterCaptionRootByExcludedIds({ captions: rows, default_text_style: { color: 'white' } }, excluded), {
    captions: [{ id: 'c-3' }], default_text_style: { color: 'white' }
  });
});

test('group/ungroup は tree-ops 公開入口から親相対化と焼き込みを行う', () => {
  const value = edit([{ id: 'v1', lane: 'visual', items: [item('a', 10, 10), item('b', 20, 10)] }]);
  const grouped = groupItems(value, ['a', 'b']);
  assert.equal(grouped.group.source.kind, 'group');
  assert.deepEqual(grouped.group.items.map(child => child.at), [0, 10]);
  const children = ungroupItem(value, grouped.group.id);
  assert.deepEqual(children.map(child => child.at), [10, 20]);
});
