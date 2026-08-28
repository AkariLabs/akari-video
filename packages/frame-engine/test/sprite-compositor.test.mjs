import assert from "node:assert/strict";
import test from "node:test";

import { normalizeSpriteDraw, spriteTransformMatrix } from "../dist/exits/sprite-compositor.js";

test("sprite draw defaults and clamps opacity", () => {
  assert.deepEqual(normalizeSpriteDraw({ id: "caption", opacity: 2 }), {
    id: "caption", opacity: 1, translateX: 0, translateY: 0, scaleX: 1, scaleY: 1, rotateDeg: 0,
  });
});

test("sprite transform maps pixels to clip space and flips y translation", () => {
  const value = [...spriteTransformMatrix({ id: "x", opacity: 1, translateX: 10, translateY: 20 }, 100, 200)];
  assert.ok(Math.abs(value[6] - 0.2) < 1e-6);
  assert.ok(Math.abs(value[7] + 0.2) < 1e-6);
});

test("sprite helpers reject invalid input", () => {
  assert.throws(() => normalizeSpriteDraw({ id: "", opacity: 1 }), /non-empty/);
  assert.throws(() => spriteTransformMatrix({ id: "x", opacity: 1 }, 0, 1), /positive/);
});
