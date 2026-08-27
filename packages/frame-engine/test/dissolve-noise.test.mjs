import assert from 'node:assert/strict';
import test from 'node:test';
import { dissolveNoiseField } from '../dist/index.js';

test('dissolve noise is deterministic, normalized, and stored in top-row order', () => {
  const first = dissolveNoiseField(4, 3);
  const second = dissolveNoiseField(4, 3);
  assert.deepEqual(first, second);
  assert.equal(first.length, 12);
  assert.equal(first[0], 0);
  assert.notDeepEqual([...first.slice(0, 4)], [...first.slice(4, 8)]);
  assert.equal(first.every(value => value >= 0 && value < 1), true);
});

test('dissolve noise rejects invalid dimensions', () => {
  assert.throws(() => dissolveNoiseField(0, 3), /positive integer/u);
  assert.throws(() => dissolveNoiseField(4, 1.5), /positive integer/u);
});
