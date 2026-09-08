import assert from 'node:assert/strict';
import test from 'node:test';
import { alphaContentRect } from '../lib/common/thumbnail-content-rect.js';

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
