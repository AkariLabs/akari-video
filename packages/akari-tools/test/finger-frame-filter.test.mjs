import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const fixtureRoot = join(packageRoot, 'test', 'fixtures', 'finger-frame-demo');
const script = join(packageRoot, 'bin', 'finger-frame.mjs');
const expectedCorners = [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]];

for (const [spec, expected] of [
  ['invert', { type: 'invert' }],
  ['lut:mono', { type: 'lut', id: 'mono' }],
  ['saturation:1.6', { type: 'saturation', value: 1.6 }],
]) {
  test(`finger-frame filter: ${spec} emits a src-less filter layer with the known gesture window`, () => {
    const result = spawnSync(process.execPath, [script, fixtureRoot, '--kind', 'filter', '--filter', spec], {
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.equal(output.layers.length, 1);
    const layer = output.layers[0];
    assert.equal(layer.kind, 'filter');
    assert.deepEqual(layer.filter, expected);
    assert.equal(layer.src, undefined);
    assert.equal(layer.t, 1.5);
    assert.equal(layer.duration, 1.9);
    assert.deepEqual(layer.perspective.corners, expectedCorners);
    assert.ok(layer.keyframes.length >= 2);
  });
}

test('finger-frame filter rejects --media', () => {
  const result = spawnSync(process.execPath, [
    script,
    fixtureRoot,
    '--kind',
    'filter',
    '--filter',
    'invert',
    '--media',
    'media/insert.mp4',
  ], { encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /--kind filter では --media と --layer-id を指定できません/u);
});

test('finger-frame filter requires --filter', () => {
  const result = spawnSync(process.execPath, [script, fixtureRoot, '--kind', 'filter'], { encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /--kind filter では --filter/u);
});

test('finger-frame filter without --apply leaves the committed fixture unchanged', () => {
  const edit = JSON.parse(readFileSync(join(fixtureRoot, 'edit.json'), 'utf8'));
  assert.deepEqual(edit.layers, []);
});
