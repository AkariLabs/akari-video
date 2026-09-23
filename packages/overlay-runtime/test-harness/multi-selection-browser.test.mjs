import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { launchBrowser } from './fixtures/browser.mjs';
const source = name => readFileSync(new URL('../src/' + name, import.meta.url), 'utf8');
const tree = ['a', 'b', 'c'].map(id => ({ id, kind: 'leaf', parentId: null })).concat([
  { id: 'g', kind: 'group', parentId: null, transform: { x: 0, y: 0 } },
  { id: 'nested', kind: 'leaf', parentId: 'g' }
]);
async function fixture(browser) {
  const page = await browser.newPage();
  await page.setViewport({ width: 640, height: 360 });
  await page.setContent(`<style>body{margin:0}#overlay-stage{width:640px;height:360px;position:relative}${source('interaction.css')}</style><div id="overlay-stage"></div>`);
  await page.evaluate(tree => {
    window.batches = []; window.writes = []; window.notified = [];
    window.addEventListener('akari-preview-scope-selection', e => {
      if (e.detail.notify) window.notified.push(window.akari.interaction.selectedId);
    });
    window.akari = { stageScale: () => 1, state: { editPath: 'fixture', summary: { tree,
      output: { width: 640, height: 360 }, overlays: ['a','b','c','nested'].map((id, i) => ({
        id, start: 0, duration: 10, transform: { x: 0, y: 0, scale: 1, rotate: 0 },
        html: `<div style="position:absolute;left:${40 + i * 140}px;top:100px;width:90px;height:40px;background:#acf">${id}</div>`
      })) } }, engine: {
      overlayWrite: async (_path, id, patch) => window.writes.push({ id, patch }),
      overlayWriteBatch: async writes => { window.batches.push(writes); if (window.rejectBatch) throw new Error('refused'); }
    } };
  }, tree);
  await page.addScriptTag({ content: source('overlay-runtime.js') });
  await page.addScriptTag({ content: source('interaction.js') });
  await page.evaluate(async () => { await window.akari.runtime.mount(window.akari.state.summary); window.akari.runtime.tick(1, true); });
  return page;
}
const state = page => page.evaluate(() => ({ ids: window.akari.interaction.selectedIds,
  id: window.akari.interaction.selectedId, scope: window.akari.interaction.scopeId, edit: window.akari.interaction.activeEdit }));
const pose = page => page.evaluate(() => [...document.querySelectorAll('[data-overlay-id]')].map(e => ({
  id: e.dataset.overlayId, x: parseFloat(e.style.getPropertyValue('--x')) || 0, y: parseFloat(e.style.getPropertyValue('--y')) || 0
})));
const point = (page, id) => page.evaluate(id => {
  const e = [...document.querySelectorAll('[data-overlay-id]')].find(e => e.dataset.overlayId === id);
  const r = window.akari.interaction.fragmentBounds(e); return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}, id);
async function click(page, id, modifiers = 0, count = 1) {
  const p = await point(page, id), cdp = await page.createCDPSession();
  try {
    for (let clickCount = 1; clickCount <= count; clickCount++) {
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...p, button: 'left', modifiers, clickCount });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...p, button: 'left', modifiers, clickCount });
    }
  } finally { await cdp.detach(); }
}
async function selectThree(page) { await click(page, 'a'); await click(page, 'b', 8); await click(page, 'c', 8); }
async function drag(page, id, { shift = false, cancel = false } = {}) {
  const p = await point(page, id);
  if (shift) await page.keyboard.down('Shift');
  await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.keyboard.down('Alt');
  await page.mouse.move(p.x + 23, p.y + 17, { steps: 5 });
  if (cancel) await page.keyboard.press('Escape');
  await page.mouse.up(); await page.keyboard.up('Alt');
  if (shift) await page.keyboard.up('Shift');
  await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 40)));
}
test('multi-selection native browser gestures', async t => {
  const browser = await launchBrowser(); t.after(() => browser.close());
  const scenario = async (name, action) => t.test(name, async () => {
    const page = await fixture(browser); try { await action(page); } finally { await page.close(); }
  });
  await scenario('toggle order, representative, union and member marks; no redundant representative notification', async page => {
    await selectThree(page);
    assert.deepEqual((await state(page)).ids, ['a','b','c']);
    const geometry = await page.evaluate(() => {
      const members = [...document.querySelectorAll('[data-akari-interaction-selected]')];
      const boxes = members.map(e => window.akari.interaction.fragmentBounds(e));
      const f = document.querySelector('[data-akari-selection-kind="multi"]'), r = f.getBoundingClientRect();
      return { marked: members.map(e => e.dataset.overlayId), handles: f.querySelectorAll('.akari-interaction-handle').length,
        width: r.width, expectedWidth: Math.max(...boxes.map(r => r.right)) - Math.min(...boxes.map(r => r.left)) };
    });
    assert.deepEqual(geometry.marked, ['a','b','c']); assert.equal(geometry.handles, 0);
    assert.ok(Math.abs(geometry.width - geometry.expectedWidth) < 1);
    const notified = await page.evaluate(() => window.notified);
    await click(page, 'a', 8); assert.deepEqual((await state(page)).ids, ['b','c']);
    assert.deepEqual(await page.evaluate(() => window.notified), notified);
    await click(page, 'c', 8); assert.deepEqual((await state(page)).ids, ['b']);
    await click(page, 'b', 8); assert.deepEqual((await state(page)).ids, []);
  });
  await scenario('single re-selection and null selection scope transitions retain notifications', async page => {
    await click(page, 'a');
    await page.evaluate(() => { window.notified = []; });
    await click(page, 'a');
    assert.deepEqual(await page.evaluate(() => window.notified), ['a','a'], 'pointerdown and click both retain the single-selection notification');
    await page.evaluate(() => {
      Object.assign(window.akari.state.summary.tree.find(node => node.id === 'g'), { kind: 'bag', lazy: true });
    });
    await click(page, 'nested', 2);
    await page.evaluate(() => { window.akari.interaction.clearSelection(); window.notified = []; });
    assert.equal((await state(page)).scope, 'g');
    await page.mouse.click(10, 330);
    assert.deepEqual(await state(page), { ids: [], id: null, scope: null, edit: false });
    assert.deepEqual(await page.evaluate(() => window.notified), [null], 'leaving a lazy bag reports even when selectedId remains null');
  });
  await scenario('single group drag retains background-member behavior; multi drag is guarded', async page => {
    await page.evaluate(() => { document.querySelector('[data-overlay-id="nested"]').dataset.role = 'background'; });
    await click(page, 'nested'); await drag(page, 'nested');
    assert.deepEqual(await page.evaluate(() => window.writes), [{ id: 'g', patch: { transform: { x: 23, y: 17 } } }]);
    await click(page, 'a', 8);
    assert.deepEqual((await state(page)).ids, ['g','a']);
    const before = await pose(page); await drag(page, 'a');
    assert.deepEqual(await pose(page), before);
    assert.equal(await page.evaluate(() => window.batches.length), 0);
    assert.equal(await page.evaluate(() => window.writes.length), 1);
  });
  await scenario('plain drag preserves set and emits one batch with equal translations', async page => {
    await selectThree(page); await drag(page, 'a');
    assert.deepEqual((await state(page)).ids, ['a','b','c']);
    const batches = await page.evaluate(() => window.batches);
    assert.equal(batches.length, 1); assert.equal(await page.evaluate(() => window.writes.length), 0);
    assert.deepEqual(batches[0], ['a','b','c'].map(overlayId => ({ overlayId, patch: { transform: { x: 23, y: 17 } } })));
  });
  await scenario('Shift press adds immediately and drags the new set', async page => {
    await click(page, 'a'); await drag(page, 'b', { shift: true });
    assert.deepEqual((await state(page)).ids, ['a','b']);
    assert.equal(await page.evaluate(() => window.batches[0].length), 2);
  });
  await scenario('failed batch restores every member', async page => {
    await selectThree(page); const before = await pose(page);
    await page.evaluate(() => { window.rejectBatch = true; }); await drag(page, 'a');
    assert.deepEqual(await pose(page), before);
    assert.equal(await page.evaluate(() => window.batches.length), 1);
    assert.ok((await page.evaluate(() => window.akari.state.summary.tree
      .filter(node => ['a', 'b', 'c'].includes(node.id)).every(node => node.transform === undefined))));
  });
  await scenario('nudge affects all immediately then batches once after 400ms idle', async page => {
    await selectThree(page);
    for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight');
    await page.keyboard.down('Shift'); await page.keyboard.press('ArrowDown'); await page.keyboard.up('Shift');
    assert.deepEqual((await pose(page)).slice(0,3).map(({ x,y }) => ({ x,y })), Array(3).fill({ x: 3, y: 10 }));
    assert.equal(await page.evaluate(() => window.batches.length), 0);
    await page.waitForFunction(() => window.batches.length === 1);
    assert.deepEqual(await page.evaluate(() => window.batches[0].map(w => w.patch.transform)), Array(3).fill({ x: 3,y: 10 }));
  });
  await scenario('Escape cancels drag, then collapses set, then clears', async page => {
    await selectThree(page); const before = await pose(page); await drag(page, 'a', { cancel: true });
    assert.deepEqual(await pose(page), before); assert.deepEqual((await state(page)).ids, ['a','b','c']);
    await page.keyboard.press('Escape'); assert.deepEqual((await state(page)).ids, ['c']);
    await page.keyboard.press('Escape'); assert.deepEqual((await state(page)).ids, []);
  });
  await scenario('outside scope replaces; double click and Enter collapse before drill/edit', async page => {
    await selectThree(page); await click(page, 'nested', 10);
    assert.deepEqual((await state(page)).ids, ['nested']); assert.equal((await state(page)).scope, 'g');
    await selectThree(page); await click(page, 'nested', 8);
    assert.deepEqual((await state(page)).ids, ['a','b','c','g']);
    await click(page, 'nested', 0, 2); assert.deepEqual((await state(page)).ids, ['nested']);
    await selectThree(page); await page.keyboard.press('Enter');
    assert.deepEqual((await state(page)).ids, ['c']); assert.equal((await state(page)).edit, true);
    await page.keyboard.press('Escape'); await selectThree(page); await click(page, 'a', 0, 2);
    assert.deepEqual((await state(page)).ids, ['a']); assert.equal((await state(page)).edit, true);
  });
  await scenario('group and leaf move together but save selected item identities, then timeline selection replaces', async page => {
    await click(page, 'a'); await click(page, 'nested', 8); await drag(page, 'a');
    assert.deepEqual(await page.evaluate(() => window.batches[0]), ['a','g'].map(overlayId => ({
      overlayId, patch: { transform: { x: 23, y: 17 } }
    })));
    const positions = await pose(page);
    assert.deepEqual(positions.filter(p => ['a','nested'].includes(p.id)).map(({ x,y }) => ({ x,y })), Array(2).fill({ x: 23, y: 17 }));
    assert.deepEqual(await page.evaluate(() => ['a', 'g', 'nested'].map(id => {
      const transform = window.akari.state.summary.tree.find(node => node.id === id).transform;
      return { x: transform.x, y: transform.y };
    })), Array(3).fill({ x: 23, y: 17 }));
    await page.evaluate(() => window.akari.interaction.selectFromTimeline('b'));
    assert.deepEqual((await state(page)).ids, ['b']);
    await selectThree(page); await page.mouse.click(10, 330);
    assert.deepEqual((await state(page)).ids, []);
  });
  await scenario('multi selection does not swallow toolbar clicks, including Shift', async page => {
    await page.setViewport({ width: 640, height: 420 });
    await selectThree(page);
    await page.evaluate(() => {
      const button = document.createElement('button'); button.id = 'toolbar'; button.textContent = 'Toolbar';
      Object.assign(button.style, { position: 'fixed', left: '10px', top: '380px' });
      window.toolbarClicks = 0; button.onclick = () => window.toolbarClicks++; document.body.appendChild(button);
    });
    await page.click('#toolbar'); await page.keyboard.down('Shift'); await page.click('#toolbar'); await page.keyboard.up('Shift');
    assert.equal(await page.evaluate(() => window.toolbarClicks), 2);
    assert.deepEqual((await state(page)).ids, ['a','b','c']);
  });
  await scenario('selected member has no hover and set survives runtime remount', async page => {
    await selectThree(page); const p = await point(page, 'a'); await page.mouse.move(p.x, p.y);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
    assert.equal(await page.evaluate(() => Boolean(document.querySelector('[data-akari-ui="preview-hover-frame"]:not([hidden])'))), false);
    await page.evaluate(async () => { await window.akari.runtime.mount(window.akari.state.summary); window.akari.runtime.tick(1, true);
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
    assert.deepEqual((await state(page)).ids, ['a','b','c']);
    assert.equal(await page.evaluate(() => document.querySelectorAll('[data-akari-interaction-selected]').length), 3);
  });
});
