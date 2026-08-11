import assert from "node:assert/strict";
import test from "node:test";

import { movingAverage, oneEuroFilter, smoothSeries, unwrapDegrees } from "../src/eye-bar/smoothing.mjs";

test("unwrapDegrees: ±180 境界のジャンプを連続値へ展開する", () => {
  const wrapped = [170, 179, -179, -170]; // 実際には +10, +9, +8 度ずつ回っている想定
  const unwrapped = unwrapDegrees(wrapped);
  assert.equal(unwrapped[0], 170);
  assert.equal(unwrapped[1], 179);
  assert.ok(Math.abs(unwrapped[2] - 181) < 1e-9);
  assert.ok(Math.abs(unwrapped[3] - 190) < 1e-9);
});

test("unwrapDegrees: 変化が小さければそのまま", () => {
  const values = [0, 5, 10, 8, 3];
  assert.deepEqual(unwrapDegrees(values), values);
});

test("movingAverage: window=1 は恒等", () => {
  const values = [1, 5, 2, 9];
  assert.deepEqual(movingAverage(values, 1), values);
});

test("movingAverage: 一定値列は平滑化しても不変", () => {
  const values = [5, 5, 5, 5, 5];
  assert.deepEqual(movingAverage(values, 3), values);
});

test("movingAverage: window=3 の中心平均（境界ははみ出さない範囲で平均）", () => {
  const values = [0, 10, 0, 10, 0];
  const out = movingAverage(values, 3);
  // 中心（index2）は [10,0,10] の平均 = 6.666...
  assert.ok(Math.abs(out[2] - (10 + 0 + 10) / 3) < 1e-9);
  // 先頭（index0）は window が [0,10] の 2 点だけ（はみ出さない）
  assert.ok(Math.abs(out[0] - (0 + 10) / 2) < 1e-9);
});

test("movingAverage: 決定論（同一入力→同一出力）", () => {
  const values = [3, 1, 4, 1, 5, 9, 2, 6];
  assert.deepEqual(movingAverage(values, 5), movingAverage(values, 5));
});

test("oneEuroFilter: 一定値列は平滑化しても不変", () => {
  const values = [5, 5, 5, 5, 5];
  const times = [0, 0.1, 0.2, 0.3, 0.4];
  const out = oneEuroFilter(values, times);
  for (const v of out) assert.ok(Math.abs(v - 5) < 1e-9);
});

test("oneEuroFilter: 決定論（同一引数→同一出力・乱数や時計に依存しない）", () => {
  const values = [0, 1, 0, 1, 0, 1, 0];
  const times = values.map((_, i) => i * (1 / 24));
  const a = oneEuroFilter(values, times, { minCutoff: 1, beta: 0.1 });
  const b = oneEuroFilter(values, times, { minCutoff: 1, beta: 0.1 });
  assert.deepEqual(a, b);
  // 平滑化により振動の振幅が元の 0..1 より小さくなっているはず
  assert.ok(Math.max(...a.slice(1)) < 1);
});

test("smoothSeries: method=none はそのまま返す", () => {
  const values = [1, 2, 3];
  assert.deepEqual(smoothSeries(values, [0, 1, 2], { method: "none" }), values);
});
