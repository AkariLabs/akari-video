import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { FrameMetrics, parseCube, WebGL2Compositor } from '../dist/index.js';

const source = await readFile(new URL('../src/compositor/webgl2.ts', import.meta.url), 'utf8');

function sourceSection(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, `missing compositor section: ${startMarker}`);
  return source.slice(start, end);
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function fakeCanvas(width, height) {
  const rgba = new Uint8Array(width * height * 4);
  let clear = [0, 0, 0, 0];
  let nextConstant = 1;
  const constants = new Map([
    ['NO_ERROR', 0],
    ['MAX_TEXTURE_IMAGE_UNITS', 1],
    ['FRAMEBUFFER_COMPLETE', 2],
    ['ALREADY_SIGNALED', 3],
    ['CONDITION_SATISFIED', 4],
    ['WAIT_FAILED', 5],
  ]);
  const objectFactories = new Set([
    'createBuffer', 'createFramebuffer', 'createProgram', 'createQuery', 'createShader',
    'createSync', 'createTexture', 'fenceSync',
  ]);
  const gl = new Proxy({}, {
    get(_target, property) {
      if (constants.has(property)) return constants.get(property);
      if (typeof property === 'string' && /^[A-Z][A-Z0-9_]+$/u.test(property)) {
        constants.set(property, nextConstant + 100);
        nextConstant += 1;
        return constants.get(property);
      }
      if (objectFactories.has(property)) return () => ({});
      if (property === 'getAttribLocation') return () => 0;
      if (property === 'getUniformLocation') return () => ({});
      if (property === 'getShaderParameter' || property === 'getProgramParameter') return () => true;
      if (property === 'getShaderInfoLog' || property === 'getProgramInfoLog') return () => '';
      if (property === 'getExtension') return () => null;
      if (property === 'getError') return () => constants.get('NO_ERROR');
      if (property === 'getParameter') return key => key === constants.get('MAX_TEXTURE_IMAGE_UNITS') ? 32 : 0;
      if (property === 'checkFramebufferStatus') return () => constants.get('FRAMEBUFFER_COMPLETE');
      if (property === 'clientWaitSync') return () => constants.get('ALREADY_SIGNALED');
      if (property === 'clearColor') return (r, g, b, a) => { clear = [r, g, b, a]; };
      if (property === 'clear') return () => {
        for (let offset = 0; offset < rgba.length; offset += 4) {
          rgba.set(clear.map(channel => Math.round(channel * 255)), offset);
        }
      };
      if (property === 'getBufferSubData') return (_target, _offset, output) => output.set(rgba);
      return () => {};
    },
  });
  return {
    width,
    height,
    getContext(kind) {
      return kind === 'webgl2' ? gl : null;
    },
  };
}

async function assertEmptyPlanReadsBlack(output) {
  const width = 1;
  const height = 1;
  const canvas = fakeCanvas(width, height);
  const compositor = new WebGL2Compositor(canvas, { synchronization: 'finish' });
  const plan = { timeUs: 0, base: [], layers: [], output };
  try {
    const surface = await compositor.compose([], [], output, new FrameMetrics(), plan);
    assert.deepEqual([...await surface.readRgba()], [0, 0, 0, 255]);
    surface.close();
  } finally {
    compositor.dispose();
  }
}

test('WebGL2 compositor accepts an empty plan without a look and reads back opaque black', async () => {
  await assertEmptyPlanReadsBlack({ width: 1, height: 1, colorSpace: 'bt709-limited' });
});

test('WebGL2 compositor keeps an empty plan black when an identity look is active', async () => {
  const identity = parseCube('LUT_3D_SIZE 2\n0 0 0\n1 0 0\n0 1 0\n1 1 0\n0 0 1\n1 0 1\n0 1 1\n1 1 1');
  await assertEmptyPlanReadsBlack({
    width: 1,
    height: 1,
    colorSpace: 'bt709-limited',
    look: { lut: identity, intensity: 1 },
  });
});

test('base-only draw body remains byte-identical to the base commit', () => {
  // Exclude the routing condition: this hash pins the established base draw body only.
  const section = sourceSection(
    '      this.configureBaseDraw(plan, null, baseProgram!);',
    '    this.ensureFbos',
  );
  assert.equal(sha256(section), '01a6ddcc3ed9b58e0062fabe80438c99c9f11e3c0d6ed75e21f3edd258f15d19');
});

test('layer compositor path remains byte-identical to its pre-change source golden', () => {
  const section = sourceSection(
    '// FBO 0 starts as the base.',
    '    // Copy, or apply the optional final 3D LUT',
  );
  // adjust.fx adds per-layer effect, source-dimension and frame-index uniforms; FBO routing is unchanged.
  assert.equal(sha256(section), '3fd48841f6a4b0952bedb4892ea87ce31a5cbd77ea3a33d97f5d2654ce8d5a38');
});
