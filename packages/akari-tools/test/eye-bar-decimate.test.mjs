import assert from "node:assert/strict";
import test from "node:test";

import { decimateByInterval, decimateByThreshold, decimatePoints } from "../src/eye-bar/decimate.mjs";

function pt(t, x = 0, y = 0, rotate = 0, scale = 1, boundary = false) {
  return { t, x, y, rotate, scale, boundary };
}

test("decimateByInterval: 常に先頭・末尾を残す", () => {
  const points = [pt(0), pt(0.05), pt(0.1), pt(0.15), pt(0.2)];
  const out = decimateByInterval(points, 1); // interval が大きすぎて全部間引かれても先頭末尾は残る
  assert.equal(out[0].t, 0);
  assert.equal(out[out.length - 1].t, 0.2);
});

test("decimateByInterval: interval 秒未満の間隔は間引かれる", () => {
  const points = [pt(0), pt(0.05), pt(0.1), pt(0.3), pt(0.5)];
  const out = decimateByInterval(points, 0.2);
  // 0 → (0.05,0.1 は間引かれる) → 0.3(0からの累積差0.3>=0.2) → 0.5
  assert.deepEqual(out.map((p) => p.t), [0, 0.3, 0.5]);
});

test("decimateByInterval: boundary フラグの点は間隔に関係なく残す", () => {
  const points = [pt(0), pt(0.01, 0, 0, 0, 1, true), pt(0.02), pt(1)];
  const out = decimateByInterval(points, 0.5);
  assert.ok(out.some((p) => p.t === 0.01));
});

test("decimateByThreshold: 変化が閾値未満なら間引かれる", () => {
  const points = [pt(0, 0), pt(1, 0.5), pt(2, 1), pt(3, 50), pt(4, 50.1)];
  const out = decimateByThreshold(points, { posPx: 10, angleDeg: 999, scaleRatio: 999 });
  // 0→0.5→1 は差分小さいので間引かれ、3(50) は大きく変化したので残る、末尾は常に残る
  assert.deepEqual(out.map((p) => p.t), [0, 3, 4]);
});

test("decimateByThreshold: 角度閾値超えで残す", () => {
  const points = [pt(0, 0, 0, 0), pt(1, 0, 0, 1), pt(2, 0, 0, 10), pt(3, 0, 0, 10.5)];
  const out = decimateByThreshold(points, { posPx: 999, angleDeg: 5, scaleRatio: 999 });
  assert.deepEqual(out.map((p) => p.t), [0, 2, 3]);
});

test("decimatePoints: mode 切り替え", () => {
  const points = [pt(0), pt(0.05), pt(0.5)];
  const byInterval = decimatePoints(points, { mode: "interval", intervalSeconds: 0.2 });
  const byThreshold = decimatePoints(points, { mode: "threshold", threshold: { posPx: 1, angleDeg: 1, scaleRatio: 1 } });
  assert.ok(Array.isArray(byInterval));
  assert.ok(Array.isArray(byThreshold));
});

test("decimateByInterval/Threshold: 2 点以下はそのまま", () => {
  const points = [pt(0), pt(1)];
  assert.deepEqual(decimateByInterval(points, 0.01), points);
  assert.deepEqual(decimateByThreshold(points, {}), points);
});
