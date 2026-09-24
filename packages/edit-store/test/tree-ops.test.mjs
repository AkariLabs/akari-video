import assert from 'node:assert/strict';
import test from 'node:test';
import { readEditV2 } from '../lib/edit-v2.js';
import { readInternalEdit } from '../lib/internal-model.js';

import {
  attachEditHelpers,
  absoluteAt,
  composeTransforms,
  collectExcludedCaptionIds,
  createCanvas,
  detachItem,
  filterCaptionRootByExcludedIds,
  groupItems,
  materializeProjectedPart,
  moveItem,
  locate,
  putIntoCanvas,
  putPlacedCaptionIntoCanvas,
  takeOutOfCanvas,
  updateItem,
  worldTransformOfAncestors,
  moveKeyframe,
  normalizeTracks,
  removeKeyframe,
  setKeyframe,
  setSegmentEasing,
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

test('人が選んだ複数 item は明示的なキャンバスになる', () => {
  const value = edit([{ id: 'v1', lane: 'visual', items: [item('a', 10, 10), item('b', 20, 10)] }]);
  const result = groupItems(value, ['a', 'b'], { canvas: true });
  assert.deepEqual(result.group.source.canvas, { origin: 'user', durationMode: 'fixed' });
  assert.equal(readEditV2(JSON.parse(JSON.stringify(value))).version, 2);
});

test('別々の段の同時刻 4 個も明示的なキャンバスへまとめられる', () => {
  const value = edit(Array.from({ length: 4 }, (_, index) => ({ id: `v${index}`, lane: 'visual',
    items: [item(`h${index}`, 750, 60)] })));
  const result = groupItems(value, ['h0', 'h1', 'h2', 'h3'], { canvas: true });
  assert.deepEqual(result.group.items.map(child => child.id), ['h0', 'h1', 'h2', 'h3']);
  assert.equal(result.group.at, 750);
  assert.equal(result.group.duration, 60);
});

test('空のキャンバスを作り、固定尺を縮めても子を変えない', () => {
  const value = edit([{ id: 'v1', lane: 'visual', items: [item('other', 300, 90)] }]);
  const canvas = createCanvas(value, { at: 300, duration: 150, intent: '導入', background: { type: 'color', color: '#142644' } });
  assert.deepEqual(canvas.items, []);
  assert.equal(value.tracks.length, 2);
  assert.equal(canvas.source.canvas.intent, '導入');
  assert.equal(readEditV2(JSON.parse(JSON.stringify(value))).tracks.length, 2);
  assert.equal(readInternalEdit(JSON.parse(JSON.stringify(value))).tracks.at(-1).items[0].declaration.name, 'キャンバス');
  const child = item('inside', 120, 30);
  canvas.items.push(child);
  updateItem(value, canvas.id, { duration: 90 });
  assert.equal(child.at, 120);
  assert.equal(child.duration, 30);
});

test('固定尺の外の字幕は読み取り時だけ描画窓を切り、元データは保つ', () => {
  const value = edit([{ id: 'v1', lane: 'visual', items: [{ id: 'g', at: 300, duration: 90,
    transform: { x: 40, scale: 2 }, opacity: 0.5,
    source: { kind: 'group', canvas: { origin: 'user', durationMode: 'fixed' } }, items: [
      { id: 'cap', at: 60, duration: 90, transform: { x: 5 }, opacity: 0.6,
        source: { kind: 'caption', path: 'captions.json', id: 'c-1' } }
    ] }] }]);
  const projected = readInternalEdit(JSON.parse(JSON.stringify(value)));
  const child = projected.tracks[0].items[0].children[0];
  assert.equal(child.atFrames, 360);
  assert.equal(child.durationFrames, 30);
  assert.equal(child.declaration.transform.x, 50);
  assert.equal(child.declaration.opacity, 0.3);
  assert.equal(value.find('cap').duration, 90);
});

test('入れ子のキャンバスへ出し入れしても絶対時刻・変形・不透明度を保つ', () => {
  const value = edit([{ id: 'v1', lane: 'visual', items: [
    { id: 'g1', at: 30, duration: 300, source: { kind: 'group' }, transform: { x: 100, scale: 2 }, opacity: 0.5,
      items: [item('leaf', 90, 30, { transform: { x: 10 }, opacity: 0.6 })] },
    { id: 'g2', at: 60, duration: 300, source: { kind: 'group' }, transform: { x: -20, scale: 2 }, opacity: 0.8,
      items: [{ id: 'inner', at: 0, duration: 300, source: { kind: 'group' }, transform: { x: 5 }, items: [] }] }
  ] }]);
  const before = locate(value, 'leaf');
  const world = composeTransforms(worldTransformOfAncestors(before.ancestors), before.item.transform);
  const at = absoluteAt(before);
  const opacity = before.ancestors.reduce((n, ancestor) => n * (ancestor.opacity ?? 1), before.item.opacity);
  putIntoCanvas(value, ['leaf'], 'inner');
  const inside = locate(value, 'leaf');
  assert.equal(absoluteAt(inside), at);
  assert.deepEqual(composeTransforms(worldTransformOfAncestors(inside.ancestors), inside.item.transform), world);
  assert.ok(Math.abs(inside.ancestors.reduce((n, ancestor) => n * (ancestor.opacity ?? 1), inside.item.opacity) - opacity) < 1e-9);
  takeOutOfCanvas(value, ['leaf']);
  const outside = locate(value, 'leaf');
  assert.equal(absoluteAt(outside), at);
  assert.deepEqual(outside.item.transform, world);
  assert.ok(Math.abs(outside.item.opacity - opacity) < 1e-9);
});

test('出し入れの前後で下地との重なり順を保つ', () => {
  const value = edit([
    { id: 'back', lane: 'visual', items: [item('backdrop', 300, 150)] },
    { id: 'front', lane: 'visual', items: [item('leaf', 330, 30)] },
    { id: 'canvas-track', lane: 'visual', items: [{ id: 'g', at: 300, duration: 150,
      source: { kind: 'group' }, items: [] }] }
  ]);
  const aboveBackdrop = () => locate(value, 'leaf').trackIndex > locate(value, 'backdrop').trackIndex;
  assert.equal(aboveBackdrop(), true);
  putIntoCanvas(value, ['leaf'], 'g');
  assert.equal(aboveBackdrop(), true);
  takeOutOfCanvas(value, ['leaf']);
  assert.equal(aboveBackdrop(), true);
});

test('変形の無い item を変形済みキャンバスへ入れても見た目を保つ', () => {
  const value = edit([
    { id: 'leaf-track', lane: 'visual', items: [item('leaf', 330, 30)] },
    { id: 'canvas-track', lane: 'visual', items: [{ id: 'g', at: 300, duration: 150,
      transform: { x: 40, scale: 2 }, source: { kind: 'group' }, items: [] }] }
  ]);
  putIntoCanvas(value, ['leaf'], 'g');
  const location = locate(value, 'leaf');
  assert.equal(absoluteAt(location), 330);
  assert.deepEqual(composeTransforms(worldTransformOfAncestors(location.ancestors), location.item.transform),
    { x: 0, y: 0, scale: 1 });
});

test('置いた字幕をキャンバスへ入れると元の投影だけを除外する', () => {
  const value = edit([{ id: 'v1', lane: 'visual', items: [
    { id: 'g', at: 300, duration: 150, source: { kind: 'group' }, items: [] }
  ] }]);
  const child = putPlacedCaptionIntoCanvas(value, { id: 'c-1', at: 330, duration: 45 }, 'g');
  assert.equal(readEditV2(JSON.parse(JSON.stringify(value))).tracks.length, 2);
  assert.equal(child.at, 30);
  assert.equal(child.source.id, 'c-1');
  assert.deepEqual([...collectExcludedCaptionIds(value)], ['c-1']);
  assert.deepEqual(filterCaptionRootByExcludedIds([{ id: 'c-1' }, { id: 'c-2' }], collectExcludedCaptionIds(value)), [{ id: 'c-2' }]);
  takeOutOfCanvas(value, [child.id]);
  assert.equal(locate(value, child.id).item.at, 330);
  assert.deepEqual([...collectExcludedCaptionIds(value)], ['c-1']);
});

test('最初のキーフレームは両端 2 点になり、同じ時刻への set は値を更新する', () => {
  const value = edit([{ id: 'v1', lane: 'visual', items: [item('a', 0, 30, { transform: { x: 12 } })] }]);
  setKeyframe(value, 'a', 'transform.x', 0, 12);
  assert.deepEqual(value.find('a').keyframes, [
    { t: 0, transform: { x: 12 } }, { t: 30, transform: { x: 12 } }
  ]);
  setKeyframe(value, 'a', 'transform.x', 30, 40);
  assert.deepEqual(value.find('a').keyframes.map(point => [point.t, point.transform.x]), [[0, 12], [30, 40]]);
});

test('点の移動は整数・範囲・単調性を守り、既存時刻へはプロパティをマージする', () => {
  const value = edit([{ id: 'v1', lane: 'visual', items: [item('a', 0, 30, {
    keyframes: [{ t: 0, transform: { x: 0 }, opacity: 0 }, { t: 15, opacity: 0.5 }, { t: 30, transform: { x: 30 }, opacity: 1 }]
  })] }]);
  moveKeyframe(value, 'a', 'transform.x', 30, 15);
  assert.deepEqual(value.find('a').keyframes.map(point => point.t), [0, 15, 30]);
  assert.equal(value.find('a').keyframes[1].transform.x, 30);
  assert.throws(() => moveKeyframe(value, 'a', 'transform.x', 15, 31), /0〜30/);
  assert.throws(() => moveKeyframe(value, 'a', 'transform.x', 15, 2.5), /整数フレーム/);
});

test('削除で 2 点未満になる場合は keyframes 全体を外す', () => {
  const value = edit([{ id: 'v1', lane: 'visual', items: [item('a', 0, 30, {
    keyframes: [{ t: 0, opacity: 0 }, { t: 30, opacity: 1 }]
  })] }]);
  removeKeyframe(value, 'a', 'opacity', 30);
  assert.equal(value.find('a').keyframes, undefined);
});

test('区間 easing は終点へ載り、複数プロパティでは property map を保つ', () => {
  const value = edit([{ id: 'v1', lane: 'visual', items: [item('a', 0, 30, {
    keyframes: [
      { t: 0, transform: { x: 0 }, opacity: 0 },
      { t: 30, transform: { x: 30 }, opacity: 1, easing: 'linear' }
    ]
  })] }]);
  setSegmentEasing(value, 'a', 'transform.x', 30, 'ease-in-out');
  assert.deepEqual(value.find('a').keyframes[1].easing, {
    'transform.x': 'ease-in-out', opacity: 'linear'
  });
  assert.throws(() => setSegmentEasing(value, 'a', 'opacity', 0, 'hold'), /区間/);
});

test('参照形は hydrate 前の編集を拒む', () => {
  const value = edit([{ id: 'v1', lane: 'visual', items: [item('a', 0, 30, {
    keyframes: { path: 'motion/a.json', count: 9 }
  })] }]);
  assert.throws(() => setKeyframe(value, 'a', 'opacity', 0, 0), /inline/);
});
