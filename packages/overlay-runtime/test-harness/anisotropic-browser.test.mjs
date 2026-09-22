import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { launchBrowser } from './fixtures/browser.mjs';

test('axis CSS and corner resize preserve ratio and the opposite anchor', { timeout: 60000 }, async () => {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 640, height: 360 });
    const css = await readFile(new URL('../src/interaction.css', import.meta.url), 'utf8');
    await page.setContent(`<style>body{margin:0}#overlay-stage{position:relative;width:640px;height:360px}${css}</style><div id="overlay-stage"></div>`);
    await page.evaluate(() => {
      window.writes = [];
      window.akari = { state: { editPath: 'fixture', summary: { output: { width: 640, height: 360, fps: 30 }, overlays: [{
        id: 'leaf', start: 0, duration: 2, transform: { scaleX: 2, scaleY: .5 },
        html: '<div style="position:absolute;left:270px;top:150px;width:100px;height:60px;background:green"></div>',
      }] } }, stageScale: () => 1, engine: { overlayWrite: async (_path, id, patch) => { window.writes.push({ id, patch }); } } };
    });
    for (const file of ['overlay-runtime.js', 'interaction.js']) await page.addScriptTag({ content: await readFile(new URL(`../src/${file}`, import.meta.url), 'utf8') });
    await page.evaluate(async () => { await window.akari.runtime.mount(window.akari.state.summary); window.akari.runtime.tick(.5, true); });
    const read = () => page.evaluate(() => {
      const c = document.querySelector('[data-overlay-id="leaf"]'), b = window.akari.interaction.fragmentBounds(c);
      return { width: b.width, height: b.height, left: b.left, top: b.top, right: b.right, bottom: b.bottom,
        x: Number(c.style.getPropertyValue('--scale-x')), y: Number(c.style.getPropertyValue('--scale-y')) };
    });
    const before = await read();
    assert.equal(before.width, 200); assert.equal(before.height, 30);
    assert.equal(before.x, 2); assert.equal(before.y, .5);
    await page.mouse.click(320, 180);
    const handle = await page.evaluate(() => {
      const r = document.querySelector('.akari-interaction-handle.is-se').getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    await page.keyboard.down('Alt'); await page.mouse.move(handle.x, handle.y); await page.mouse.down();
    await page.mouse.move(handle.x + 40, handle.y + 6, { steps: 4 }); await page.mouse.up(); await page.keyboard.up('Alt');
    const after = await read();
    assert.ok(after.width > before.width);
    assert.ok(Math.abs(after.x / after.y - 4) < 1e-9);
    assert.ok(Math.abs(after.left - before.left) < .25); assert.ok(Math.abs(after.top - before.top) < .25);
    await page.waitForFunction(() => window.writes.length > 0);
    const patch = await page.evaluate(() => window.writes.at(-1).patch.transform);
    assert.ok(Math.abs(patch.scaleX / patch.scaleY - 4) < 1e-9);
  } finally { await browser.close(); }
});

test('uniform move and corner resize keep legacy transform keys in write patches', { timeout: 60000 }, async () => {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 640, height: 360 });
    const css = await readFile(new URL('../src/interaction.css', import.meta.url), 'utf8');
    await page.setContent(`<style>body{margin:0}#overlay-stage{position:relative;width:640px;height:360px}${css}</style><div id="overlay-stage"></div>`);
    await page.evaluate(() => {
      window.writes = [];
      window.akari = { state: { editPath: 'fixture', summary: { output: { width: 640, height: 360, fps: 30 }, overlays: [{
        id: 'legacy', start: 0, duration: 2, transform: { x: 0, y: 0, scale: 1, rotate: 0 },
        html: '<div style="position:absolute;left:270px;top:150px;width:100px;height:60px;background:green"></div>',
      }] } }, stageScale: () => 1, engine: { overlayWrite: async (_path, id, patch) => { window.writes.push({ id, patch }); } } };
    });
    for (const file of ['overlay-runtime.js', 'interaction.js']) await page.addScriptTag({ content: await readFile(new URL(`../src/${file}`, import.meta.url), 'utf8') });
    await page.evaluate(async () => { await window.akari.runtime.mount(window.akari.state.summary); window.akari.runtime.tick(.5, true); });
    await page.mouse.move(320, 180); await page.mouse.down();
    await page.keyboard.down('Alt'); await page.mouse.move(345, 200, { steps: 4 }); await page.mouse.up(); await page.keyboard.up('Alt');
    await page.waitForFunction(() => window.writes.length === 1);
    const moved = await page.evaluate(() => window.writes[0].patch.transform);
    assert.deepEqual(Object.keys(moved), ['x', 'y', 'scale', 'rotate']);
    assert.equal(moved.scale, 1);
    const handle = await page.evaluate(() => {
      const r = document.querySelector('.akari-interaction-handle.is-se').getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    await page.keyboard.down('Alt'); await page.mouse.move(handle.x, handle.y); await page.mouse.down();
    await page.mouse.move(handle.x + 30, handle.y + 18, { steps: 4 }); await page.mouse.up(); await page.keyboard.up('Alt');
    await page.waitForFunction(() => window.writes.length === 2);
    const resized = await page.evaluate(() => window.writes[1].patch.transform);
    assert.deepEqual(Object.keys(resized), ['x', 'y', 'scale', 'rotate']);
    assert.ok(resized.scale > 1);
  } finally { await browser.close(); }
});
