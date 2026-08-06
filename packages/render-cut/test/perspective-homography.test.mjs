import assert from "node:assert/strict";
import test from "node:test";

import {
  applyHomography,
  cornersToHomography,
  computePerspectiveFfmpegCorners,
  PERSPECTIVE_PAD_FRAC,
} from "../src/perspective-homography.mjs";

function closeTo(actual, expected, epsilon = 1e-6) {
  assert.ok(Math.abs(actual - expected) <= epsilon, `expected ${actual} to be within ${epsilon} of ${expected}`);
}

function closePoint(actual, expected, epsilon = 1e-6) {
  closeTo(actual[0], expected[0], epsilon);
  closeTo(actual[1], expected[1], epsilon);
}

test("cornersToHomography: identity corners (no crop) reproduce the unit square exactly", () => {
  const corners = [
    [0, 0],
    [1, 0],
    [0, 1],
    [1, 1],
  ];
  const matrix = cornersToHomography(corners);
  closePoint(applyHomography(matrix, 0, 0), [0, 0]);
  closePoint(applyHomography(matrix, 1, 0), [1, 0]);
  closePoint(applyHomography(matrix, 0, 1), [0, 1]);
  closePoint(applyHomography(matrix, 1, 1), [1, 1]);
  closePoint(applyHomography(matrix, 0.5, 0.5), [0.5, 0.5]);
});

test("cornersToHomography: the 4 declared corners always map exactly (reference-point check)", () => {
  const corners = [
    [0.1, 0],
    [0.9, 0],
    [0, 1],
    [1, 1],
  ];
  const matrix = cornersToHomography(corners);
  closePoint(applyHomography(matrix, 0, 0), corners[0]); // TL
  closePoint(applyHomography(matrix, 1, 0), corners[1]); // TR
  closePoint(applyHomography(matrix, 0, 1), corners[2]); // BL
  closePoint(applyHomography(matrix, 1, 1), corners[3]); // BR
});

test("cornersToHomography: an asymmetric quad (all 4 corners distinct) still maps exactly", () => {
  const corners = [
    [0.15, 0.05],
    [0.8, 0.1],
    [0.05, 0.9],
    [0.95, 0.85],
  ];
  const matrix = cornersToHomography(corners);
  closePoint(applyHomography(matrix, 0, 0), corners[0]);
  closePoint(applyHomography(matrix, 1, 0), corners[1]);
  closePoint(applyHomography(matrix, 0, 1), corners[2]);
  closePoint(applyHomography(matrix, 1, 1), corners[3]);
});

test("cornersToHomography: a parallelogram target (affine case, dx3=dy3=0) has zero projective term", () => {
  // TL/TR/BL/BR forming a plain parallelogram (here: an axis-aligned rectangle shrunk uniformly)
  // is an affine map -- Heckbert's a13/a23 should both be exactly 0, not just numerically tiny.
  const corners = [
    [0.1, 0.1],
    [0.9, 0.1],
    [0.1, 0.9],
    [0.9, 0.9],
  ];
  const matrix = cornersToHomography(corners);
  closeTo(matrix.a13, 0);
  closeTo(matrix.a23, 0);
  closePoint(applyHomography(matrix, 0.5, 0.5), [0.5, 0.5]);
});

test("computePerspectiveFfmpegCorners: a uniform inset (pure affine scale-down) keeps the padded frame's own corners inside the padded canvas", () => {
  // A *uniform* inset on all 4 sides is a pure affine scale-down (no projective term -- see the
  // parallelogram test above), so the padded frame's own corners scale down proportionally too
  // and stay within the padded canvas. This is the counterpoint to the asymmetric-trapezoid case
  // below: only a genuinely non-uniform (trapezoidal) warp pushes the padded frame's corners
  // outside [0,1], since that's what requires "room" for the transparent margin to be visible.
  const corners = [
    [0.2, 0.2],
    [0.8, 0.2],
    [0.2, 0.8],
    [0.8, 0.8],
  ];
  const dest = computePerspectiveFfmpegCorners(corners, PERSPECTIVE_PAD_FRAC);
  for (const [x, y] of dest) {
    assert.ok(x >= 0 && x <= 1 && y >= 0 && y <= 1, `expected ${[x, y]} to stay within the padded canvas for a uniform inset`);
  }
});

test("computePerspectiveFfmpegCorners: an asymmetric trapezoid pushes the padded frame's own corners outside the padded canvas on the narrowed edge", () => {
  // Asymmetric (non-uniform) warps are exactly the case padding exists for: the padded frame's
  // own corners on the narrowed side must extrapolate outside [0,1] in the destination, which is
  // precisely what makes ffmpeg's out-of-bounds clamp-to-edge sampling read the (guaranteed
  // transparent) padding ring instead of opaque content for that region.
  const corners = [
    [0.3, 0.1],
    [0.7, 0.1],
    [0.1, 0.9],
    [0.9, 0.9],
  ];
  const dest = computePerspectiveFfmpegCorners(corners, PERSPECTIVE_PAD_FRAC);
  const [, , bl, br] = dest;
  assert.ok(bl[0] < 0, `BL ${bl} should extrapolate left of the padded canvas`);
  assert.ok(br[0] > 1, `BR ${br} should extrapolate right of the padded canvas`);
});

test("computePerspectiveFfmpegCorners: identity corners (full box, no warp) keep the padded frame's own corners exactly at the padding ring", () => {
  const corners = [
    [0, 0],
    [1, 0],
    [0, 1],
    [1, 1],
  ];
  const padFrac = PERSPECTIVE_PAD_FRAC;
  const dest = computePerspectiveFfmpegCorners(corners, padFrac);
  const denom = 1 + 2 * padFrac;
  const expectedTL = [0, 0]; // (padFrac + (-padFrac)) / denom = 0
  const expectedBR = [(padFrac + 1 + padFrac) / denom, (padFrac + 1 + padFrac) / denom]; // = 1
  closePoint(dest[0], expectedTL);
  closePoint(dest[3], expectedBR);
});

test("computePerspectiveFfmpegCorners: reproduces the values independently verified against a real ffmpeg render", () => {
  // Regression pin for the exact numbers a real `ffmpeg -vf pad,perspective,crop` invocation was
  // measured against pixel-for-pixel during implementation (padFrac=0.5, corners TL=(0.1,0)
  // TR=(0.9,0) BL=(0,1) BR=(1,1) -- a top-narrowed trapezoid). See layers.test.mjs's real-render
  // acceptance test for the pixel-level confirmation; this pins the upstream math that feeds it.
  const corners = [
    [0.1, 0],
    [0.9, 0],
    [0, 1],
    [1, 1],
  ];
  const dest = computePerspectiveFfmpegCorners(corners, 0.5);
  closePoint(dest[0], [0.13636363636363635, 0.06818181818181818]);
  closePoint(dest[1], [0.8636363636363638, 0.06818181818181818]);
  closePoint(dest[2], [-0.07142857142857145, 1.1071428571428572]);
  closePoint(dest[3], [1.0714285714285716, 1.1071428571428572]);
});
