import assert from "node:assert/strict";
import test from "node:test";

import { matrixToEuler } from "./euler.mjs";

const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} != ${expected}`);

test("identity matrix は yaw/pitch/roll すべて 0", () => {
  assert.deepEqual(matrixToEuler([
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ]), { yaw: 0, pitch: 0, roll: 0 });
});

test("row-major Rz*Ry*Rx から yaw/pitch/roll を所定の符号で復元する", () => {
  const matrix = {
    rows: 4,
    columns: 4,
    data: [
      0.9362933635841992, -0.3129918257854679, 0.1593450793079779, 12,
      0.28962947762551555, 0.9447024859948941, 0.1537919979889642, -3,
      -0.19866933079506122, -0.09784339500725571, 0.9751703272018158, 7,
      0, 0, 0, 1,
    ],
  };
  const result = matrixToEuler(matrix);
  close(result.yaw, 0.2);
  close(result.pitch, -0.1);
  close(result.roll, 0.3);
});

test("同一行列の反復分解は byte-level で同じ数値 object を返す", () => {
  const matrix = [
    0.8660254037844387, 0, 0.5, 4,
    0, 1, 0, 5,
    -0.5, 0, 0.8660254037844387, 6,
    0, 0, 0, 1,
  ];
  const first = JSON.stringify(matrixToEuler(matrix));
  for (let index = 0; index < 100; index += 1) {
    assert.equal(JSON.stringify(matrixToEuler(matrix)), first);
  }
  close(matrixToEuler(matrix).yaw, Math.PI / 6);
});
