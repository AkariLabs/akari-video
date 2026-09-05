import assert from 'node:assert/strict';
import test from 'node:test';

import { bakeAdjustLut } from '../dist/index.js';

function assertClose(actual, expected, tolerance = 1e-6) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
}

function channelRotationLut() {
  const size = 2;
  const data = new Float32Array(size * size * size * 3);
  for (let b = 0; b < size; b += 1) {
    for (let g = 0; g < size; g += 1) {
      for (let r = 0; r < size; r += 1) {
        const index = ((b * size + g) * size + r) * 3;
        data[index] = b;
        data[index + 1] = r;
        data[index + 2] = g;
      }
    }
  }
  return { size, domainMin: [0, 0, 0], domainMax: [1, 1, 1], data };
}

test('default bake is a 33-cubed R-fastest identity LUT', () => {
  const lut = bakeAdjustLut({});
  assert.equal(lut.size, 33);
  assert.equal(lut.data.length, 33 ** 3 * 3);
  assert.deepEqual([...lut.domainMin], [0, 0, 0]);
  assert.deepEqual([...lut.domainMax], [1, 1, 1]);

  const last = lut.size - 1;
  for (let b = 0; b < lut.size; b += 1) {
    for (let g = 0; g < lut.size; g += 1) {
      for (let r = 0; r < lut.size; r += 1) {
        const index = ((b * lut.size + g) * lut.size + r) * 3;
        assertClose(lut.data[index], r / last);
        assertClose(lut.data[index + 1], g / last);
        assertClose(lut.data[index + 2], b / last);
      }
    }
  }
});

test('user LUT samples the adjusted value and mixes at intensity 0.5', () => {
  const lut = bakeAdjustLut({ exposure: -1 }, channelRotationLut(), 0.5, 3);
  const index = ((2 * lut.size + 0) * lut.size + 1) * 3;
  // Grid [0.5, 0, 1] -> adjusted [0.25, 0, 0.5] -> LUT [0.5, 0.25, 0].
  assertClose(lut.data[index], 0.375);
  assertClose(lut.data[index + 1], 0.125);
  assertClose(lut.data[index + 2], 0.25);
});

test('the immediately repeated bake returns the same ParsedCubeLut reference', () => {
  const basic = { exposure: 0.25, saturation: -0.1 };
  const userLut = channelRotationLut();
  const first = bakeAdjustLut(basic, userLut, 0.75, 5);
  const second = bakeAdjustLut(basic, userLut, 0.75, 5);
  assert.strictEqual(second, first);
});
