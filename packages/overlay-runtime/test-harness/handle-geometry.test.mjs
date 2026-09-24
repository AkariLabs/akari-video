import test from 'node:test';
import assert from 'node:assert/strict';
import '../src/handle-geometry.js';

const g = globalThis.akariHandleGeometry;
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);

test('corner keeps aspect ratio and the opposite corner at 30 degrees', () => {
  const anchor = { x: 120, y: 80 };
  const rotation = 30 * Math.PI / 180;
  const dragged = { x: anchor.x + 100 * Math.cos(rotation) - 50 * Math.sin(rotation),
    y: anchor.y + 100 * Math.sin(rotation) + 50 * Math.cos(rotation) };
  const pointer = { x: anchor.x + 1.5 * (dragged.x - anchor.x),
    y: anchor.y + 1.5 * (dragged.y - anchor.y) };
  const scales = g.anchoredScales({ anchor, dragged, pointer, rotation: 30 });
  near(scales.scaleX, 1.5); near(scales.scaleY, 1.5);
  const pivot = { x: 170, y: 105 };
  const next = g.anchorPreservingPosition({ anchor, pivot, rotation: 30, ratioX: 1.5, ratioY: 1.5 });
  const fixed = g.anchorPreservingPosition({ anchor, pivot: next, rotation: 30,
    ratioX: 1 / 1.5, ratioY: 1 / 1.5 });
  near(fixed.x, pivot.x); near(fixed.y, pivot.y);
});

test('right edge changes width only and leaves left edge fixed when rotated', () => {
  const anchor = { x: 10, y: 20 };
  const dragged = { x: 10 + 100 * Math.cos(Math.PI / 6), y: 20 + 100 * Math.sin(Math.PI / 6) };
  const pointer = { x: 10 + 140 * Math.cos(Math.PI / 6), y: 20 + 140 * Math.sin(Math.PI / 6) };
  const scales = g.anchoredScales({ anchor, dragged, pointer, rotation: 30, edge: 'e' });
  near(scales.scaleX, 1.4); near(scales.scaleY, 1);
  const pivot = { x: anchor.x + 50 * Math.cos(Math.PI / 6), y: anchor.y + 50 * Math.sin(Math.PI / 6) };
  const next = g.anchorPreservingPosition({ anchor, pivot, rotation: 30,
    ratioX: 1.4, ratioY: 1 });
  const c = Math.cos(Math.PI / 6), s = Math.sin(Math.PI / 6);
  near(next.x - 50 * 1.4 * c, anchor.x); near(next.y - 50 * 1.4 * s, anchor.y);
});

test('six pixel magnet prefers canvas on a tie and returns guide extents', () => {
  const moving = { left: 494, right: 594, top: 20, bottom: 70 };
  const other = { left: 500, right: 600, top: 100, bottom: 150 };
  const snap = g.snapBounds(moving, [other], { width: 1000, height: 600 });
  assert.equal(snap.x.kind, 'canvas'); assert.equal(snap.x.correction, 6);
  assert.deepEqual(snap.x.guide, { start: 0, end: 600 });
  assert.equal(g.snapBounds({ ...moving, left: 493, right: 593 }, [], { width: 1000, height: 600 }).x, null);
  const item = g.snapBounds({ ...moving, left: 300, right: 400 }, [
    { left: 405, right: 450, top: 100, bottom: 150 }], { width: 1000, height: 600 }).x;
  assert.equal(item.kind, 'item'); assert.deepEqual(item.guide, { start: 20, end: 150 });
});

test('angles, axis lock, and endpoint point priority', () => {
  assert.equal(g.snapAngle(43), 45);
  assert.equal(g.snapAngle(40), 40);
  assert.equal(g.snapAngle(179), -180);
  assert.equal(g.snapAngle(43, true), 43);
  assert.deepEqual(g.axisLock(20, 10, true), { x: 20, y: 0 });
  assert.deepEqual(g.axisLock(10, 20, true), { x: 0, y: 20 });
  const result = g.solveLineEndpoint({ x: 0, y: 0 }, { x: 98, y: 97 },
    [{ left: 100, right: 140, top: 100, bottom: 140 }], { width: 500, height: 500 });
  assert.deepEqual(result.point, { x: 100, y: 100 });
  assert.equal(result.snap.x.kind, 'item');
  const angleOnly = g.solveLineEndpoint({ x: 0, y: 0 }, { x: 101, y: 97 }, [],
    { width: 500, height: 500 });
  near(angleOnly.point.x, angleOnly.point.y);
});

test('line endpoint transform keeps the other endpoint fixed', () => {
  const fixed = { x: 30, y: 40 };
  const oldMoving = { x: 130, y: 40 };
  const moving = { x: 130, y: 140 };
  const pose = g.lineTransform({ fixed, originalMoving: oldMoving, moving,
    movingEndpoint: 'end', stageCenter: { x: 0, y: 0 }, pose: { x: 80, y: 40, scale: 1, rotate: 0 } });
  assert.ok(pose);
  near(pose.scaleX, Math.SQRT2);
  near(pose.rotate, 45);
  const oldLocalFixed = { x: -50, y: 0 };
  const a = pose.rotate * Math.PI / 180;
  near(pose.x + Math.cos(a) * pose.scaleX * oldLocalFixed.x, fixed.x);
  near(pose.y + Math.sin(a) * pose.scaleX * oldLocalFixed.x, fixed.y);
});
