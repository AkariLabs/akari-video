import assert from 'node:assert/strict';
import test from 'node:test';
import { alphaContentRect, thumbnailCropRect } from '../lib/common/thumbnail-content-rect.js';

const bitmap = (width, height, points) => {
  const pixels = new Uint8Array(width * height * 4);
  for (const [x, y, alpha = 255] of points) pixels[(y * width + x) * 4 + 3] = alpha;
  return pixels;
};

test('fully transparent pixels have no content rectangle', () => {
  assert.equal(alphaContentRect(new Uint8Array(48), 4, 3), undefined);
});

test('one visible pixel has inclusive one-pixel dimensions', () => {
  assert.deepEqual(alphaContentRect(bitmap(4, 3, [[2, 1]]), 4, 3), { x: 2, y: 1, width: 1, height: 1 });
});

test('bounds include the top-left and bottom-right edges', () => {
  assert.deepEqual(alphaContentRect(bitmap(4, 3, [[0, 0], [1, 1]]), 4, 3), { x: 0, y: 0, width: 2, height: 2 });
  assert.deepEqual(alphaContentRect(bitmap(4, 3, [[2, 1], [3, 2]]), 4, 3), { x: 2, y: 1, width: 2, height: 2 });
  assert.deepEqual(alphaContentRect(bitmap(4, 3, [[0, 0], [3, 2]]), 4, 3), { x: 0, y: 0, width: 4, height: 3 });
});

test('only BGRA alpha strictly above the threshold counts', () => {
  const pixels = new Uint8Array([255, 255, 255, 0, 255, 255, 255, 8, 0, 0, 0, 9]);
  assert.deepEqual(alphaContentRect(pixels, 3, 1), { x: 2, y: 0, width: 1, height: 1 });
  assert.equal(alphaContentRect(pixels, 3, 1, 9), undefined);
  assert.deepEqual(alphaContentRect(pixels, 3, 1, 7), { x: 1, y: 0, width: 2, height: 1 });
});

test('invalid dimensions and truncated buffers have no rectangle', () => {
  for (const [width, height] of [[0, 1], [1, 0], [-1, 2], [Infinity, 1], [1.5, 1], [NaN, 1], [2, 2]]) {
    assert.equal(alphaContentRect(new Uint8Array(4), width, height), undefined);
  }
});

const page = { width: 480, height: 270 };
const lowerThird = { x: 12, y: 212, width: 218, height: 29 };
const assertContainedCrop = (crop, rect) => {
  assert.ok(crop);
  assert.ok(Object.values(crop).every(Number.isInteger));
  assert.ok(crop.width >= 1 && crop.height >= 1);
  assert.ok(crop.x >= 0 && crop.y >= 0);
  assert.ok(crop.x + crop.width <= page.width && crop.y + crop.height <= page.height);
  assert.ok(crop.x <= rect.x && crop.y <= rect.y);
  assert.ok(crop.x + crop.width >= rect.x + rect.width);
  assert.ok(crop.y + crop.height >= rect.y + rect.height);
};

test('full-screen content and exactly sixty percent coverage keep the original framing', () => {
  for (const height of [270, 200, 162]) {
    assert.equal(thumbnailCropRect({ x: 0, y: 0, width: 480, height }, page), undefined);
  }
  assert.ok(thumbnailCropRect({ x: 0, y: 0, width: 480, height: 161 }, page));
});

test('lower-third crop rounds outward and contains all original content inside the page', () => {
  const crop = thumbnailCropRect(lowerThird, page);
  assert.deepEqual(crop, { x: 3, y: 210, width: 236, height: 33 });
  assertContainedCrop(crop, lowerThird);
});

test('padding clamps to each page edge without losing content', () => {
  for (const rect of [
    { x: 0, y: 0, width: 40, height: 20 },
    { x: 440, y: 250, width: 40, height: 20 },
    { x: 0, y: 250, width: 40, height: 20 },
    { x: 440, y: 0, width: 40, height: 20 }
  ]) assertContainedCrop(thumbnailCropRect(rect, page), rect);
});

test('missing, non-finite, non-positive and out-of-page inputs have no crop', () => {
  assert.equal(thumbnailCropRect(undefined, page), undefined);
  for (const key of ['x', 'y', 'width', 'height']) {
    for (const value of [NaN, Infinity, -Infinity]) {
      assert.equal(thumbnailCropRect({ ...lowerThird, [key]: value }, page), undefined);
    }
  }
  for (const key of ['width', 'height']) {
    for (const value of [0, -1]) {
      assert.equal(thumbnailCropRect({ ...lowerThird, [key]: value }, page), undefined);
    }
    for (const value of [0, -1, NaN, Infinity, -Infinity]) {
      assert.equal(thumbnailCropRect(lowerThird, { ...page, [key]: value }), undefined);
    }
  }
  for (const change of [{ x: -1 }, { y: -1 }, { x: 480 }, { y: 270 }, { width: 480 }, { height: 270 }]) {
    assert.equal(thumbnailCropRect({ ...lowerThird, ...change }, page), undefined);
  }
});

test('coverage and padding options control whether and how content is cropped', () => {
  assert.deepEqual(thumbnailCropRect(lowerThird, page, { pad: 0 }), lowerThird);
  assert.equal(thumbnailCropRect(lowerThird, page, { minCoverage: 0.01 }), undefined);
  assert.deepEqual(thumbnailCropRect(lowerThird, page, { pad: 0.1 }), { x: 0, y: 209, width: 252, height: 35 });
});

test('padding that reaches the entire page leaves the original framing', () => {
  assert.equal(thumbnailCropRect({ x: 120, y: 90, width: 240, height: 90 }, page, { pad: 1 }), undefined);
});

test('subpixel content rounds outward to at least one pixel', () => {
  const rect = { x: 12.25, y: 20.25, width: 0.25, height: 0.25 };
  const crop = thumbnailCropRect(rect, page, { pad: 0 });
  assert.deepEqual(crop, { x: 12, y: 20, width: 1, height: 1 });
  assertContainedCrop(crop, rect);
});
