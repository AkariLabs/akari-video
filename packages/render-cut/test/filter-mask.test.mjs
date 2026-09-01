import assert from "node:assert/strict";
import test from "node:test";

import {
  filterQuadCornersAt,
  rasterizeQuadMaskFrame,
} from "../src/filter-mask.mjs";

const cornersA = [[0.1, 0.2], [0.3, 0.2], [0.1, 0.6], [0.3, 0.6]];
const cornersB = [[0.6, 0.2], [0.8, 0.2], [0.6, 0.6], [0.8, 0.6]];

function whitePixelCount(frame) {
  let count = 0;
  for (const value of frame) if (value === 255) count += 1;
  return count;
}

test("filterQuadCornersAt falls back to the static perspective without keyframes", () => {
  const layer = { perspective: { corners: cornersA } };
  assert.equal(filterQuadCornersAt(layer, 123), cornersA);
});

test("filterQuadCornersAt treats one usable perspective keyframe as constant", () => {
  const layer = {
    perspective: { corners: cornersA },
    keyframes: [
      { t: -1, perspective: { corners: cornersA } },
      { t: 2, perspective: { corners: cornersB } },
      { t: 3, perspective: { corners: [[0, 0]] } },
    ],
  };
  assert.equal(filterQuadCornersAt(layer, -100), cornersB);
  assert.equal(filterQuadCornersAt(layer, 100), cornersB);
});

test("filterQuadCornersAt linearly interpolates every corner coordinate", () => {
  const layer = {
    perspective: { corners: cornersA },
    keyframes: [
      { t: 1, perspective: { corners: cornersA }, easing: "ease-in-out" },
      { t: 3, perspective: { corners: cornersB }, easing: "ease-in-out" },
    ],
  };
  assert.deepEqual(filterQuadCornersAt(layer, 2), [
    [0.35, 0.2], [0.55, 0.2], [0.35, 0.6], [0.55, 0.6],
  ]);
});

test("filterQuadCornersAt holds before the first and after the last keyframe", () => {
  const layer = {
    perspective: { corners: cornersA },
    keyframes: [
      { t: 1, perspective: { corners: cornersA } },
      { t: 3, perspective: { corners: cornersB } },
    ],
  };
  assert.equal(filterQuadCornersAt(layer, 0), cornersA);
  assert.equal(filterQuadCornersAt(layer, 4), cornersB);
});

test("rasterizeQuadMaskFrame fills an axis-aligned rectangle exactly", () => {
  const frame = rasterizeQuadMaskFrame([
    [0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75],
  ], 8, 8);
  assert.equal(whitePixelCount(frame), 16);
});

test("rasterizeQuadMaskFrame handles concave and bowtie quads", () => {
  const concave = rasterizeQuadMaskFrame([
    [0.1, 0.1], [0.9, 0.1], [0.1, 0.9], [0.5, 0.5],
  ], 40, 40);
  const bowtie = rasterizeQuadMaskFrame([
    [0.1, 0.1], [0.9, 0.9], [0.1, 0.9], [0.9, 0.1],
  ], 40, 40);
  assert.ok(whitePixelCount(concave) > 0);
  assert.ok(whitePixelCount(bowtie) > 0);
});

test("rasterizeQuadMaskFrame clips an off-canvas quad to the frame", () => {
  const frame = rasterizeQuadMaskFrame([
    [-0.5, 0.25], [1.5, 0.25], [-0.5, 0.75], [1.5, 0.75],
  ], 8, 8);
  assert.equal(whitePixelCount(frame), 32);
  assert.equal(frame[3 * 8], 255);
  assert.equal(frame[0], 0);
});
