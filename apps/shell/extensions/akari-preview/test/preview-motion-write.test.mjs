import assert from 'node:assert/strict';
import test from 'node:test';
import { withPreviewPosition } from '../lib/common/preview-motion-write.js';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { evaluateItemMotion, dragItemMotionPosition } = require('../../../../../packages/overlay-runtime/src/item-motion.js');

test('live layer move follows the pointer and changes only X/Y at the current point', () => {
  const item = { id: 'photo', t: 0, duration: 4, transform: { x: -200, y: 0, scale: .25, rotate: 0 },
    keyframes: [{ t: 0, transform: { x: -200 } }, { t: 4, transform: { x: 200 } }],
    motion: { in: { preset: 'slide-up', duration: 30, amount: 100 } } };
  const summary = { output: { fps: 30 }, layers: [item] };
  const motionItem = { ...item, at: 0, fps: 30, keyframeUnit: 'seconds' };
  const start = evaluateItemMotion(motionItem, .5);
  const drag = dragItemMotionPosition(motionItem, .5, [], start, 80, 0);
  const updated = withPreviewPosition(summary, { kind: 'layer', id: 'photo' }, drag.base, .5);
  const visible = evaluateItemMotion({ ...updated.layers[0], at: 0, fps: 30, keyframeUnit: 'seconds' }, .5);
  assert.equal(visible.x, start.x + 80);
  assert.equal(visible.y, start.y);
  assert.deepEqual(updated.layers[0].keyframes[1], { t: .5, transform: drag.base });
  assert.deepEqual(updated.layers[0].keyframes[0], item.keyframes[0]);
  assert.deepEqual(updated.layers[0].keyframes[2], item.keyframes[1]);
  assert.deepEqual(updated.layers[0].transform, item.transform);
});

test('live cut move preserves the scale keyframes while adding a position point', () => {
  const cut = { id: 'cut', at: 2, transform: { x: 0, y: 0, scale: .25, rotate: 5 },
    keyframes: [{ t: 0, transform: { x: 0, scale: .25 } },
      { t: 2, transform: { x: 100, scale: .5 } }] };
  const updated = withPreviewPosition({ output: { fps: 30 }, cuts: [cut] },
    { kind: 'cut', index: 0 }, { x: 40, y: 8 }, 2.5);
  assert.deepEqual(updated.cuts[0].keyframes[1], { t: .5, transform: { x: 40, y: 8 } });
  assert.deepEqual(updated.cuts[0].keyframes[0], cut.keyframes[0]);
  assert.deepEqual(updated.cuts[0].keyframes[2], cut.keyframes[1]);
  assert.deepEqual(updated.cuts[0].transform, cut.transform);
});
