import assert from "node:assert/strict";
import test from "node:test";

import { captureNonEmptyBitmap, readPaintBitmap } from "../src/paint-bitmap.mjs";

function image(width, height, bytes = width * height * 4) {
  return {
    getSize: () => ({ width, height }),
    toBitmap: () => Buffer.alloc(bytes),
  };
}

test("空 paint は settle 後に再取得して成功する", async () => {
  const frames = [image(0, 0, 0), image(2, 0, 0), image(4, 4)];
  let settles = 0;
  let emptyCallbacks = 0;
  const result = await captureNonEmptyBitmap({
    frame: 7, width: 4, height: 3,
    capture: async () => frames.shift(),
    settle: async () => { settles += 1; },
    onEmpty: () => { emptyCallbacks += 1; },
  });
  assert.equal(result.emptyAttempts, 2);
  assert.equal(result.bitmap.length, 64);
  assert.equal(settles, 2);
  assert.equal(emptyCallbacks, 2);
});

test("8 回連続の空 paint は明示エラーになる", async () => {
  let captures = 0;
  let empties = 0;
  await assert.rejects(() => captureNonEmptyBitmap({
    frame: 12, width: 4, height: 3,
    capture: async () => { captures += 1; return image(0, 0, 0); },
    settle: async () => {},
    onEmpty: () => { empties += 1; },
  }), /frame 12: offscreen paint returned an empty bitmap 8 times/);
  assert.equal(captures, 8);
  assert.equal(empties, 8);
});

test("空ではないサイズ不一致は requested / measured を含む文言で即失敗し、DPR 1 では device scale factor を案内しない", () => {
  assert.throws(() => readPaintBitmap(image(8, 8), 4, 3, 1), /^Error: frame 1 bitmap size 8x8, expected 4x4; requested 4x4, measured 8x8/u);
  assert.throws(() => readPaintBitmap(image(8, 8), 4, 3, 1), (error) => !/--force-device-scale-factor/u.test(error.message));
  assert.throws(() => readPaintBitmap(image(8, 8), 4, 3, 1, { devicePixelRatio: 2 }), /--force-device-scale-factor=1/u);
});

test("寸法が正しくても bitmap 長 0 は空 paint として扱う", () => {
  assert.equal(readPaintBitmap(image(4, 4, 0), 4, 3, 2).empty, true);
});
