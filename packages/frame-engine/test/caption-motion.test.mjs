import assert from "node:assert/strict";
import test from "node:test";

import { CAPTION_SPRITE_MOTIONS, captionMotionAt, cubicBezierAt, isCaptionMotionSupported } from "../dist/timeline/caption-motion.js";

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

test("in and out slots apply with forwards fill and no backwards fill", () => {
  const declaration = { in: { id: "fade-in-out", duration_sec: 0.2 }, out: { id: "fade-in-out", duration_sec: 0.2 } };
  assert.equal(captionMotionAt(declaration, 0, 1, 40).opacity, 0);
  assert.equal(captionMotionAt(declaration, 0.5, 1, 40).opacity, 1);
  assert.ok(captionMotionAt(declaration, 1, 1, 40).opacity < 1e-12);
});

test("later slots override only the CSS properties they animate", () => {
  const fadeFloat = { in: { id: "fade-up" }, loop: { id: "float", duration_sec: 2 } };
  const state = captionMotionAt(fadeFloat, 0.3, 3, 20);
  assert.ok(state.opacity > 0 && state.opacity < 1);
  assert.ok(state.translateY < 0); // float owns transform, fade-up still owns opacity
  const popBreath = { in: { id: "pop" }, loop: { id: "breath", duration_sec: 2 } };
  assert.equal(captionMotionAt(popBreath, 0, 3, 20).opacity, 1);
  assert.equal(captionMotionAt(popBreath, 0, 3, 20).scaleX, 1);
  const withOut = { ...fadeFloat, out: { id: "slide-left", duration_sec: 0.6 } };
  assert.equal(captionMotionAt(withOut, 2, 3, 20).translateX, 0);
  assert.ok(captionMotionAt(withOut, 2.7, 3, 20).translateX > 0);
});

test("missing endpoint properties interpolate from the underlying animation", () => {
  CAPTION_SPRITE_MOTIONS["test-endpoint"] = {
    keyframes: [{ at: 0 }, { at: 1, opacity: 0, xEm: 1 }],
  };
  try {
    const base = captionMotionAt({ in: { id: "fade-up" } }, 0.3, 3, 20);
    const layered = captionMotionAt({ in: { id: "fade-up" }, loop: { id: "test-endpoint", duration_sec: 2 } }, 0.3, 3, 20);
    assert.ok(Math.abs(layered.opacity - base.opacity * 0.85) < 1e-8);
    assert.ok(Math.abs(layered.translateY - base.translateY * 0.85) < 1e-8);
    assert.ok(Math.abs(layered.translateX - 20 * 0.15) < 1e-8);
  } finally {
    delete CAPTION_SPRITE_MOTIONS["test-endpoint"];
  }
});

test("bounce out skips its transform-only 75% keyframe for opacity", () => {
  const declaration = {
    loop: { id: "breath", duration_sec: 1.6 },
    out: { id: "bounce", duration_sec: 0.6 },
  };
  // Reverse progress crosses the transform-only 75% keyframe. Opacity spans
  // 55% to 100%, both equal to 1, on either side of that keyframe.
  for (const time of [2.49, 2.61]) {
    const actual = captionMotionAt(declaration, time, 3, 20);
    const outOnly = captionMotionAt({ out: declaration.out }, time, 3, 20);
    assert.equal(actual.opacity, 1);
    assert.equal(actual.translateY, outOnly.translateY);
  }
});

test("each property skips unrelated interior keyframes before local easing", () => {
  CAPTION_SPRITE_MOTIONS["test-sparse"] = {
    keyframes: [
      { at: 0, opacity: 0, xEm: 0 },
      { at: 0.25, opacity: 0.2 },
      { at: 0.5, xEm: 0.5 },
      { at: 1, opacity: 1, xEm: 1 },
    ],
  };
  try {
    const actual = captionMotionAt({ in: { id: "test-sparse", duration_sec: 0.6 } }, 0.375, 3, 20);
    const opacityEase = cubicBezierAt(0.5, 0, 0, 0.58, 1); // (0.625 - 0.25) / (1 - 0.25)
    const transformEase = cubicBezierAt(0.25, 0, 0, 0.58, 1); // (0.625 - 0.5) / (1 - 0.5)
    assert.ok(Math.abs(actual.opacity - (0.2 + 0.8 * opacityEase)) < 1e-8);
    assert.ok(Math.abs(actual.translateX - (10 + 10 * transformEase)) < 1e-8);
    const beforeTransformKeyframe = captionMotionAt({ in: { id: "test-sparse", duration_sec: 0.6 } }, 0.225, 3, 20);
    assert.ok(Math.abs(beforeTransformKeyframe.translateX - 10 * cubicBezierAt(0.75, 0, 0, 0.58, 1)) < 1e-8);
  } finally {
    delete CAPTION_SPRITE_MOTIONS["test-sparse"];
  }
});

test("easing is applied within each keyframe interval, including reverse", () => {
  const declaration = { in: { id: "drop-in", duration_sec: 1 }, out: { id: "drop-in", duration_sec: 1 } };
  const eased = cubicBezierAt(0.5, 0, 0, 0.58, 1);
  const first = captionMotionAt(declaration, 0.35, 3, 10);
  assert.ok(Math.abs(first.translateY - (-16 + (1.2 + 16) * eased)) < 1e-6);
  const reverse = captionMotionAt(declaration, 2.15, 3, 10); // directed progress .85, interval .7..1
  assert.ok(Math.abs(reverse.translateY - (1.2 * (1 - eased))) < 1e-6);
  assert.deepEqual(captionMotionAt(declaration, 2.15, 3, 10), reverse);
});

test("amp follows the CSS recipe rather than scaling every keyframe value", () => {
  assert.equal(captionMotionAt({ in: { id: "pop", amp: 0.5 } }, 0, 1, 20).scaleX, 0.5);
  assert.equal(captionMotionAt({ in: { id: "rotate-in", amp: 0.5 } }, 0, 1, 20).scaleX, 0.9);
  assert.equal(captionMotionAt({ in: { id: "rotate-in", amp: 0.5 } }, 0, 1, 20).rotateDeg, -6);
  assert.equal(captionMotionAt({ in: { id: "zoom-pop", amp: 0.5 } }, 0, 1, 20).scaleX, 0.4);
  assert.equal(captionMotionAt({ in: { id: "zoom-pop", amp: 0.5 } }, 0.42, 1, 20).scaleX, 1.06);
  // The plate has one custom property. Its first declared amp also affects later slots.
  assert.equal(captionMotionAt({ in: { id: "fade-in-out", amp: 0.5 }, loop: { id: "float" } }, 0.4, 3, 20).translateY, -1.1);
});

test("percentage translations use the plate box and ignore amp", () => {
  const start = captionMotionAt({ in: { id: "news-ticker", amp: 0.5 } }, 0, 2, 20, 310, 80);
  assert.equal(start.translateX, 310);
  const end = captionMotionAt({ in: { id: "crawl-up", amp: 0.5 } }, 1, 2, 20, 310, 80);
  assert.equal(end.translateY, -80);
});

test("loop motion is periodic", () => {
  const declaration = { loop: { id: "float", duration_sec: 1.6 } };
  const first = captionMotionAt(declaration, 0.4, 5, 40);
  const next = captionMotionAt(declaration, 2, 5, 40);
  assert.ok(Math.abs(first.translateY - next.translateY) < 1e-12);
  assert.ok(Math.abs(first.translateY - (-0.11 * 40)) < 1e-12);
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
