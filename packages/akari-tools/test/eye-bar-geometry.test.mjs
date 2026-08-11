import assert from "node:assert/strict";
import test from "node:test";

import { applyCutTransformToGeometry, barLayerTransform, eyeGeometryFromCanvasPoints } from "../src/eye-bar/geometry.mjs";
import { applyCutTransformToPoint, containFitRect, mapNormalizedPointToCanvas } from "../src/eye-bar/space-map.mjs";

test("containFitRect: 16:9 ソースを 16:9 キャンバスへ（余白なし・等倍）", () => {
  const fit = containFitRect(1920, 1080, 1920, 1080);
  assert.equal(fit.scale, 1);
  assert.equal(fit.x, 0);
  assert.equal(fit.y, 0);
});

test("containFitRect: 4:3 ソースを 16:9 キャンバスへ（左右レターボックス）", () => {
  // 1280x960(4:3) を 1920x1080(16:9) へ contain: scale = min(1920/1280, 1080/960) = min(1.5, 1.125) = 1.125
  const fit = containFitRect(1280, 960, 1920, 1080);
  assert.equal(fit.scale, 1.125);
  assert.equal(fit.width, 1440);
  assert.equal(fit.height, 1080);
  assert.equal(fit.y, 0);
  assert.equal(fit.x, (1920 - 1440) / 2);
});

test("mapNormalizedPointToCanvas: 正規化中心 (0.5,0.5) はキャンバス中心へ写る", () => {
  const point = mapNormalizedPointToCanvas([0.5, 0.5], { width: 1280, height: 960 }, { width: 1920, height: 1080 });
  assert.ok(Math.abs(point.x - 960) < 1e-9);
  assert.ok(Math.abs(point.y - 540) < 1e-9);
});

test("applyCutTransformToPoint: 実測済み回転規約（正の角度 = 画面上で時計回り）", () => {
  // packages/render-cut/src/layers.mjs / cut-transform.mjs と同じ rotate= 規約。
  // 200x200 キャンバス中心の真上 (100,20) の点を +45° 回すと、実測 (156.2,42.8) 付近
  // （report.md の ffmpeg 実測ログと同じシナリオ・同じ数値）。
  const result = applyCutTransformToPoint(100, 20, 200, 200, { rotate: 45 });
  assert.ok(Math.abs(result.x - 156.57) < 0.1, `x=${result.x}`);
  assert.ok(Math.abs(result.y - 43.43) < 0.1, `y=${result.y}`);
});

test("eyeGeometryFromCanvasPoints: 水平な両瞳は angle=0", () => {
  const geom = eyeGeometryFromCanvasPoints({ x: 100, y: 200 }, { x: 300, y: 200 });
  assert.equal(geom.centerX, 200);
  assert.equal(geom.centerY, 200);
  assert.equal(geom.angleDeg, 0);
  assert.equal(geom.lengthPx, 200);
});

test("eyeGeometryFromCanvasPoints: 右目が下がっている（首を左に傾けた見た目）は正の角度", () => {
  // atan2(dy,dx) 規約: 右目 y が左目より大きい（画面下）→ dy>0 → 正の角度（時計回り）
  const geom = eyeGeometryFromCanvasPoints({ x: 100, y: 200 }, { x: 300, y: 300 });
  assert.ok(geom.angleDeg > 0);
  assert.ok(Math.abs(geom.angleDeg - (Math.atan2(100, 200) * 180) / Math.PI) < 1e-9);
});

test("barLayerTransform: scale は瞳間距離×margin をネイティブ幅で割った値", () => {
  const geometry = { centerX: 960, centerY: 540, angleDeg: 0, lengthPx: 200 };
  const transform = barLayerTransform(geometry, { nativeBarWidthPx: 800, marginMultiplier: 2, canvasWidth: 1920, canvasHeight: 1080 });
  assert.equal(transform.scale, (200 * 2) / 800);
  assert.equal(transform.x, 960 - 1920 / 2);
  assert.equal(transform.y, 540 - 1080 / 2);
  assert.equal(transform.rotate, 0);
});

test("applyCutTransformToGeometry: cut.transform 無しは恒等", () => {
  const geometry = { centerX: 1, centerY: 2, angleDeg: 3, lengthPx: 4 };
  const result = applyCutTransformToGeometry(geometry, applyCutTransformToPoint, null);
  assert.deepEqual(result, geometry);
});

test("applyCutTransformToGeometry: rotate は加算・scale は乗算・center は点変換", () => {
  const geometry = { centerX: 960, centerY: 540, angleDeg: 10, lengthPx: 100 };
  const result = applyCutTransformToGeometry(
    geometry,
    (px, py, canvasW, canvasH, t) => applyCutTransformToPoint(px, py, 1920, 1080, t),
    { scale: 2, rotate: 5, x: 0, y: 0 },
  );
  assert.equal(result.angleDeg, 15);
  assert.equal(result.lengthPx, 200);
  // center はキャンバス中心そのものなので、回転・スケールしても中心のまま
  assert.ok(Math.abs(result.centerX - 960) < 1e-9);
  assert.ok(Math.abs(result.centerY - 540) < 1e-9);
});
