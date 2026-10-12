import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../src/interaction.js', import.meta.url), 'utf8');
const begin = source.indexOf('// BEGIN rotation3d-geometry');
const end = source.indexOf('// END rotation3d-geometry');
assert.ok(begin >= 0 && end > begin);
const { rotation3dHitTest, rotation3dValues, rotation3dChanged } = vm.runInNewContext(
  `${source.slice(begin, end)}; ({ rotation3dHitTest, rotation3dValues, rotation3dChanged })`);

test('screen fixed rings identify axes while their interior remains available for item hits', () => {
  assert.equal(rotation3dHitTest(70, 70, 100), 'z');
  assert.equal(rotation3dHitTest(0, 32, 100), 'y');
  assert.equal(rotation3dHitTest(32, 0, 100), 'x');
  assert.equal(rotation3dHitTest(0, 0, 100), null);
  assert.equal(rotation3dHitTest(60, 50, 100), null);
  assert.equal(rotation3dHitTest(100, 100, 100), null);
});

test('one radius of horizontal or vertical drag changes its Euler component by 90 degrees', () => {
  const start = { x: 4, y: 8, z: 12 };
  assert.deepEqual({ ...rotation3dValues(start, 'y', { x: 0, y: 0 }, { x: 100, y: 0 }, 100, false) },
    { x: 4, y: 98, z: 12 });
  assert.deepEqual({ ...rotation3dValues(start, 'x', { x: 0, y: 0 }, { x: 0, y: 100 }, 100, false) },
    { x: 94, y: 8, z: 12 });
});

test('Z follows pointer angle, Shift snaps to 15 degrees, and tiny changes do not write', () => {
  const start = { x: 0, y: 0, z: 0 };
  assert.equal(rotation3dValues(start, 'z', { x: 100, y: 0 }, { x: 0, y: 100 }, 100, false).z, -90);
  assert.equal(rotation3dValues(start, 'z', { x: 0, y: 100 }, { x: 100, y: 0 }, 100, false).z, 90);
  assert.equal(rotation3dValues(start, 'y', { x: 0, y: 0 }, { x: 20, y: 0 }, 100, true).y, 15);
  assert.equal(rotation3dChanged(start, { x: .049, y: 0, z: 0 }), false);
  assert.equal(rotation3dChanged(start, { x: .05, y: 0, z: 0 }), true);
});
