import assert from 'node:assert/strict';
import test from 'node:test';

import {
  filterSupportedTransitionBoundaries,
  nearestTransitionBoundary,
  parseLibraryTransitionDragPayload,
  parseLibraryDragPayload,
  libraryAssetMaterialKind,
  libraryAssetGhostPayload,
  textPlaceOptions,
} from '../lib/browser/library-drop-model.js';

test('ライブラリの transition payload は正準語彙だけを受理する', () => {
  const cases = [
    {
      label: '正常',
      input: JSON.stringify({ kind: 'transition', id: 'wipe-left', name: 'ワイプ（左へ）' }),
      expected: { kind: 'transition', id: 'wipe-left', name: 'ワイプ（左へ）' },
    },
    {
      label: 'CustomEvent.detail の object も正常',
      input: { kind: 'transition', id: 'dissolve', name: 'ディゾルブ' },
      expected: { kind: 'transition', id: 'dissolve', name: 'ディゾルブ' },
    },
    {
      label: 'kind 違い',
      input: JSON.stringify({ kind: 'motion', id: 'wipe-left', name: 'ワイプ（左へ）' }),
      expected: undefined,
    },
    {
      label: '未知 transition id',
      input: JSON.stringify({ kind: 'transition', id: 'future-wipe', name: '未来ワイプ' }),
      expected: undefined,
    },
    { label: '壊れた JSON', input: '{"kind":"transition"', expected: undefined },
  ];

  for (const { label, input, expected } of cases) {
    assert.deepEqual(parseLibraryTransitionDragPayload(input), expected, label);
  }
});

test('見えている適用可能な境目から横の最近傍を選び、同距離なら左を選ぶ', () => {
  const candidates = [
    { earlierIndex: 4, laterIndex: 5, x: 180, applicable: true },
    { earlierIndex: 2, laterIndex: 3, x: 120, applicable: true },
    { earlierIndex: 1, laterIndex: 6, x: 140, applicable: false },
    { earlierIndex: 7, laterIndex: 8, x: 300, applicable: true },
  ];

  assert.deepEqual(nearestTransitionBoundary(175, candidates, 100, 200), candidates[0]);
  assert.deepEqual(nearestTransitionBoundary(150, candidates, 100, 200), candidates[1]);
  assert.deepEqual(nearestTransitionBoundary(290, candidates, 100, 200), candidates[0], '見えない境目は選ばない');
  assert.equal(nearestTransitionBoundary(150, candidates, 201, 250), undefined);
  assert.equal(nearestTransitionBoundary(140, [candidates[2]], 100, 200), undefined);
});

test('寄せた帯の上ではカット点が遠くてもその帯の境目を選ぶ', () => {
  const candidates = [
    { earlierIndex: 0, laterIndex: 1, x: 500, windowStartX: 500, windowEndX: 600, applicable: true },
    { earlierIndex: 1, laterIndex: 2, x: 600, applicable: true }
  ];
  assert.equal(nearestTransitionBoundary(580, candidates, 450, 650), candidates[0]);
  assert.equal(nearestTransitionBoundary(610, candidates, 450, 650), candidates[1]);
});

test('unsupported 集合に含まれる境界を適用候補から除外する', () => {
  const boundaries = [
    { earlierIndex: 0, laterIndex: 1, boundaryT: 3 },
    { earlierIndex: 2, laterIndex: 3, boundaryT: 8 },
    { earlierIndex: 4, laterIndex: 5, boundaryT: 12 },
  ];

  assert.deepEqual(
    filterSupportedTransitionBoundaries(boundaries, new Set([2, 4])),
    [boundaries[0]],
  );
});

for (const [category, kind] of [['audio', 'audio'], ['broll', 'video'], ['still', 'image']]) {
  test(`asset payload: ${category} を ${kind} の既定尺ゴーストへ変換`, () => {
    const payload = { kind: 'asset', key: `${category}/sample`, id: 'sample', category, title: '素材' };
    assert.equal(libraryAssetMaterialKind(category), kind);
    for (const input of [payload, JSON.stringify(payload)]) assert.deepEqual(parseLibraryDragPayload(input), payload);
    assert.deepEqual(libraryAssetGhostPayload(payload), { kind, relativePath: `library:${category}/sample`, name: '素材' });
  });
}

test('直和パーサは transition を引き続き受理する', () => {
  const payload = { kind: 'transition', id: 'dissolve', name: 'ディゾルブ' };
  assert.deepEqual(parseLibraryDragPayload(JSON.stringify(payload)), payload);
});

test('overlay payload を有効なキーだけ受理する', () => {
  const payload = { kind: 'overlay', key: 'overlay/lower-third-clean', id: 'lower-third-clean',
    category: 'overlay', title: 'テロップ' };
  assert.deepEqual(parseLibraryDragPayload(payload), payload);
  assert.deepEqual(parseLibraryDragPayload(JSON.stringify(payload)), payload);
  for (const invalid of [{ ...payload, key: '../bad' }, { ...payload, category: 'audio' },
    { ...payload, id: '' }, { ...payload, locked: true }]) {
    assert.equal(parseLibraryDragPayload(invalid), undefined);
  }
});

test('text と textstyle を分けて解析し、text はスタイル指定なしで配置する', () => {
  const textPayload = { kind: 'text' };
  const stylePayload = { kind: 'textstyle', id: 'telop-title' };
  for (const payload of [textPayload, stylePayload]) {
    assert.deepEqual(parseLibraryDragPayload(payload), payload);
    assert.deepEqual(parseLibraryDragPayload(JSON.stringify(payload)), payload);
  }
  assert.deepEqual(textPlaceOptions(6), { start: 6 });
  assert.equal(Object.hasOwn(textPlaceOptions(6), 'stylePreset'), false);
  for (const invalid of [{ kind: 'textstyle' }, { kind: 'textstyle', id: '' }, { kind: 'textstyle', id: 3 },
    { kind: 'unknown' }, '{']) {
    assert.equal(parseLibraryDragPayload(invalid), undefined);
  }
});

test('asset payload の未知 kind・対象外・locked・不正な必須値を拒否する', () => {
  const payload = { kind: 'asset', key: 'audio/sample', id: 'sample', category: 'audio', title: '素材' };
  const invalid = [null, [], 1, '{', { ...payload, kind: 'unknown' }, { ...payload, state: 'locked' },
    { ...payload, key: 'broll/sample' }, { ...payload, id: '' }, { ...payload, title: ' ' },
    { ...payload, key: 4 }, { ...payload, category: 'overlay' }, { ...payload, category: 'font' }];
  for (const input of invalid) assert.equal(parseLibraryDragPayload(input), undefined);
  for (const category of ['overlay', 'scene3d', 'font', 'pack', 'unknown']) assert.equal(libraryAssetMaterialKind(category), undefined);
});
