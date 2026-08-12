import assert from "node:assert/strict";
import test from "node:test";

import { resolveBlockPixels } from "../bin/face-mosaic/bake.mjs";
import { renderMaskFrame } from "../bin/face-mosaic/mask.mjs";

test("顔形 polygon の外は透明、内側は strength、feather は境界だけを軟化する", () => {
  const polygon = [[2, 2], [7, 2], [8, 5], [5, 8], [2, 5]];
  const hard = renderMaskFrame({ width: 10, height: 10, polygon, strength: 0.5, feather: 0 });
  assert.equal(hard[0], 0);
  assert.equal(hard[5 * 10 + 5], 128);
  const soft = renderMaskFrame({ width: 10, height: 10, polygon, strength: 1, feather: 2 });
  assert.ok(soft[2 * 10 + 2] > 0 && soft[2 * 10 + 2] < 255);
  assert.ok(soft[0] < soft[2 * 10 + 2]);
});

test("block-size は顔幅比と px 指定を別々に解決する", () => {
  assert.equal(resolveBlockPixels("0.08", 400), 32);
  assert.equal(resolveBlockPixels("18px", 400), 18);
  assert.throws(() => resolveBlockPixels("1px", 400), /2px/);
});
