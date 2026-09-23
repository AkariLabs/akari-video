import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { worldDelta, applyWorldDelta } from '../src/selection-scope.mjs';

const source = readFileSync(new URL('../src/selection-scope.mjs', import.meta.url), 'utf8');
const classic = readFileSync(new URL('../src/interaction.js', import.meta.url), 'utf8');
const body = text => text.split('// BEGIN world-delta')[1].split('// END world-delta')[0]
  .split('\n').map(line => line.trim()).filter(Boolean).join('\n');

test('classic runtime carries the pure world delta unchanged', () => {
  assert.equal(body(classic), body(source));
});

test('world delta composes translation, scale and rotation and is reversible', () => {
  const oldPose = { x: 13, y: -8, scale: 1.25, rotate: 30 };
  const nextPose = { x: -14, y: 31, scale: 2, rotate: 75 };
  const child = { x: 30, y: 20, scale: 1.5, rotate: -20, scaleX: 1.2, scaleY: 1.8 };
  const moved = applyWorldDelta(worldDelta(oldPose, nextPose), child);
  const restored = applyWorldDelta(worldDelta(nextPose, oldPose), moved);
  for (const key of Object.keys(child)) assert.ok(Math.abs(restored[key] - child[key]) < 1e-9, key);
  assert.ok(Math.abs(moved.scale - 2.4) < 1e-9);
  assert.equal(moved.rotate, 25);
  assert.deepEqual(applyWorldDelta(worldDelta({}, { x: 5, y: -3 }), child),
    { ...child, x: 35, y: 17 });
});
