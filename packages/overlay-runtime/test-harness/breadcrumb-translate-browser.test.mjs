import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { launchBrowser } from './fixtures/browser.mjs';

const runtime = readFileSync(new URL('../src/overlay-runtime.js', import.meta.url), 'utf8');
const interaction = readFileSync(new URL('../src/interaction.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/interaction.css', import.meta.url), 'utf8');
const fragment = '<div class="root"><div class="box" style="position:absolute;left:150px;top:90px;width:120px;height:90px;background:#18a878"></div></div>';
const decimalTranslate = /^-?\d+(?:\.\d{1,2})?px -?\d+(?:\.\d{1,2})?px$/u;

async function fixture(browser, initial = null) {
  const page = await browser.newPage();
  await page.setViewport({ width: 640, height: 360 });
  await page.setContent(`<style>body{margin:0}#overlay-stage{position:relative;width:640px;height:360px}${css}</style>
    <nav data-akari-ui="preview-scope-breadcrumb" hidden></nav><div id="overlay-stage"></div>`);
  await page.evaluate(({ fragment, initial }) => {
    window.writes = [];
    window.akari = { capabilities: { elementSelection: true }, stageScale: () => 1,
      state: { editPath: 'fixture', summary: { output: { width: 640, height: 360 },
        overlays: [{ id: 'box', html: fragment, elementSelection: true,
          elements: initial ? { '.box[0]': { tag: 'div', style: { translate: initial } } } : {},
          start: 0, duration: 20, transform: { x: 0, y: 0, scale: 1, rotate: 0 } }] } },
      engine: { overlayWrite: async (_path, id, patch) => window.writes.push({ id, patch }) } };
  }, { fragment, initial });
  await page.addScriptTag({ content: runtime });
  await page.addScriptTag({ content: interaction });
  await page.evaluate(async initial => { await window.akari.runtime.mount(window.akari.state.summary);
    window.akari.runtime.tick(1, true);
    if (initial) document.querySelector('.box').style.translate = initial;
  }, initial);
  const center = await page.evaluate(() => { const r = document.querySelector('.box').getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  await page.mouse.click(center.x, center.y);
  return page;
}

async function dragHandle(page, name, dx, dy) {
  const from = await page.evaluate(name => {
    const handle = document.querySelector(`.akari-interaction-handle.is-${name}`);
    const rect = handle.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }, name);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 4 });
  await page.mouse.up();
  return page.evaluate(() => window.writes.at(-1)?.patch.element.style ?? null);
}

test('edge residuals use two decimal translate components and omit an unchanged zero pair', async t => {
  const browser = await launchBrowser(); t.after(() => browser.close());
  for (const [name, dx, dy, axis] of [['w', 25, 0, 'x'], ['n', 0, 25, 'y'], ['e', 25, 0, null]]) {
    const page = await fixture(browser);
    const style = await dragHandle(page, name, dx, dy);
    assert.ok(style, name);
    const dimension = ['n', 's'].includes(name) ? 'height' : 'width';
    assert.match(style[dimension], /^\d+(?:\.\d{1,2})?px$/u, JSON.stringify(style));
    if (axis) {
      assert.match(style.translate, decimalTranslate);
      const [x, y] = style.translate.split(' ').map(Number.parseFloat);
      assert.equal(axis === 'x' ? y : x, 0);
    } else assert.equal(style.translate, undefined);
    await page.close();
  }
});

test('tiny authored translate, drag and arrow never send a one-value or exponent form', async t => {
  const browser = await launchBrowser(); t.after(() => browser.close());
  const page = await fixture(browser, '1e-7px 0px');
  const style = await dragHandle(page, 'w', 25, 0);
  assert.match(style.translate, decimalTranslate);
  assert.doesNotMatch(style.translate, /e[+-]?\d/iu);
  await page.keyboard.press('ArrowRight');
  await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 550)));
  const writes = await page.evaluate(() => window.writes.map(write => write.patch.element.style));
  assert.ok(writes.some(write => decimalTranslate.test(write.translate ?? '')), JSON.stringify(writes));
});

test('single-value computed translate is parsed as y zero; move and rotate write plain decimals', async t => {
  const browser = await launchBrowser(); t.after(() => browser.close());
  const page = await fixture(browser, '12px');
  await page.bringToFront();
  await page.keyboard.press('ArrowRight');
  await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 550)));
  let style = await page.evaluate(() => window.writes.at(-1)?.patch.element.style);
  assert.equal(style?.translate, '13px 0px', JSON.stringify(await page.evaluate(() => ({
    writes: window.writes, focus: window.akari.interaction.elementFocus, active: document.activeElement?.outerHTML?.slice(0, 100) }))));
  const center = await page.evaluate(() => { const r = document.querySelector('.box').getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  await page.mouse.move(center.x, center.y);
  await page.mouse.down();
  await page.mouse.move(center.x + 21, center.y + 13, { steps: 4 });
  await page.mouse.up();
  style = await page.evaluate(() => window.writes.at(-1)?.patch.element.style);
  assert.match(style.translate, decimalTranslate);
  style = await dragHandle(page, 'rotate', 20, 10);
  assert.match(style.rotate, /^[+-]?\d+(?:\.\d{1,2})?deg$/u, JSON.stringify(style));
  if (style.translate) assert.match(style.translate, decimalTranslate);
});
