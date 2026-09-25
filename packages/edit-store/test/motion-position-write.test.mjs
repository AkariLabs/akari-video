import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { writeItemPositionAt } = require('../lib/motion-position-write.js');
const { evaluateItemMotion } = require('../../overlay-runtime/src/item-motion.js');

test('a direct move adds only X/Y at one frame and reevaluates to the visible target', () => {
  const item = { id: 'photo', at: 0, duration: 120, source: { kind: 'media', src: 'photo' },
    transform: { x: -200, y: 0, scale: .25, rotate: 8 },
    keyframes: [{ t: 0, transform: { x: -200 } }, { t: 120, transform: { x: 200 } }],
    motion: { in: { preset: 'slide-up', duration: 30, amount: 100 } } };
  const visible = evaluateItemMotion({ ...item, fps: 30 }, .5);
  const target = { x: visible.x + 80, y: visible.y };
  const base = { x: target.x, y: target.y - 50 };
  const saved = writeItemPositionAt(item, 15, base);
  assert.deepEqual(saved.keyframes[1], { t: 15, transform: base });
  assert.deepEqual(saved.keyframes[0], item.keyframes[0]);
  assert.deepEqual(saved.keyframes[2], item.keyframes[1]);
  assert.deepEqual(saved.transform, item.transform);
  const after = evaluateItemMotion({ ...saved, fps: 30 }, .5);
  assert.equal(after.x, target.x);
  assert.equal(after.y, target.y);
});

test('unkeyed direct move keeps scale and rotation unchanged', () => {
  const item = { id: 'photo', duration: 90, source: { kind: 'media', src: 'photo' },
    transform: { x: 1, y: 2, scale: .25, rotate: 12 } };
  const saved = writeItemPositionAt(item, 15, { x: 8, y: 9 });
  assert.deepEqual(saved.transform, { x: 8, y: 9, scale: .25, rotate: 12 });
  assert.deepEqual(item.transform, { x: 1, y: 2, scale: .25, rotate: 12 });
});
