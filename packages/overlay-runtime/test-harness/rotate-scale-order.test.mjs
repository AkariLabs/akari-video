import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { launchBrowser } from './fixtures/browser.mjs';

const source = async path => readFile(new URL(path, import.meta.url), 'utf8');
const axis = 'scale(var(--scale-x';

function matrix(angle, sx, sy, oldOrder = false) {
  const c = Math.cos(angle), s = Math.sin(angle);
  return oldOrder ? [sx * c, sy * s, -sx * s, sy * c] : [sx * c, sx * s, -sy * s, sy * c];
}

test('all HTML surfaces compose translation, rotation, then axis scale; legacy sheet stays unchanged', async () => {
  const [shell, web, gpu, gpuPage, osr] = await Promise.all([
    source('../src/overlay-runtime.js'),
    source('../../preview-server/public/app.js'),
    source('../../gpu-export/src/page-runtime.js'),
    source('../../gpu-export/src/page-builder.mjs'),
    source('../../render-cut/src/rasterize.mjs'),
  ]);
  for (const [name, text] of Object.entries({ shell, web, gpu, gpuPage, osr })) {
    assert.match(text, /rotate\(var\(--rotate,\s*0deg\)\)\s*(?:\$\{overlayScaleCss\}|scale\(var\(--scale)/, name);
    if (name !== 'gpuPage') assert.ok(text.includes(axis) || text.includes('scale(var(--scale-x,var('), name);
  }
  assert.match(osr, /: `\$\{overlayScaleCss\} rotate\(var\(--rotate, 0deg\)\)`/);
  assert.match(osr, /\$\{overlayRotateScaleCss\}/);
  for (const value of matrix(Math.PI / 6, 1.25, 1.25)) assert.ok(Number.isFinite(value));
  assert.deepEqual(matrix(Math.PI / 6, 1.25, 1.25), matrix(Math.PI / 6, 1.25, 1.25, true));
});

test('browser measures four right angled corners after 30° rotation and scaleX 2', { timeout: 60000 }, async () => {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 640, height: 360 });
    await page.setContent('<style>body{margin:0}#overlay-stage{position:relative;width:640px;height:360px}</style><div id="overlay-stage"></div>');
    await page.evaluate(() => {
      const markers = ['nw', 'ne', 'se', 'sw'].map((name, i) => `<i data-corner="${name}" style="position:absolute;left:${i === 1 || i === 2 ? 100 : 0}px;top:${i >= 2 ? 60 : 0}px;width:0;height:0"></i>`).join('');
      window.akari = { state: { editPath: 'fixture', summary: { output: { width: 640, height: 360, fps: 30 }, overlays: [{ id: 'leaf', start: 0, duration: 2, transform: { rotate: 30, scaleX: 2, scaleY: 1 }, html: `<div style="position:absolute;left:270px;top:150px;width:100px;height:60px;background:green">${markers}</div>` }] } }, stageScale: () => 1 };
    });
    await page.addScriptTag({ content: await source('../src/overlay-runtime.js') });
    const points = await page.evaluate(async () => {
      await window.akari.runtime.mount(window.akari.state.summary);
      window.akari.runtime.tick(.5, true);
      return ['nw', 'ne', 'se', 'sw'].map(name => {
        const r = document.querySelector(`[data-corner="${name}"]`).getBoundingClientRect();
        return { x: r.x, y: r.y };
      });
    });
    const v = (a, b) => ({ x: b.x - a.x, y: b.y - a.y });
    const dot = (a, b) => a.x * b.x + a.y * b.y;
    const cross = (a, b) => a.x * b.y - a.y * b.x;
    const top = v(points[0], points[1]), right = v(points[1], points[2]);
    const bottom = v(points[3], points[2]), left = v(points[0], points[3]);
    const angleError = Math.abs(Math.atan2(dot(top, right), cross(top, right)) * 180 / Math.PI);
    assert.ok(angleError <= .5, `corner angle deviation ${angleError}°: ${JSON.stringify(points)}`);
    assert.ok(Math.abs(cross(top, bottom)) < .1, 'top/bottom parallel');
    assert.ok(Math.abs(cross(left, right)) < .1, 'left/right parallel');
    assert.ok(Math.abs(Math.hypot(top.x, top.y) - 200) < .1);
    assert.ok(Math.abs(Math.hypot(right.x, right.y) - 60) < .1);
  } finally { await browser.close(); }
});

test('rotated axis resize keeps its opposite corner fixed', { timeout: 60000 }, async () => {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 640, height: 360 });
    const css = await source('../src/interaction.css');
    await page.setContent(`<style>body{margin:0}#overlay-stage{position:relative;width:640px;height:360px}${css}</style><div id="overlay-stage"></div>`);
    await page.evaluate(() => {
      window.akari = { state: { editPath: 'fixture', summary: { output: { width: 640, height: 360, fps: 30 }, overlays: [{
        id: 'leaf', start: 0, duration: 2, transform: { rotate: 30, scaleX: 2, scaleY: 1 },
        html: '<div style="position:absolute;left:270px;top:150px;width:100px;height:60px;background:green"><i data-corner="nw" style="position:absolute;left:0;top:0;width:0;height:0"></i></div>',
      }] } }, stageScale: () => 1, engine: { overlayWrite: async () => {} } };
    });
    for (const file of ['overlay-runtime.js', 'interaction.js']) await page.addScriptTag({ content: await source(`../src/${file}`) });
    await page.evaluate(async () => { await window.akari.runtime.mount(window.akari.state.summary); window.akari.runtime.tick(.5, true); });
    const anchor = () => page.evaluate(() => {
      const rect = document.querySelector('[data-corner="nw"]').getBoundingClientRect();
      return { x: rect.x, y: rect.y };
    });
    const before = await anchor();
    await page.mouse.click(320, 180);
    const handle = await page.evaluate(() => {
      const r = document.querySelector('.akari-interaction-handle.is-se').getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    await page.keyboard.down('Alt');
    await page.mouse.move(handle.x, handle.y); await page.mouse.down();
    await page.mouse.move(handle.x + 40, handle.y + 20, { steps: 4 });
    await page.mouse.up(); await page.keyboard.up('Alt');
    const after = await anchor();
    assert.ok(Math.hypot(after.x - before.x, after.y - before.y) <= .5,
      `opposite corner drifted: ${JSON.stringify({ before, after })}`);
  } finally { await browser.close(); }
});
