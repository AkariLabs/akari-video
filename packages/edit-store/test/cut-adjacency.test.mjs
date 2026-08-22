import assert from 'node:assert/strict';
import test from 'node:test';

import { areCutsAdjacent } from '../lib/cut-adjacency.js';

test('フレーム量子化したギャップ 0 は隣接', () => {
  assert.equal(areCutsAdjacent({ tlEnd: 5 }, { tlStart: 5 }, 30), true);
});

test('1 フレームのギャップは非隣接', () => {
  assert.equal(areCutsAdjacent({ tlEnd: 5 }, { tlStart: 5 + 1 / 30 }, 30), false);
});

test('宣言済み duration 内の重なりは隣接', () => {
  assert.equal(areCutsAdjacent(
    { tlEnd: 5, transitionOut: { duration: 0.5 } },
    { tlStart: 4.5 },
    30
  ), true);
});

test('宣言済み duration を超える重なりは非隣接', () => {
  assert.equal(areCutsAdjacent(
    { tlEnd: 5, transitionOut: { duration: 0.5 } },
    { tlStart: 4.4 },
    30
  ), false);
});

test('後クリップが前クリップの内側へ大きく逆順に食い込んだ形は非隣接', () => {
  assert.equal(areCutsAdjacent(
    { tlEnd: 10, transitionOut: { duration: 0.5 } },
    { tlStart: 2 },
    30
  ), false);
});

test('fps 未指定・不正値は 30fps にフォールバックする', () => {
  const earlier = { tlEnd: 5 };
  const subFrameGap = { tlStart: 5.01 };
  const oneFrameGap = { tlStart: 5 + 1 / 30 };
  assert.equal(areCutsAdjacent(earlier, subFrameGap), true);
  for (const invalidFps of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(areCutsAdjacent(earlier, subFrameGap, invalidFps), true);
    assert.equal(areCutsAdjacent(earlier, oneFrameGap, invalidFps), false);
  }
});

test('正の有限数でない transition duration は重なりを許可しない', () => {
  for (const duration of [0, -0.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(areCutsAdjacent(
      { tlEnd: 5, transitionOut: { duration } },
      { tlStart: 4.9 },
      30
    ), false);
  }
});
