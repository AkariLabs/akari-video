// three-runtime.js の data-akari-3d-anchor（3D 座標に追従する HTML 要素）を Node で検証する。
//
//   - "x,y,z" の 3 数値だけを受け付ける（空・2 個・4 個・非数値は拒否）
//   - origin の基準点（既定 center / 9 種類）と要素サイズからのオフセット
//   - 既知の view / projection 行列で既知の点が期待の画面座標になる
//   - カメラの後ろ・near/far の外・画面外は visible: false
//   - 遮蔽判定は far より手前の交差だけを数える
//   - 同じ入力は常に同じ結果（決定論）
//
// three-runtime.js はブラウザ IIFE なので、window だけ差して読み込み、公開した純関数を叩く。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = readFileSync(resolve(HERE, "../src/three-runtime.js"), "utf8");
const context = { window: {} };
runInNewContext(SOURCE, context, { filename: "three-runtime.js" });
const runtime = context.window.akari.threeRuntime;

// fov 90 / aspect 1 / near 0.1 / far 100 の透視投影（THREE.Matrix4.makePerspective と同じ列優先）。
const NEAR = 0.1;
const FAR = 100;
const projection = [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, -(FAR + NEAR) / (FAR - NEAR), -1,
  0, 0, (-2 * FAR * NEAR) / (FAR - NEAR), 0,
];
const identity = [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
];
const viewport = { cssWidth: 100, cssHeight: 80 };
const project = (point, view = identity, size = viewport) => {
  const result = runtime.projectAnchorPoint(point, view, projection, size);
  return { visible: result.visible, x: result.x, y: result.y, depth: result.depth };
};
const close = (actual, expected, epsilon = 1e-9) => Math.abs(actual - expected) <= epsilon;
const origin = (name, width, height) => {
  const result = runtime.anchorOriginOffset(name, width, height);
  return { x: result.x, y: result.y };
};

test("anchor: x,y,z の数値 3 個だけを受け付ける", () => {
  assert.deepEqual(Array.from(runtime.parseAnchorPoint("0,1.5,-2e1")), [0, 1.5, -20]);
  assert.deepEqual(Array.from(runtime.parseAnchorPoint(" 1 , 2 , 3 ")), [1, 2, 3]);
  for (const value of ["", "1,2", "1,2,3,4", "1,,3", "1,2,x", "NaN,0,0", "Infinity,0,0", "0x10,0,0"]) {
    assert.throws(() => runtime.parseAnchorPoint(value), /data-akari-3d-anchor/u, value);
  }
});

test("anchor: origin は既定 center、9 種類の基準点を要素サイズから引く", () => {
  assert.deepEqual(origin(undefined, 120, 40), { x: 60, y: 20 });
  assert.deepEqual(origin("center", 120, 40), { x: 60, y: 20 });
  assert.deepEqual(origin("top-left", 120, 40), { x: 0, y: 0 });
  assert.deepEqual(origin("top-right", 120, 40), { x: 120, y: 0 });
  assert.deepEqual(origin("bottom-left", 120, 40), { x: 0, y: 40 });
  assert.deepEqual(origin("bottom-right", 120, 40), { x: 120, y: 40 });
  assert.deepEqual(origin("top", 120, 40), { x: 60, y: 0 });
  assert.deepEqual(origin("left", 120, 40), { x: 0, y: 20 });
  assert.deepEqual(origin("right", 120, 40), { x: 120, y: 20 });
  assert.deepEqual(origin("bottom", 120, 40), { x: 60, y: 40 });
  assert.throws(() => runtime.anchorOriginOffset("middle", 120, 40), /data-akari-3d-anchor-origin/u);
});

test("anchor: 既知の投影で既知の点が期待の画面座標になる", () => {
  // 中心 (0,0,-5) は画面の中心。fov 90 なので z=-5 の半幅・半高は 5。
  assert.deepEqual(project([0, 0, -5]), { visible: true, x: 50, y: 40, depth: 5 });
  // x=0.5 -> ndc 0.1 -> 55px、y=0.5 -> ndc 0.1 -> 上へ 4px = 36px
  const offset = project([0.5, 0.5, -5]);
  assert.equal(offset.visible, true);
  assert.equal(close(offset.x, 55), true);
  assert.equal(close(offset.y, 36), true);
  // -x / -y は逆側
  const negative = project([-0.5, -0.5, -5]);
  assert.equal(negative.visible, true);
  assert.equal(close(negative.x, 45), true);
  assert.equal(close(negative.y, 44), true);
  // カメラを z=5 へ下げた view 行列（lookAt 原点・up +Y）でも同じ
  const viewBack5 = [...identity];
  viewBack5[14] = -5;
  const fromCamera = project([0, 0, 0], viewBack5);
  assert.equal(fromCamera.visible, true);
  assert.equal(close(fromCamera.x, 50), true);
  assert.equal(close(fromCamera.y, 40), true);
});

test("anchor: カメラの後ろ・near/far の外・画面外は隠す", () => {
  assert.equal(project([0, 0, 5]).visible, false, "カメラの後ろ（w <= 0）");
  assert.equal(project([0, 0, -0.05]).visible, false, "near より手前");
  assert.equal(project([0, 0, -200]).visible, false, "far より奥");
  assert.equal(project([10, 0, -5]).visible, false, "画面の右外");
  assert.equal(project([0, 10, -5]).visible, false, "画面の上外");
  assert.equal(project([0, 0, -5], identity, { cssWidth: 0, cssHeight: 0 }).visible, true);
});

test("anchor: 遮蔽は far より手前の交差だけを数える", () => {
  assert.equal(runtime.anchorOccluded([], 4), false);
  assert.equal(runtime.anchorOccluded([{ distance: 1 }, { distance: 3.9 }], 4), true);
  assert.equal(runtime.anchorOccluded([{ distance: 4.1 }], 4), false);
  assert.equal(runtime.anchorOccluded([{ distance: 0 }], 4), false);
  assert.equal(runtime.anchorOccluded(undefined, 4), false);
});

test("anchor: 同じ入力は常に同じ結果（決定論）", () => {
  const point = [0.3, -0.2, -3.2];
  for (let index = 0; index < 5; index += 1) {
    assert.deepEqual(project(point), project(point));
  }
});
