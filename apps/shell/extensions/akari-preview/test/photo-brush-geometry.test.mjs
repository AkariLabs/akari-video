import assert from 'node:assert/strict';
import test from 'node:test';
import { photoBrushSourcePoint } from '../lib/browser/photo-brush-geometry.js';

test('flip and crop map a displayed point to the same source pixel', () => {
  const geometry = {
    output: { width: 4, height: 2 }, image: { width: 4, height: 2 },
    crop: { x: 0.25, y: 0, w: 0.5, h: 1 }, transform: { scale: 1 },
    flip: { h: true }
  };
  assert.deepEqual(photoBrushSourcePoint({ x: 1.5, y: 1 }, geometry), [0.625, 0.5]);
  assert.deepEqual(photoBrushSourcePoint({ x: 2.5, y: 1 }, geometry), [0.375, 0.5]);
  assert.equal(photoBrushSourcePoint({ x: 0, y: 1 }, geometry), null);
});
