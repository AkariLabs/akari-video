import assert from 'node:assert/strict';
import test from 'node:test';
import { interpolateKeyframes } from '../src/keyframes.mjs';
import { effectiveScale, composeTransforms } from '../src/parts.mjs';

test('mixed uniform and axis endpoints interpolate effective values', () => {
  const points = [{ t: 0, transform: { scale: 1 } }, { t: 10, transform: { scaleX: 2 } }];
  const state = interpolateKeyframes(points, 5);
  assert.equal(state.scaleX, 1.5); assert.equal(state.scaleY, 1);
  const reverse = interpolateKeyframes([{ t: 0, transform: { scaleX: 2 } }, { t: 10, transform: { scale: 4 } }], 5);
  assert.equal(reverse.scaleX, 3); assert.equal(reverse.scaleY, 2.5);
});
test('classic runtime helper copy and group composition retain effective scales', () => {
  assert.deepEqual(effectiveScale({ scale: 3, scaleY: 0.5 }), { x: 3, y: 0.5 });
  const value = composeTransforms({ scale: 2, rotate: 30 }, { scaleX: 1.5, scaleY: 0.75, rotate: 12 });
  assert.equal(value.scaleX, 3); assert.equal(value.scaleY, 1.5); assert.equal(value.rotate, 42);
});

test('axis path easing and static fallback are resolved before interpolation', () => {
  const points = [{ t: 0, transform: { scaleX: 2 } }, { t: 10, transform: { scaleX: 4 }, easing: { 'transform.scaleX': 'hold' } }];
  const state = interpolateKeyframes(points, 5, { statics: { scale: 3 } });
  assert.equal(state.scaleX, 2); assert.equal(state.scaleY, 3);
});
