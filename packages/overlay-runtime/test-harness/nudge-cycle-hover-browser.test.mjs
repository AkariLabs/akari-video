import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import { launchBrowser } from './fixtures/browser.mjs';
import { nextCycleCandidate } from '../src/selection-scope.mjs';

const source = name => readFileSync(new URL(`../src/${name}`, import.meta.url), 'utf8');
async function fixture(browser, { group = false, background = false, scale = 1 } = {}) {
  const page = await browser.newPage();
  await page.setViewport({ width: 800, height: 600 });
  await page.setContent(`<style>body{margin:0}#overlay-stage{position:relative;width:640px;height:360px;transform-origin:0 0;transform:scale(${scale})}${source('interaction.css')}</style><div id="overlay-stage"></div><input id="field">`);
  await page.evaluate(({ group, background, scale }) => {
    const overlays = ['back', 'front'].map((id, i) => ({ id, start: 0, duration: 20,
      role: background ? 'background' : undefined,
      transform: { x: 0, y: 0, scale: 1, rotate: 0 },
      html: `<div style="position:absolute;left:${50 + i * 20}px;top:50px;width:160px;height:90px;background:${i ? 'blue' : 'red'}">${id}</div>` }));
    window.writes = []; window.forwarded = [];
    window.addEventListener('keydown', event => window.forwarded.push(event.key));
    window.akari = { stageScale: () => scale,
      state: { editPath: 'fixture', summary: { output: { width: 640, height: 360 }, overlays,
        tree: [...(group ? [{ id: 'group', kind: 'group', parentId: null, transform: { x: 0, y: 0 } }] : []),
          ...overlays.map(o => ({ id: o.id, kind: 'leaf', parentId: group ? 'group' : null }))] } },
      engine: { overlayWrite: async (_path, id, patch) => { window.writes.push({ id, patch }); return {}; } } };
  }, { group, background, scale });
  for (const name of ['overlay-runtime.js', 'interaction.js']) await page.addScriptTag({ content: source(name) });
  await page.evaluate(async () => { await window.akari.runtime.mount(window.akari.state.summary); window.akari.runtime.tick(1, true); });
  return page;
}
const state = page => page.evaluate(() => ({ selected: window.akari.interaction.selectedId, scope: window.akari.interaction.scopeId }));
const writes = page => page.evaluate(() => window.writes);
async function click(page, count = 1, modifiers = 0, x = 110, y = 90) {
  const cdp = await page.createCDPSession();
  try {
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, modifiers });
    for (let clickCount = 1; clickCount <= count; clickCount++) {
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount, modifiers });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount, modifiers });
    }
  } finally { await cdp.detach(); }
}
async function hover(page) {
  await sleep(40);
  return page.evaluate(() => {
    const e = document.querySelector('[data-akari-ui="preview-hover-frame"]');
    const rect = e?.getBoundingClientRect();
    return e && !e.hidden ? { id: e.dataset.overlayId, left: rect.left, width: rect.width,
      pointerEvents: getComputedStyle(e).pointerEvents } : null;
  });
}

test('cycle pure helper advances, wraps, handles missing/empty candidates', () => {
  assert.equal(nextCycleCandidate(['front', 'back'], 'front'), 'back');
  assert.equal(nextCycleCandidate(['front', 'back'], 'back'), 'front');
  assert.equal(nextCycleCandidate(['front'], 'front'), 'front');
  assert.equal(nextCycleCandidate(['front', 'back'], 'missing'), 'front');
  assert.equal(nextCycleCandidate([], 'missing'), null);
});

test('nudge/cycle/hover through native browser gestures', async t => {
  const browser = await launchBrowser(); t.after(() => browser.close());
  for (const group of [false, true]) await t.test(`nudge output pixels, one idle write; group=${group}`, async () => {
    const page = await fixture(browser, { group, scale: .5 });
    try {
      await click(page, 1, 0, 55, 45);
      for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight');
      await page.keyboard.down('Shift'); await page.keyboard.press('ArrowDown'); await page.keyboard.up('Shift');
      const pose = await page.evaluate(() => {
        const e = document.querySelector('[data-overlay-id="front"]');
        return { x: parseFloat(e.style.getPropertyValue('--x')), y: parseFloat(e.style.getPropertyValue('--y')) };
      });
      assert.deepEqual(pose, { x: 3, y: 10 });
      assert.deepEqual(await writes(page), []);
      await sleep(250); assert.deepEqual(await writes(page), []);
      await page.keyboard.press('ArrowLeft'); // Resets the entire 400ms idle window.
      await sleep(250); assert.deepEqual(await writes(page), []);
      await sleep(230);
      const saved = await writes(page);
      assert.equal(saved.length, 1); assert.equal(saved[0].id, group ? 'group' : 'front');
      assert.equal(saved[0].patch.transform.x, 2); assert.equal(saved[0].patch.transform.y, 10);
      assert.deepEqual(await page.evaluate(() => window.forwarded.filter(k => k.startsWith('Arrow'))), []);
      await page.keyboard.press('ArrowRight'); await sleep(450);
      assert.equal((await writes(page))[1].patch.transform.x, 3, 'consecutive sessions accumulate');
    } finally { await page.close(); }
  });
  await t.test('background, modifiers, form controls and text editing never nudge', async () => {
    for (const background of [false, true]) {
      const page = await fixture(browser, { background });
      try {
        await click(page);
        if (background) await page.keyboard.press('ArrowRight');
        else {
          for (const modifier of ['Alt', 'Control', 'Meta']) {
            await page.keyboard.down(modifier); await page.keyboard.press('ArrowRight'); await page.keyboard.up(modifier);
          }
          await page.focus('#field'); await page.keyboard.press('ArrowRight');
          await click(page, 2); await page.keyboard.press('ArrowRight');
        }
        await sleep(450); assert.deepEqual(await writes(page), []);
      } finally { await page.close(); }
    }
  });
  await t.test('three single clicks cycle front/back/front; modifiers, distance and timeout reset', async () => {
    const page = await fixture(browser);
    try {
      for (const selected of ['front', 'back', 'front']) { await click(page); assert.equal((await state(page)).selected, selected); }
      await click(page, 1, 8); assert.equal((await state(page)).selected, 'front');
      await click(page); assert.equal((await state(page)).selected, 'front');
      await sleep(650); await click(page); assert.equal((await state(page)).selected, 'front');
      await click(page, 1, 0, 120); assert.equal((await state(page)).selected, 'front');
      assert.deepEqual(await writes(page), []);
    } finally { await page.close(); }
  });
  await t.test('double click enters group without cycling into a sibling; inside scope cycles leaves', async () => {
    const page = await fixture(browser, { group: true });
    try {
      await click(page, 2); assert.deepEqual(await state(page), { selected: 'front', scope: 'group' });
      await click(page); await click(page); assert.equal((await state(page)).selected, 'back');
      await click(page, 2); assert.deepEqual(await state(page), { selected: 'front', scope: 'group' });
      assert.equal(await page.evaluate(() => window.akari.interaction.activeEdit), true);
    } finally { await page.close(); }
  });
  await t.test('hover uses scoped union, hides selected targets, editing, dragging and empty space', async () => {
    const page = await fixture(browser, { group: true });
    try {
      await page.mouse.move(110, 90);
      assert.deepEqual(await hover(page), { id: 'group', left: 50, width: 180, pointerEvents: 'none' });
      await click(page); assert.equal(await hover(page), null);
      await page.keyboard.press('Enter'); await page.mouse.move(110, 90);
      assert.equal((await hover(page)).id, 'front');
      await click(page); assert.equal(await hover(page), null);
      await page.mouse.move(55, 90); assert.equal((await hover(page)).id, 'back');
      await page.mouse.down(); assert.equal(await hover(page), null);
      await page.mouse.up(); await page.mouse.move(600, 330); assert.equal(await hover(page), null);
      await click(page, 2); await page.mouse.move(55, 90); assert.equal(await hover(page), null);
    } finally { await page.close(); }
  });
});
