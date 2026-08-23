import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('../src/video-fx.js', import.meta.url), 'utf8');
const context = vm.createContext({ globalThis: {} });
vm.runInContext(source, context);
const { parseCube, sampleLutTrilinear, rgbToFfmpegUv } = context.globalThis.AkariVideoFx;

const cube2 = `
TITLE "2x identity"
LUT_3D_SIZE 2
DOMAIN_MIN 0 0 0
DOMAIN_MAX 1 1 1
0 0 0
1 0 0
0 1 0
1 1 0
0 0 1
1 0 1
0 1 1
1 1 1
`;

test('.cube parser accepts a standard R-fastest 3D LUT and fixes its dimensions', () => {
  const lut = parseCube(cube2);
  assert.equal(lut.size, 2);
  assert.deepEqual([...lut.domainMin], [0, 0, 0]);
  assert.deepEqual([...lut.domainMax], [1, 1, 1]);
  assert.equal(lut.data.length, 24);
});

test('trilinear reference implementation returns fixed corner and midpoint values', () => {
  const lut = parseCube(cube2);
  assert.deepEqual([...sampleLutTrilinear(lut, [0, 0, 0])], [0, 0, 0]);
  assert.deepEqual([...sampleLutTrilinear(lut, [1, 1, 1])], [1, 1, 1]);
  assert.deepEqual([...sampleLutTrilinear(lut, [0.5, 0.25, 0.75])], [0.5, 0.25, 0.75]);
});

test('trilinear reference applies DOMAIN_MIN/MAX and clamps outside the domain', () => {
  const lut = parseCube(cube2.replace('DOMAIN_MIN 0 0 0', 'DOMAIN_MIN -1 -1 -1').replace('DOMAIN_MAX 1 1 1', 'DOMAIN_MAX 3 3 3'));
  assert.deepEqual([...sampleLutTrilinear(lut, [1, 0, 2])], [0.5, 0.25, 0.75]);
  assert.deepEqual([...sampleLutTrilinear(lut, [-2, 4, 1])], [0, 1, 0.5]);
});

test('.cube parser rejects a truncated size-33 file instead of silently uploading it', () => {
  assert.throws(() => parseCube('LUT_3D_SIZE 33\n0 0 0\n'), /requires 35937 rows/u);
});

test('FFmpeg chromakey RGB-to-UV reference pins green and red coordinates', () => {
  const green = rgbToFfmpegUv([0, 1, 0]);
  const red = rgbToFfmpegUv([1, 0, 0]);
  assert.ok(Math.abs(green[0] - 0.16874) < 1e-8);
  assert.ok(Math.abs(green[1] - 0.08131) < 1e-8);
  assert.ok(Math.abs(red[0] - 0.33126) < 1e-8);
  assert.ok(Math.abs(red[1] - 1) < 1e-8);
});
