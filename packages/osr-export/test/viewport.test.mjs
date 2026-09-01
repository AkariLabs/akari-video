import assert from "node:assert/strict";
import test from "node:test";

import {
  bitmapSizeMismatchMessage,
  deviceEmulationParameters,
  osrPageSize,
  readPaintBitmap,
  viewportMatches,
  viewportRecord,
} from "../src/paint-bitmap.mjs";
import { buildOsrReceipt, normalizeOsrViewport } from "../src/receipt.mjs";

// 本機実測（Windows 11 / 物理 1920×1080 / タスクバーありの作業領域 1920×1032）
const display = { width: 1920, height: 1080 };
const workArea = { width: 1920, height: 1032 };

function image(width, height, bytes = width * height * 4) {
  return { getSize: () => ({ width, height }), toBitmap: () => Buffer.alloc(bytes) };
}

test("作業領域に収まる窓（1280×721）は一致で、viewport 記録は emulated false・work_area 付き", () => {
  const requested = osrPageSize(1280, 720);
  assert.deepEqual(requested, { width: 1280, height: 721 });
  const measured = { width: 1280, height: 721, devicePixelRatio: 1 };
  assert.equal(viewportMatches(requested, measured), true);
  assert.deepEqual(viewportRecord({ requested, measured, emulated: false, display, workArea }), {
    requested: { width: 1280, height: 721 },
    measured: { width: 1280, height: 721 },
    emulated: false,
    display: { width: 1920, height: 1080 },
    work_area: { width: 1920, height: 1032 },
  });
});

test("作業領域に切り詰められた窓（1920×1081 → 1920×1032）は不一致で、emulation は要求寸法・DPR 1 を指定する", () => {
  const requested = osrPageSize(1920, 1080);
  assert.equal(viewportMatches(requested, { width: 1920, height: 1032, devicePixelRatio: 1 }), false);
  assert.equal(viewportMatches(osrPageSize(3840, 2160), { width: 1920, height: 1032, devicePixelRatio: 1 }), false);
  assert.deepEqual(deviceEmulationParameters(requested), {
    screenPosition: "desktop",
    screenSize: { width: 1920, height: 1081 },
    viewPosition: { x: 0, y: 0 },
    viewSize: { width: 1920, height: 1081 },
    deviceScaleFactor: 1,
    scale: 1,
  });
  assert.deepEqual(viewportRecord({
    requested, measured: { width: 1920, height: 1081, devicePixelRatio: 1 }, emulated: true, display, workArea,
  }), {
    requested: { width: 1920, height: 1081 },
    measured: { width: 1920, height: 1081 },
    emulated: true,
    display: { width: 1920, height: 1080 },
    work_area: { width: 1920, height: 1032 },
  });
});

test("失敗メッセージは requested / measured / primary display / work area を含み、DPR 1 では --force-device-scale-factor を案内しない", () => {
  const message = bitmapSizeMismatchMessage({
    frame: 0,
    requested: osrPageSize(1920, 1080),
    measured: { width: 1920, height: 1032 },
    display,
    workArea,
    devicePixelRatio: 1,
    resized: true,
    emulated: true,
  });
  assert.match(message, /^frame 0 bitmap size 1920x1032, expected 1920x1081; /u);
  assert.match(message, /requested 1920x1081/u);
  assert.match(message, /measured 1920x1032/u);
  assert.match(message, /primary display 1920x1080/u);
  assert.match(message, /work area 1920x1032/u);
  assert.match(message, /setContentSize 適用 \/ device emulation 適用/u);
  assert.doesNotMatch(message, /--force-device-scale-factor/u);
  // readPaintBitmap は settle 結果（run.json と同形 + devicePixelRatio / resized）を受けて同じ文言で投げる
  assert.throws(
    () => readPaintBitmap(image(1920, 1032), 1920, 1080, 0, {
      requested: { width: 1920, height: 1081 }, measured: { width: 1920, height: 1032 }, emulated: true,
      display, work_area: workArea, devicePixelRatio: 1, resized: true,
    }),
    (error) => { assert.equal(error.message, message); return true; },
  );
});

test("DPR ≠ 1 のときだけ --force-device-scale-factor=1 の案内が付く（viewport 情報なしは DPR 不明として付けない）", () => {
  const withDpr = bitmapSizeMismatchMessage({
    frame: 3, requested: osrPageSize(1920, 1080), measured: { width: 3840, height: 2162 }, display, workArea, devicePixelRatio: 2,
  });
  assert.match(withDpr, /requested 1920x1081, measured 3840x2162, primary display 1920x1080, work area 1920x1032/u);
  assert.match(withDpr, /devicePixelRatio 2 — Electron の実プロセスへ --force-device-scale-factor=1 を渡してください$/u);
  assert.throws(
    () => readPaintBitmap(image(3840, 2162), 1920, 1080, 3, { display, work_area: workArea, devicePixelRatio: 2 }),
    /--force-device-scale-factor=1/u,
  );
  assert.throws(
    () => readPaintBitmap(image(8, 8), 4, 3, 1),
    (error) => {
      assert.match(error.message, /^frame 1 bitmap size 8x8, expected 4x4; requested 4x4, measured 8x8, primary display unknown, work area unknown; /u);
      assert.match(error.message, /setContentSize 未適用 \/ device emulation 未適用/u);
      assert.doesNotMatch(error.message, /--force-device-scale-factor/u);
      return true;
    },
  );
});

test("receipt は viewport を snake_case（work_area）で正規化し、欠損・不正値は null にする", () => {
  const viewport = viewportRecord({
    requested: osrPageSize(1920, 1080), measured: { width: 1920, height: 1081, devicePixelRatio: 1 }, emulated: false, display, workArea,
  });
  const receipt = buildOsrReceipt({ tier: 2, viewport });
  assert.deepEqual(receipt.viewport, {
    requested: { width: 1920, height: 1081 },
    measured: { width: 1920, height: 1081 },
    emulated: false,
    display: { width: 1920, height: 1080 },
    work_area: { width: 1920, height: 1032 },
  });
  assert.deepEqual(Object.keys(receipt.viewport), ["requested", "measured", "emulated", "display", "work_area"]);
  assert.equal(receipt.provenance.engine, "osr");
  assert.equal(buildOsrReceipt({ tier: 2 }).viewport, null);
  assert.equal(buildOsrReceipt({ tier: 2, viewport: { ...viewport, measured: null } }).viewport, null);
  assert.equal(normalizeOsrViewport({ ...viewport, emulated: "yes" }), null);
  assert.equal(normalizeOsrViewport({ ...viewport, work_area: { width: 1920, height: NaN } }), null);
  assert.equal(normalizeOsrViewport("1920x1081"), null);
  // camelCase の workArea も受ける（正規化後は work_area）
  const { work_area: _dropped, ...camel } = viewport;
  assert.deepEqual(normalizeOsrViewport({ ...camel, workArea }).work_area, { width: 1920, height: 1032 });
});
