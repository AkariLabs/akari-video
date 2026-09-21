import assert from 'node:assert/strict';
import test from 'node:test';

import {
  filterSupportedTransitionBoundaries,
  hitTestTransitionBoundary,
  parseLibraryTransitionDragPayload,
  parseLibraryDragPayload,
  libraryAssetMaterialKind,
  libraryAssetGhostPayload,
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

test('ドロップ座標から許容距離内の最近傍境界を決定的に選ぶ', () => {
  const candidates = [
    { earlierIndex: 4, laterIndex: 5, x: 180, y: 60 },
    { earlierIndex: 2, laterIndex: 3, x: 120, y: 60 },
    { earlierIndex: 1, laterIndex: 6, x: 120, y: 140 },
  ];

  assert.deepEqual(hitTestTransitionBoundary({ x: 126, y: 62 }, candidates, 20), candidates[1]);
  assert.equal(hitTestTransitionBoundary({ x: 145, y: 60 }, candidates, 20), undefined);
  assert.deepEqual(
    hitTestTransitionBoundary({ x: 150, y: 60 }, candidates, 40),
    candidates[1],
    '同距離なら earlierIndex の小さい境界を選ぶ',
  );
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

test('asset payload の未知 kind・対象外・locked・不正な必須値を拒否する', () => {
  const payload = { kind: 'asset', key: 'audio/sample', id: 'sample', category: 'audio', title: '素材' };
  const invalid = [null, [], 1, '{', { ...payload, kind: 'unknown' }, { ...payload, state: 'locked' },
    { ...payload, key: 'broll/sample' }, { ...payload, id: '' }, { ...payload, title: ' ' },
    { ...payload, key: 4 }, { ...payload, category: 'overlay' }, { ...payload, category: 'font' }];
  for (const input of invalid) assert.equal(parseLibraryDragPayload(input), undefined);
  for (const category of ['overlay', 'scene3d', 'font', 'pack', 'unknown']) assert.equal(libraryAssetMaterialKind(category), undefined);
});
