import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  filterQuadCornersAt,
  rasterizeQuadMaskFrame,
  writeFilterMaskFile,
} from "../src/filter-mask.mjs";

const cornersA = [[0.1, 0.2], [0.3, 0.2], [0.1, 0.6], [0.3, 0.6]];
const cornersB = [[0.6, 0.2], [0.8, 0.2], [0.6, 0.6], [0.8, 0.6]];

function whitePixelCount(frame) {
  let count = 0;
  for (const value of frame) if (value === 255) count += 1;
  return count;
}

function withTempDir(callback) {
  const dir = mkdtempSync(join(tmpdir(), "akari-filter-mask-"));
  try {
    return callback(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
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

test("writeFilterMaskFile is deterministic and writes the declared raw frame count", () => {
  withTempDir((dir) => {
    const layer = {
      perspective: { corners: cornersA },
      keyframes: [
        { t: 0, perspective: { corners: cornersA } },
        { t: 1, perspective: { corners: cornersB } },
      ],
    };
    const common = {
      layer,
      layerT: 2,
      windowStartT: 2,
      windowDuration: 0.5,
      fps: 10,
      width: 40,
      height: 20,
    };
    const firstPath = join(dir, "one", "mask.gray");
    const secondPath = join(dir, "two", "mask.gray");
    const first = writeFilterMaskFile({ ...common, outputPath: firstPath });
    const second = writeFilterMaskFile({ ...common, outputPath: secondPath });
    assert.deepEqual(first, { path: firstPath, width: 20, height: 10, frameCount: 5, fps: 10 });
    assert.equal(statSync(firstPath).size, 20 * 10 * 5);
    assert.deepEqual(readFileSync(secondPath), readFileSync(firstPath));
    assert.equal(second.frameCount, 5);
  });
});

test("a moving quad mask has a different white-pixel centroid on every adjacent frame", () => {
  withTempDir((dir) => {
    const outputPath = join(dir, "moving.gray");
    const info = writeFilterMaskFile({
      layer: {
        perspective: { corners: cornersA },
        keyframes: [
          { t: 0, perspective: { corners: cornersA } },
          { t: 1, perspective: { corners: cornersB } },
        ],
      },
      layerT: 0,
      windowStartT: 0,
      windowDuration: 1,
      fps: 30,
      width: 200,
      height: 100,
      outputPath,
      scale: 1,
    });
    const bytes = readFileSync(outputPath);
    const frameSize = info.width * info.height;
    const centroids = [];
    for (let frameIndex = 0; frameIndex < info.frameCount; frameIndex += 1) {
      let sumX = 0;
      let count = 0;
      const start = frameIndex * frameSize;
      for (let offset = 0; offset < frameSize; offset += 1) {
        if (bytes[start + offset] !== 255) continue;
        sumX += offset % info.width;
        count += 1;
      }
      assert.ok(count > 0);
      centroids.push(sumX / count);
    }
    assert.equal(centroids.length, 30);
    for (let index = 1; index < centroids.length; index += 1) {
      assert.notEqual(centroids[index], centroids[index - 1]);
    }
  });
});
