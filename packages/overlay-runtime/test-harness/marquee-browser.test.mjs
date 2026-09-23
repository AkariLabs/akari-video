import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { launchBrowser } from './fixtures/browser.mjs';

const source = name => readFileSync(new URL('../src/' + name, import.meta.url), 'utf8');
async function fixture(browser, { legacy = false } = {}) {
  const page = await browser.newPage();
  await page.setViewport({ width: 720, height: 420 });
  await page.setContent(`<style>body{margin:0}#overlay-stage{width:640px;height:360px;position:relative}${source('interaction.css')}</style><div id="overlay-stage"></div>`);
  await page.evaluate(legacy => {
    const ids = ['a', 'b', 'c', 'nested', 'nested2'];
    const positions = [[50, 120], [200, 120], [350, 120], [120, 250], [280, 250]];
    window.akari = { stageScale: () => 1, state: { editPath: 'fixture', summary: {
      tree: legacy ? [] : [
        ...ids.slice(0, 3).map(id => ({ id, kind: 'leaf', parentId: null })),
        { id: 'g', kind: 'group', parentId: null },
        ...ids.slice(3).map(id => ({ id, kind: 'leaf', parentId: 'g' }))
      ],
      output: { width: 640, height: 360 },
      overlays: ids.map((id, i) => ({ id, start: 0, duration: 10,
        transform: { x: 0, y: 0, scale: 1, rotate: 0 },
        html: `<div style="position:absolute;left:${positions[i][0]}px;top:${positions[i][1]}px;width:90px;height:40px;background:#acf">${id}</div>` }))
    } }, engine: { overlayWrite: async () => undefined } };
  }, legacy);
  await page.addScriptTag({ content: source('overlay-runtime.js') });
  await page.addScriptTag({ content: source('interaction.js') });
  await page.evaluate(async () => { await window.akari.runtime.mount(window.akari.state.summary); window.akari.runtime.tick(1, true); });
  return page;
}
const ids = page => page.evaluate(() => window.akari.interaction.selectedIds);
const frame = page => page.evaluate(() => Boolean(document.querySelector('[data-akari-ui="preview-marquee"]')));
async function drag(page, from, to, { shift = false, escape = false } = {}) {
  if (shift) await page.keyboard.down('Shift');
  await page.mouse.move(...from);
  await page.mouse.down();
  await page.mouse.move(...to, { steps: 6 });
  if (escape) await page.keyboard.press('Escape');
  await page.mouse.up();
  if (shift) await page.keyboard.up('Shift');
}

test('marquee native pointer gestures', async t => {
  const browser = await launchBrowser();
  t.after(() => browser.close());
  const scenario = async (name, run, options) => t.test(name, async () => {
    const page = await fixture(browser, options);
    try { await run(page); } finally { await page.close(); }
  });
  await scenario('blank drag selects two, one, or zero and stationary blank clears', async page => {
    await drag(page, [20, 100], [290, 180]);
    assert.deepEqual(await ids(page), ['a', 'b']);
    assert.equal(await frame(page), false);
    await drag(page, [20, 100], [150, 180]);
    assert.deepEqual(await ids(page), ['a']);
    await drag(page, [20, 20], [35, 35]);
    assert.deepEqual(await ids(page), []);
    await drag(page, [20, 100], [150, 180]);
    await page.mouse.click(20, 20);
    assert.deepEqual(await ids(page), []);
  });
  await scenario('Shift adds in order and Escape preserves the original set', async page => {
    await drag(page, [20, 100], [150, 180]);
    await drag(page, [170, 100], [290, 180], { shift: true });
    assert.deepEqual(await ids(page), ['a', 'b']);
    await drag(page, [320, 100], [450, 180], { shift: true, escape: true });
    assert.deepEqual(await ids(page), ['a', 'b']);
    assert.equal(await frame(page), false);
  });
  await scenario('below four pixels stays a blank click', async page => {
    await drag(page, [20, 100], [150, 180]);
    await drag(page, [20, 20], [23, 20]);
    assert.deepEqual(await ids(page), []);
  });
  await scenario('host refusal at zoom leaves plain drag alone; Shift starts marquee', async page => {
    await page.evaluate(() => { window.akari.shouldStartPreviewMarquee = event => event.shiftKey; });
    await drag(page, [20, 100], [290, 180]);
    assert.deepEqual(await ids(page), []);
    await drag(page, [20, 100], [290, 180], { shift: true });
    assert.deepEqual(await ids(page), ['a', 'b']);
  });
  await scenario('host refusal still releases a stationary blank click', async page => {
    await page.evaluate(() => { window.akari.shouldStartPreviewMarquee = () => false; });
    await page.mouse.click(95, 140);
    assert.deepEqual(await ids(page), ['a']);
    await page.mouse.click(20, 20);
    assert.deepEqual(await ids(page), []);
  });
  await scenario('host refusal discards a blank drag without releasing selection', async page => {
    await page.evaluate(() => { window.akari.shouldStartPreviewMarquee = () => false; });
    await page.mouse.click(95, 140);
    await drag(page, [20, 20], [50, 20]);
    assert.deepEqual(await ids(page), ['a']);
    assert.equal(await frame(page), false);
  });
  await scenario('Shift click on an overlay keeps the P4a toggle even if host allows marquee', async page => {
    await page.evaluate(() => { window.akari.shouldStartPreviewMarquee = () => true; });
    await page.mouse.click(95, 140);
    await page.keyboard.down('Shift');
    await page.mouse.move(245, 140);
    await page.mouse.down();
    assert.equal(await frame(page), false);
    await page.mouse.up();
    await page.keyboard.up('Shift');
    assert.deepEqual(await ids(page), ['a', 'b']);
  });
  await scenario('stationary pasteboard click outside the stage keeps the selection', async page => {
    await page.evaluate(() => { window.akari.shouldStartPreviewMarquee = () => true; });
    await page.mouse.click(95, 140);
    await page.mouse.click(680, 380);
    assert.deepEqual(await ids(page), ['a']);
  });
  await scenario('group scope and floor limit candidates to direct children', async page => {
    await page.keyboard.down('Control');
    await page.mouse.click(160, 270);
    await page.keyboard.up('Control');
    assert.equal(await page.evaluate(() => window.akari.interaction.scopeId), 'g');
    await drag(page, [20, 230], [390, 320]);
    assert.deepEqual(await ids(page), ['nested', 'nested2']);
    await page.evaluate(() => window.akari.interaction.setSelectionFloor('g'));
    await drag(page, [20, 100], [440, 180]);
    assert.deepEqual(await ids(page), []);
    assert.equal(await page.evaluate(() => window.akari.interaction.scopeId), 'g');
  });
  await scenario('legacy tree still clears at pointerdown', async page => {
    await page.mouse.click(95, 140);
    assert.deepEqual(await ids(page), ['a']);
    await page.mouse.move(20, 20); await page.mouse.down();
    assert.deepEqual(await ids(page), []);
    await page.mouse.up();
  }, { legacy: true });
});
