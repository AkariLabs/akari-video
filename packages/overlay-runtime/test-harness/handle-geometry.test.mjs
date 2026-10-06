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
    { left: 403, right: 450, top: 100, bottom: 150 }], { width: 1000, height: 600 }).x;
  assert.equal(item.kind, 'item'); assert.deepEqual(item.guide, { start: 20, end: 150 });
  const nearTie = g.snapBounds({ left: 400.25, right: 600.25, top: 20, bottom: 70 },
    [{ left: 560, right: 600.25, top: 90, bottom: 140 }],
    { width: 1000, height: 600 }).x;
  assert.equal(nearTie.kind, 'canvas');
  near(nearTie.correction, -.25);
  assert.deepEqual(nearTie.guide, { start: 0, end: 600 });
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

test('rotation translation holds the visible center while rotating around a distant stage pivot', () => {
  const pose = { x: 200, y: 160 };
  const pivot = { x: 1160, y: 700 };
  const fixed = { x: 350, y: 260 };
  const delta = 43;
  const next = g.rotationAroundPoint(pose, pivot, fixed, delta);
  const radians = delta * Math.PI / 180;
  const c = Math.cos(radians), s = Math.sin(radians);
  const dx = fixed.x - pivot.x, dy = fixed.y - pivot.y;
  const after = { x: pivot.x + next.x - pose.x + c * dx - s * dy,
    y: pivot.y + next.y - pose.y + s * dx + c * dy };
  near(after.x, fixed.x);
  near(after.y, fixed.y);
  assert.ok(Math.hypot(next.x - pose.x, next.y - pose.y) > 100);
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

test('line angle uses the cursor direction for the four-degree snap window', () => {
  const fixed = { x: 120, y: 130 };
  const at = angle => ({ x: fixed.x + 100 * Math.cos(angle * Math.PI / 180),
    y: fixed.y + 100 * Math.sin(angle * Math.PI / 180) });
  const shiftedEndpoint = at(40.88);
  const cursor = at(42);
  const snapped = g.solveLineEndpoint(fixed, shiftedEndpoint, [],
    { width: 1000, height: 1000 }, 1, false, cursor);
  near(Math.atan2(snapped.point.y - fixed.y, snapped.point.x - fixed.x) * 180 / Math.PI, 45);
  const free = g.solveLineEndpoint(fixed, shiftedEndpoint, [],
    { width: 1000, height: 1000 }, 1, true, cursor);
  near(Math.atan2(free.point.y - fixed.y, free.point.x - fixed.x) * 180 / Math.PI, 40.88);
});

test('canvas centre and other items snap at 6px; canvas edges snap at 4px', () => {
  const canvas = { width: 1000, height: 600 };
  // 画面中央は 6px、画面の端は 4px。
  assert.equal(g.snapBounds({ left: 444, right: 494, top: 200, bottom: 250 }, [], canvas).x.target, 500);
  assert.equal(g.snapBounds({ left: 5, right: 55, top: 200, bottom: 250 }, [], canvas).x, null);
  assert.equal(g.snapBounds({ left: 4, right: 54, top: 200, bottom: 250 }, [], canvas).x.target, 0);
  // 他の素材は 6px まで。
  const other = { left: 700, right: 800, top: 300, bottom: 350 };
  assert.equal(g.snapBounds({ left: 600, right: 693, top: 20, bottom: 70 }, [other], canvas).x, null);
  assert.equal(g.snapBounds({ left: 600, right: 694, top: 20, bottom: 70 }, [other], canvas).x.kind, 'item');
  // 自分の左端を相手の中央（750）へ寄せる交差の組み合わせは候補にしない。
  assert.equal(g.snapBounds({ left: 748, right: 778, top: 20, bottom: 70 }, [other], canvas).x, null);
  // 中央どうしは吸着する。
  const centers = g.snapBounds({ left: 733, right: 769, top: 20, bottom: 70 }, [other], canvas).x;
  assert.equal(centers.kind, 'item'); near(centers.correction, -1);
});

test('a held magnet is kept until it is released, but yields to a clearly closer or canvas target', () => {
  const canvas = { width: 1000, height: 600 };
  const others = [{ left: 200, right: 300, top: 300, bottom: 350 }, { left: 204.5, right: 280, top: 400, bottom: 450 }];
  const first = g.snapBounds({ left: 201, right: 251, top: 20, bottom: 70 }, others, canvas).x;
  assert.equal(first.target, 200);
  // 別の素材の辺（204.5）の方がわずかに近くなっても、保持中の 200 に留まる（飛び移らない）。
  const held = g.snapBounds({ left: 203, right: 253, top: 20, bottom: 70 }, others, canvas, 1, 6, { previous: { x: first } }).x;
  assert.equal(held.target, 200); near(held.correction, -3);
  // 2px 以上近い候補へは乗り換える。
  const closer = g.snapBounds({ left: 203, right: 253, top: 20, bottom: 70 },
    [others[0], { left: 204, right: 280, top: 400, bottom: 450 }], canvas, 1, 6, { previous: { x: first } }).x;
  assert.equal(closer.target, 204);
  // 吸着距離を超えたら離す。
  assert.equal(g.snapBounds({ left: 207, right: 257, top: 20, bottom: 70 }, [others[0]], canvas, 1, 6,
    { previous: { x: first } }).x, null);
  // 保持中の素材（3px）より近い画面中央（1px）へは、さらに近い別素材（0.5px）が居ても乗り換える。
  const itemHeld = { kind: 'item', target: 502, sourceIndex: 0, correction: 3 };
  const switched = g.snapBounds({ left: 499, right: 549, top: 20, bottom: 70 },
    [{ left: 502, right: 560, top: 300, bottom: 350 }, { left: 499.5, right: 520, top: 400, bottom: 450 }], canvas, 1, 6,
    { previous: { x: itemHeld } }).x;
  assert.equal(switched.kind, 'canvas'); assert.equal(switched.target, 500);
});

test('a fast axis keeps an existing magnet but does not grab a new one, while the slow axis still snaps', () => {
  const canvas = { width: 1000, height: 600 };
  const moving = { left: 497, right: 547, top: 273, bottom: 323 };
  const both = g.snapBounds(moving, [], canvas);
  assert.equal(both.x.target, 500); assert.equal(both.y.target, 300);
  // 横に素早く動かしている間も、縦の中央合わせは効く。
  const fastX = g.snapBounds(moving, [], canvas, 1, 6, { fast: { x: true, y: false } });
  assert.equal(fastX.x, null); assert.equal(fastX.y.target, 300);
  assert.equal(g.snapBounds(moving, [], canvas, 1, 6, { fast: true }).x, null);
  // 既に吸着している先は、素早く動かしていても保持する。
  assert.equal(g.snapBounds({ ...moving, left: 498, right: 548 }, [], canvas, 1, 6,
    { fast: true, previous: { x: both.x } }).x.target, 500);
});
