// Run after rebuilding the preview frame-engine bundle. This checks actual WebGL pixels.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(join(root, 'packages/frame-engine/package.json'));
const { chromium } = require('@playwright/test');
const browser = await chromium.launch({ headless: true, args: [
  '--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl'
] });
try {
  const page = await browser.newPage();
  await page.goto('about:blank');
  await page.addScriptTag({ path: join(root, 'apps/shell/extensions/akari-preview/generated/frame-engine.js') });
  const result = await page.evaluate(async () => {
    const engine = window.AkariFrameEngine;
    const source = document.createElement('canvas');
    source.width = 128; source.height = 72;
    const ctx = source.getContext('2d');
    ctx.fillStyle = '#dddddd'; ctx.fillRect(0, 0, 128, 72);
    ctx.fillStyle = '#d02020'; ctx.fillRect(75, 10, 30, 50);
    const bitmap = await createImageBitmap(source);
    const canvas = document.createElement('canvas');
    const output = { width: 128, height: 72, colorSpace: 'bt709-limited' };
    const layer = {
      id: 'photo', kind: 'image', mask: null, opacity: 1, blend: 'normal',
      visual: { crop: { x: .1, y: .1, width: .8, height: .8 }, cropRotate: 5,
        perspective: null, transform: { x: 0, y: 0, scale: 1, rotateDegrees: 0 } },
      frame: { stroke: { color: '#00ff00', width: 8 }, cornerRadius: 40 }
    };
    const compositor = new engine.WebGL2Compositor(canvas, { synchronization: 'finish' });
    try {
      const surface = await compositor.compose([], [{ color: { bitmap, width: 128, height: 72 } }],
        output, new engine.FrameMetrics(), { timeUs: 0, base: [], layers: [layer], output });
      const rgba = await surface.readRgba();
      const at = (x, y) => [...rgba.slice((y * 128 + x) * 4, (y * 128 + x) * 4 + 4)];
      const samples = { corner: at(14, 8), center: at(64, 36),
        border: [113, 114, 115].map(x => at(x, 36)), red: at(84, 35) };
      surface.close();
      const flippedPlan = { timeUs: 0, base: [], layers: [{ ...layer, flip: { h: true } }], output };
      const flipped = await compositor.compose([], [{ color: { bitmap, width: 128, height: 72 } }],
        output, new engine.FrameMetrics(), flippedPlan);
      const flipPixels = await flipped.readRgba();
      samples.flippedRed = [...flipPixels.slice((35 * 128 + 44) * 4, (35 * 128 + 44) * 4 + 4)];
      flipped.close();
      const cutCanvas = document.createElement('canvas');
      const cut = new engine.WebGL2Compositor(cutCanvas, { synchronization: 'finish' });
      let cutSamples;
      try {
        const visual = { framing: { x: 0, y: 0, width: 1, height: 1, scale: 1, centerX: .5, centerY: .5 },
          transform: { x: 0, y: 0, scale: 1, rotateDegrees: 0 }, opacity: 1,
          layerStyle: { crop: { x: .1, y: .1, width: .8, height: .8 }, cropRotate: 5 } };
        const plan = { timeUs: 0, base: [{ kind: 'image', id: 'cut', image: {}, sourceTimeUs: 0, visual }],
          layers: [], output };
        const cutSurface = await cut.compose([{ bitmap, width: 128, height: 72 }], [], output,
          new engine.FrameMetrics(), plan);
        const pixels = await cutSurface.readRgba();
        const pixel = (x, y) => [...pixels.slice((y * 128 + x) * 4, (y * 128 + x) * 4 + 4)];
        cutSamples = { outside: pixel(5, 5), rotatedEdge: pixel(76, 12), red: pixel(84, 35) };
        cutSurface.close();
      } finally { cut.dispose(); }
      return { bytes: rgba.length, samples, cutSamples };
    } finally { compositor.dispose(); bitmap.close(); }
  });
  console.log(JSON.stringify(result));
  assert.equal(result.bytes, 128 * 72 * 4);
  assert.ok(result.samples.corner.slice(0, 3).every(value => value < 20));
  assert.ok(result.samples.border.some(([red, green, blue]) => green > red + 50 && green > blue + 50));
  assert.ok(result.samples.red[0] > result.samples.red[1] + 80);
  assert.ok(result.samples.flippedRed[0] > result.samples.flippedRed[1] + 80);
  assert.ok(result.cutSamples.outside.slice(0, 3).every(value => value < 20));
  assert.ok(result.cutSamples.rotatedEdge[1] >= result.cutSamples.rotatedEdge[0] - 20);
  assert.ok(result.cutSamples.red[0] > result.cutSamples.red[1] + 80);
} finally { await browser.close(); }
