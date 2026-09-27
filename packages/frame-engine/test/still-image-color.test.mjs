import assert from 'node:assert/strict';
import test from 'node:test';
import { CachedStillImageSource, evaluateFrame } from '../dist/index.js';

test('photo decode keeps the browser default while mask decode disables color conversion', async () => {
  const originalFetch = globalThis.fetch;
  const originalCreateImageBitmap = globalThis.createImageBitmap;
  const calls = [];
  const closed = [];
  globalThis.fetch = async () => ({ ok: true, blob: async () => new Blob(['fixture']) });
  globalThis.createImageBitmap = async (_blob, options) => {
    calls.push(options);
    return { width: 2, height: 1, close() { closed.push(options); } };
  };
  try {
    const photo = new CachedStillImageSource('photo.jpg');
    const mask = new CachedStillImageSource('mask.png');
    await photo.load();
    await mask.load({ colorSpaceConversion: 'none' });
    await photo.load();
    await mask.load({ colorSpaceConversion: 'none' });
    assert.deepEqual(calls, [undefined, { colorSpaceConversion: 'none' }]);
    photo.destroy();
    mask.destroy();
    assert.equal(closed.length, 2);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.createImageBitmap = originalCreateImageBitmap;
  }
});

test('still-image evaluation requests no color conversion only for the mask', async () => {
  const loaded = [];
  const bitmap = { width: 2, height: 1, bitmap: {} };
  const photo = { load: async options => { loaded.push(['photo', options]); return bitmap; }, destroy() {} };
  const mask = { load: async options => { loaded.push(['mask', options]); return bitmap; }, destroy() {} };
  const plan = { timeUs: 0, base: [], layers: [{ id: 'photo', kind: 'image', image: photo,
    mask: { kind: 'still', source: mask },
    visual: { crop: { x: 0, y: 0, width: 1, height: 1 }, perspective: null,
      transform: { x: 0, y: 0, scale: 1, rotateDegrees: 0 } },
    blend: 'normal', opacity: 1 }],
  output: { width: 2, height: 1, colorSpace: 'bt709-limited' } };
  await evaluateFrame(plan, { metrics: { record() {} }, compositor: {
    async compose() { return { width: 2, height: 1, close() {} }; }
  } });
  assert.deepEqual(loaded, [
    ['photo', undefined], ['mask', { colorSpaceConversion: 'none' }]
  ]);
});

test('a failed still decode is retried on the next load instead of staying rejected', async () => {
  const originalFetch = globalThis.fetch;
  const originalCreateImageBitmap = globalThis.createImageBitmap;
  let attempts = 0;
  globalThis.fetch = async () => ({ ok: true, blob: async () => new Blob(['fixture']) });
  // 1 回目はメモリ逼迫を模して失敗させ、2 回目は成功させる。
  globalThis.createImageBitmap = async () => {
    attempts += 1;
    if (attempts === 1) throw new Error('out of memory');
    return { width: 2, height: 1, close() {} };
  };
  try {
    const still = new CachedStillImageSource('broll.png');
    await assert.rejects(still.load(), /out of memory/);
    const value = await still.load();
    assert.equal(value.width, 2);
    assert.equal(attempts, 2);
    await still.load();
    assert.equal(attempts, 2);
    still.destroy();
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.createImageBitmap = originalCreateImageBitmap;
  }
});
