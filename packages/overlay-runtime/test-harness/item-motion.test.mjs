import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { evaluateItemMotion, invertItemMotionPosition, dragItemMotionPosition,
  motionRevealCss } = require('../src/item-motion.js');

test('position keyframes and entrance offset add, opacity multiplies', () => {
  const item = { at: 2, duration: 2, fps: 30, transform: { x: 10, y: 4 }, opacity: .5,
    keyframes: [{ t: 0, transform: { x: 0 } }, { t: 60, transform: { x: 100 } }],
    motion: { in: { preset: 'slide-up', duration: 30 } } };
  assert.deepEqual(evaluateItemMotion(item, 2), { x: 0, y: 44, scale: 1,
    scaleX: 1, scaleY: 1, rotate: 0, opacity: .5 });
  assert.equal(evaluateItemMotion(item, 2.5).x, 25);
  assert.equal(evaluateItemMotion({ ...item, motion: { in: { preset: 'fade', duration: 30 } } }, 2).opacity, 0);
  assert.equal(evaluateItemMotion({ ...item, motion: { in: { preset: 'fade', duration: 30 } } }, 3).opacity, .5);
});

test('parent is applied after child and inverse returns the writable base position', () => {
  const child = { at: 1, duration: 3, fps: 30, transform: { x: 20, y: 10 },
    motion: { in: { preset: 'slide-left', duration: 30, amount: 40 } } };
  const parent = { at: 0, duration: 4, fps: 30, transform: { x: 100, y: 0, scale: 2, rotate: 90 } };
  const state = evaluateItemMotion(child, 1, [parent]);
  assert.ok(Math.abs(state.x - 80) < 1e-9);
  assert.ok(Math.abs(state.y - 120) < 1e-9);
  const base = invertItemMotionPosition(child, 1, [parent], state.x, state.y);
  assert.ok(Math.abs(base.x - 20) < 1e-9);
  assert.ok(Math.abs(base.y - 10) < 1e-9);
});

test('evaluation leaves the declaration unchanged', () => {
  const item = { at: 0, duration: 1, fps: 30, transform: { x: 2 },
    keyframes: [{ t: 0, transform: { x: 2 } }, { t: 30, transform: { x: 4 } }],
    motion: { loop: { preset: 'pulse', period: 30 } } };
  const before = JSON.stringify(item);
  for (let t = 0; t < 1; t += .01) evaluateItemMotion(item, t);
  assert.equal(JSON.stringify(item), before);
});

test('opacity is clamped after every parent multiplier', () => {
  const item = { at: 0, duration: 1, opacity: 1.2 };
  const parent = { at: 0, duration: 1, opacity: .5 };
  assert.equal(evaluateItemMotion(item, .5, [parent]).opacity, .6);
});

test('wipe exposes a deterministic clip on every surface', () => {
  const state = evaluateItemMotion({ at: 0, duration: 1, fps: 30,
    motion: { in: { preset: 'wipe', duration: 30 } } }, .5);
  assert.equal(motionRevealCss(state), 'inset(0% 50% 0% 0%)');
  assert.equal(motionRevealCss({}), '');
});

test('uniform and axis scale endpoints interpolate on the effective axis', () => {
  const item = { at: 0, duration: 2, fps: 30, keyframes: [
    { t: 0, transform: { scale: 1 } }, { t: 60, transform: { scaleX: 2 } }
  ] };
  const middle = evaluateItemMotion(item, 1);
  assert.equal(middle.scaleX, 1.5);
  assert.equal(middle.scaleY, 1);
  assert.equal(evaluateItemMotion(item, 0).scaleX, 1);
  assert.equal(evaluateItemMotion(item, 2).scaleX, 2);
});

test('pointer delta in final space writes a base position that reevaluates without a jump', () => {
  const item = { at: 0, duration: 4, fps: 30, transform: { x: -200, y: 0, scale: .25 },
    keyframes: [{ t: 0, transform: { x: -200 } }, { t: 120, transform: { x: 200 } }],
    motion: { in: { preset: 'slide-up', duration: 30, amount: 100 } } };
  const t = .5, start = evaluateItemMotion(item, t);
  const drag = dragItemMotionPosition(item, t, [], start, 80, 0);
  assert.deepEqual(drag.visible, { x: start.x + 80, y: start.y });
  const updated = { ...item, keyframes: [...item.keyframes,
    { t: 15, transform: { x: drag.base.x, y: drag.base.y } }] };
  const after = evaluateItemMotion(updated, t);
  assert.equal(after.x, drag.visible.x);
  assert.equal(after.y, drag.visible.y);
  assert.equal(item.transform.scale, .25);
});
