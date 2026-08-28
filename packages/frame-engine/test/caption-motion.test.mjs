import assert from "node:assert/strict";
import test from "node:test";

import { captionMotionAt, cubicBezierAt, isCaptionMotionSupported } from "../dist/timeline/caption-motion.js";

test("default caption fade reaches the settled state", () => {
  const start = captionMotionAt(null, 0, 1, 100);
  const middle = captionMotionAt(null, 0.09, 1, 100);
  const end = captionMotionAt(null, 0.18, 1, 100);
  const later = captionMotionAt(null, 0.9, 1, 100);
  assert.deepEqual(start, { opacity: 0, translateX: 0, translateY: 18, scaleX: 1, scaleY: 1, rotateDeg: 0 });
  assert.ok(middle.opacity > 0 && middle.opacity < 1);
  assert.ok(middle.translateY > 0 && middle.translateY < 18);
  assert.equal(end.opacity, 1);
  assert.equal(end.translateY, 0);
  assert.deepEqual(later, end);
});

test("in and out slots multiply", () => {
  const declaration = { in: { id: "fade-in-out", duration_sec: 0.2 }, out: { id: "fade-in-out", duration_sec: 0.2 } };
  assert.equal(captionMotionAt(declaration, 0, 1, 40).opacity, 0);
  assert.equal(captionMotionAt(declaration, 0.5, 1, 40).opacity, 1);
  assert.ok(captionMotionAt(declaration, 1, 1, 40).opacity < 1e-12);
});

test("loop motion is periodic", () => {
  const declaration = { loop: { id: "float", duration_sec: 1.6 } };
  const first = captionMotionAt(declaration, 0.4, 5, 40);
  const next = captionMotionAt(declaration, 2, 5, 40);
  assert.ok(Math.abs(first.translateY - next.translateY) < 1e-12);
});

test("unsupported and unknown motions are reported", () => {
  assert.deepEqual(isCaptionMotionSupported({ in: { id: "wipe-left" }, out: { id: "future" } }), {
    supported: false, unsupported: ["wipe-left", "future"],
  });
});

test("amp scales distance", () => {
  const normal = captionMotionAt({ in: { id: "slide-left", amp: 1 } }, 0, 1, 20);
  const half = captionMotionAt({ in: { id: "slide-left", amp: 0.5 } }, 0, 1, 20);
  assert.equal(half.translateX, normal.translateX / 2);
});

test("ease-out is monotonic", () => {
  let previous = 0;
  for (let index = 0; index <= 100; index += 1) {
    const value = cubicBezierAt(index / 100, 0, 0, 0.58, 1);
    assert.ok(value + 1e-12 >= previous);
    previous = value;
  }
});
