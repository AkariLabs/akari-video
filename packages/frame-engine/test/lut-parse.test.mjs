import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import {
  parseCube,
  resolveLookLutPath,
  sampleLutTrilinear,
} from '../dist/index.js';

const repository = path.resolve(import.meta.dirname, '../../..');
const referenceSource = await readFile(
  path.join(repository, 'packages/overlay-runtime/src/video-fx.js'),
  'utf8',
);
const context = vm.createContext({ window: {} });
vm.runInContext(referenceSource, context, { filename: 'video-fx.js' });
const reference = context.window.AkariVideoFx;

test('cube parser and trilinear samples match the established video-fx rail for every preset', async () => {
  const root = path.join(repository, 'presets/luts');
  const ids = (await readdir(root, { withFileTypes: true }))
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort();
  assert.equal(ids.length, 10);
  for (const id of ids) {
    const text = await readFile(path.join(root, id, `${id}.cube`), 'utf8');
    const actual = parseCube(text);
    const expected = reference.parseCube(text);
    assert.equal(actual.size, expected.size, id);
    assert.deepEqual([...actual.domainMin], [...expected.domainMin], id);
    assert.deepEqual([...actual.domainMax], [...expected.domainMax], id);
    assert.deepEqual([...actual.data], [...expected.data], id);
    for (let r = 0; r < 8; r += 1) {
      for (let g = 0; g < 8; g += 1) {
        for (let b = 0; b < 8; b += 1) {
          const rgb = [r / 7, g / 7, b / 7];
          const sampled = sampleLutTrilinear(actual, rgb);
          const referenceSample = reference.sampleLutTrilinear(expected, rgb);
          for (let channel = 0; channel < 3; channel += 1) {
            assert.equal(sampled[channel], referenceSample[channel], `${id} ${rgb} channel ${channel}`);
          }
        }
      }
    }
  }
});

test('look LUT references follow render-cut preset and project-relative rules', () => {
  assert.equal(resolveLookLutPath('cinematic'), 'presets/luts/cinematic/cinematic.cube');
  assert.equal(resolveLookLutPath('assets/custom.cube'), 'assets/custom.cube');
  assert.equal(resolveLookLutPath('assets\\custom.cube'), 'assets/custom.cube');
});

test('cube parser preserves the reference error contract', () => {
  for (const input of ['', 'LUT_1D_SIZE 2\n0 0 0\n1 1 1', 'LUT_3D_SIZE 1']) {
    let expected;
    let actual;
    try { reference.parseCube(input); } catch (error) { expected = error; }
    try { parseCube(input); } catch (error) { actual = error; }
    assert.ok(expected);
    assert.ok(actual);
    assert.equal(actual.constructor.name, expected.constructor.name);
    assert.equal(actual.message, expected.message);
  }
});
