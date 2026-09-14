import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { WORLD_OVERVIEW_GEOMETRY_SOURCE } = require('../lib/common/world-overview-geometry.js');
const geometry = new Function(WORLD_OVERVIEW_GEOMETRY_SOURCE + '; return { akariOverviewView, akariCanvasPoint, akariWorldPoint, akariScreenPoint, akariHitTestStop };')();

test('view は既存の fit 式を使う', () => {
  assert.deepEqual(geometry.akariOverviewView([[0, 0, 100, 50]], { width: 300, height: 200 }, 50), { scale: 2, ox: 50, oy: 50 });
});

test('CSS 拡大を補正し world と screen を往復する', () => {
  assert.deepEqual(geometry.akariCanvasPoint({ width: 1000, height: 500 }, { left: 10, top: 20, width: 500, height: 250 }, { x: 260, y: 145 }), { x: 500, y: 250 });
  const view = { scale: 2, ox: 10, oy: 20 }, world = { x: 4, y: 5 };
  assert.deepEqual(geometry.akariWorldPoint(view, geometry.akariScreenPoint(view, world)), world);
});

test('hit test は境界を含み同距離なら後ろを選ぶ', () => {
  const view = { scale: 1, ox: 0, oy: 0 }, stops = [{ id: 'front', c: [0, 0, 1] }, { id: 'back', c: [10, 0, 1] }];
  assert.equal(geometry.akariHitTestStop(stops, view, { x: 5, y: 0 }, 5), 'back');
  assert.equal(geometry.akariHitTestStop(stops, view, { x: 20.01, y: 0 }, 10), null);
});
