import assert from "node:assert/strict";
import test from "node:test";

import { computeCutBoundaries } from "../lib/common/cut-boundaries.js";

test("同一トラックで隣り合う2件は1境界を返す（中点 = 境界時刻）", () => {
  const segments = [
    { index: 0, track: 0, tlStart: 0, tlEnd: 5 },
    { index: 1, track: 0, tlStart: 5, tlEnd: 10 }
  ];
  const boundaries = computeCutBoundaries(segments);
  assert.equal(boundaries.length, 1);
  assert.deepEqual(boundaries[0], {
    earlierIndex: 0, laterIndex: 1, track: 0, boundaryT: 5, transitionOut: undefined
  });
});

test("transitionOut は前方（earlier）のセグメントから引き継がれる", () => {
  const segments = [
    { index: 0, track: 0, tlStart: 0, tlEnd: 5, transitionOut: { type: "dissolve", duration: 0.5 } },
    { index: 1, track: 0, tlStart: 4.5, tlEnd: 9.5 }
  ];
  const boundaries = computeCutBoundaries(segments);
  assert.equal(boundaries.length, 1);
  assert.equal(boundaries[0].boundaryT, 4.75);
  assert.deepEqual(boundaries[0].transitionOut, { type: "dissolve", duration: 0.5 });
});

test("異なるトラックの間には境界を作らない（トラック単位で独立に隣接判定）", () => {
  const segments = [
    { index: 0, track: 0, tlStart: 0, tlEnd: 5 },
    { index: 1, track: 1, tlStart: 0, tlEnd: 5 },
    { index: 2, track: 0, tlStart: 5, tlEnd: 8 }
  ];
  const boundaries = computeCutBoundaries(segments);
  assert.equal(boundaries.length, 1);
  assert.deepEqual([boundaries[0].earlierIndex, boundaries[0].laterIndex], [0, 2]);
});

test("同一トラックで3件連続なら2境界（cuts配列順で1件ずつペア化）", () => {
  const segments = [
    { index: 0, track: 0, tlStart: 0, tlEnd: 3 },
    { index: 1, track: 0, tlStart: 3, tlEnd: 6 },
    { index: 2, track: 0, tlStart: 6, tlEnd: 9 }
  ];
  const boundaries = computeCutBoundaries(segments);
  assert.equal(boundaries.length, 2);
  assert.deepEqual(boundaries.map(b => [b.earlierIndex, b.laterIndex]), [[0, 1], [1, 2]]);
});

test("単独カット・空配列は境界0件", () => {
  assert.deepEqual(computeCutBoundaries([]), []);
  assert.deepEqual(computeCutBoundaries([{ index: 0, track: 0, tlStart: 0, tlEnd: 5 }]), []);
});

test("戻り値は earlierIndex 昇順で決定的（トラック処理順に依存しない）", () => {
  const segments = [
    { index: 0, track: 1, tlStart: 0, tlEnd: 4 },
    { index: 1, track: 0, tlStart: 0, tlEnd: 4 },
    { index: 2, track: 1, tlStart: 4, tlEnd: 8 },
    { index: 3, track: 0, tlStart: 4, tlEnd: 8 }
  ];
  const boundaries = computeCutBoundaries(segments);
  assert.deepEqual(boundaries.map(b => b.earlierIndex), [0, 1]);
});
