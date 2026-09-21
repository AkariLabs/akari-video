import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { launchBrowser } from './fixtures/browser.mjs';
import { applyPartMask } from '../src/parts.mjs';

const html = '<div style="position:absolute;inset:0;color:white;font:24px sans-serif"><b data-akari-part="A" style="position:absolute;left:60px;top:80px">Alpha</b><b data-akari-part="B" style="position:absolute;left:60px;top:160px">Beta</b></div>';
const overlay = (id, html) => ({ id, html, start: 0, duration: 10 });
const collapsed = [overlay('lazy', html), overlay('plain', '<b style="position:absolute;left:420px;top:240px;color:white">Outside</b>')];
const expanded = ['A', 'B'].map(part => ({ ...overlay(`lazy#${part}`, applyPartMask(html, part)[0]), parentId: 'lazy', part }));
const tree = [{ id: 'lazy', parentId: null, kind: 'bag', lazy: true, label: 'Lazy' },
  ...['A', 'B'].map(part => ({ id: `lazy#${part}`, parentId: 'lazy', kind: 'leaf', lazy: true })),
  { id: 'plain', parentId: null, kind: 'leaf' }];
const state = page => page.evaluate(() => ({ selectedId: window.akari.interaction.selectedId,
  scopeId: window.akari.interaction.scopeId, requests: window.requests,
  ids: [...document.querySelectorAll('#overlay-stage > [data-overlay-id]')].map(e => e.dataset.overlayId) }));
async function fixture(browser) {
  const page = await browser.newPage();
  await page.setViewport({ width: 640, height: 360 });
  await page.setContent('<style>body{margin:0}#overlay-stage{position:relative;width:640px;height:360px}</style><div id="overlay-stage"></div>');
  await page.evaluate(({ collapsed, expanded, tree }) => {
    window.requests = [];
    window.akari = { state: { editPath: 'fixture', summary: { output: { width: 640, height: 360 }, overlays: collapsed, tree } },
      stageScale: () => 1, engine: { overlayWrite: async () => {} } };
    // Simulate the asynchronous host response, using real shared part masks.
    // Entire production interaction/runtime scripts are loaded below, unmodified.
    let request = 0;
    window.akari.requestBagExpansion = bagId => {
      window.requests.push(bagId);
      const generation = ++request;
      setTimeout(async () => {
        if (generation !== request) return;
        const summary = { ...window.akari.state.summary,
          overlays: bagId === 'lazy' ? [...expanded, collapsed[1]] : collapsed };
        window.akari.state.summary = summary;
        await window.akari.runtime.mount(summary);
        window.akari.runtime.tick(1, true);
      }, 30);
    };
  }, { collapsed, expanded, tree });
  for (const name of ['overlay-runtime.js', 'interaction.js']) {
    await page.addScriptTag({ content: readFileSync(new URL(`../src/${name}`, import.meta.url), 'utf8') });
  }
  await page.evaluate(async () => { await window.akari.runtime.mount(window.akari.state.summary); window.akari.runtime.tick(1, true); });
  return page;
}
async function click(page, x, y, count = 1, modifiers = 0) {
  const cdp = await page.createCDPSession();
  try {
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, modifiers });
    for (let clickCount = 1; clickCount <= count; clickCount++) {
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount, modifiers });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount, modifiers });
    }
  } finally { await cdp.detach(); }
}
async function waitIds(page, ids) {
  await page.waitForFunction(ids => JSON.stringify([...document.querySelectorAll('#overlay-stage > [data-overlay-id]')]
    .map(e => e.dataset.overlayId)) === JSON.stringify(ids), {}, ids);
}
test('lazy bags request mounts only inside their scope and keep pending leaf selection', async t => {
  const browser = await launchBrowser(); t.after(() => browser.close());
  await t.test('single click stays collapsed; double click picks the pointed part; outside restores one mount', async () => {
    const page = await fixture(browser); try {
      await click(page, 80, 170);
      assert.deepEqual(await state(page), { selectedId: 'lazy', scopeId: null, requests: [], ids: ['lazy', 'plain'] });
      const frame = await page.evaluate(() => { const r = document.querySelector('.akari-interaction-selection-frame').getBoundingClientRect();
        return { width: r.width, height: r.height }; });
      assert.ok(frame.width > 0 && frame.height > 80, 'collapsed bag union includes its single mount');
      await click(page, 80, 170, 2);
      await waitIds(page, ['lazy#A', 'lazy#B', 'plain']);
      assert.equal((await state(page)).selectedId, 'lazy#B');
      assert.equal((await state(page)).scopeId, 'lazy');
      await click(page, 435, 247);
      await waitIds(page, ['lazy', 'plain']);
      assert.deepEqual((await state(page)).requests, ['lazy', null]);
      assert.equal((await state(page)).selectedId, 'plain');
    } finally { await page.close(); }
  });
  for (const gesture of ['Enter', 'Control', 'Meta']) await t.test(`${gesture} enters the lazy bag`, async () => {
    const page = await fixture(browser); try {
      if (gesture === 'Enter') { await click(page, 80, 170); await page.keyboard.press('Enter'); }
      else await click(page, 80, 170, 1, gesture === 'Meta' ? 4 : 2);
      await waitIds(page, ['lazy#A', 'lazy#B', 'plain']);
      assert.equal((await state(page)).selectedId, gesture === 'Enter' ? 'lazy#A' : 'lazy#B');
      assert.equal((await state(page)).scopeId, 'lazy');
      await page.keyboard.press('Escape');
      await waitIds(page, ['lazy', 'plain']);
      assert.equal((await state(page)).selectedId, 'lazy');
      assert.equal((await state(page)).scopeId, null);
    } finally { await page.close(); }
  });
  await t.test('blank stage exits a bag and collapses it', async () => {
    const page = await fixture(browser); try {
      await click(page, 80, 170, 1, 2); await waitIds(page, ['lazy#A', 'lazy#B', 'plain']);
      await click(page, 600, 330); await waitIds(page, ['lazy', 'plain']);
      assert.equal((await state(page)).scopeId, null);
      assert.equal((await state(page)).selectedId, null);
    } finally { await page.close(); }
  });
  await t.test('timeline selection and floor use the same lazy expansion lifecycle', async () => {
    const page = await fixture(browser); try {
      await page.evaluate(() => window.akari.interaction.selectFromTimeline('lazy#B'));
      await waitIds(page, ['lazy#A', 'lazy#B', 'plain']);
      assert.equal((await state(page)).selectedId, 'lazy#B');
      await page.evaluate(() => window.akari.interaction.setSelectionFloor(null));
      await waitIds(page, ['lazy', 'plain']);
      await page.evaluate(() => window.akari.interaction.setSelectionFloor('lazy'));
      await waitIds(page, ['lazy#A', 'lazy#B', 'plain']);
      assert.equal((await state(page)).selectedId, null);
    } finally { await page.close(); }
  });
});
