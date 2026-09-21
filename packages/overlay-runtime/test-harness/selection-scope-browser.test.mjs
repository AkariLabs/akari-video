import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { launchBrowser } from './fixtures/browser.mjs';
import { applyPartMask } from '../src/parts.mjs';

const runtime = readFileSync(new URL('../src/overlay-runtime.js', import.meta.url), 'utf8');
const interaction = readFileSync(new URL('../src/interaction.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/interaction.css', import.meta.url), 'utf8');
const box = (text, left, top) => `<div style="position:absolute;left:${left}px;top:${top}px;color:white;font:20px sans-serif">${text}</div>`;
const tree = [
  { id: 'outer', parentId: null, kind: 'group', label: 'Outer', transform: { x: 0, y: 0 } },
  { id: 'g', parentId: 'outer', kind: 'group', label: 'Group', transform: { x: 0, y: 0 } },
  { id: 'a', parentId: 'g', kind: 'leaf', label: 'A' },
  { id: 'b', parentId: 'g', kind: 'leaf', label: 'B' },
  { id: 'hidden', parentId: 'g', kind: 'leaf', label: 'Hidden' },
  { id: 'bag', parentId: null, kind: 'bag', label: 'Bag', transform: { x: 0, y: 0 } },
  { id: 'bag#A', parentId: 'bag', kind: 'leaf', label: 'A' },
  { id: 'bag.B', parentId: 'bag', kind: 'leaf', label: 'B' },
  { id: 'plain', parentId: null, kind: 'leaf', label: 'Plain' }
];
const bag = '<div style="position:absolute;inset:0;color:white"><b data-akari-part="A" style="position:absolute;left:400px;top:40px">Alpha</b><b data-akari-part="B" style="position:absolute;left:400px;top:100px">Beta</b></div>';
const overlays = [
  { id: 'a', html: box('First', 70, 50) }, { id: 'b', html: box('Second', 180, 120) },
  { id: 'hidden', html: box('Hidden', 560, 280), start: 10 },
  { id: 'bag#A', html: applyPartMask(bag, 'A')[0] },
  { id: 'bag.B', html: applyPartMask(bag, 'B')[0] },
  { id: 'plain', html: box('Plain', 60, 280) }
].map(o => ({ start: 0, duration: 20, transform: { x: 0, y: 0, scale: 1, rotate: 0 }, ...o }));
async function fixture(browser, treeValue = tree) {
  const page = await browser.newPage();
  await page.setViewport({ width: 640, height: 360 });
  await page.setContent(`<style>body{margin:0;background:#111}#overlay-stage{position:relative;width:640px;height:360px}nav{position:absolute;left:10px;top:10px;z-index:100}${css}</style>
    <nav data-akari-ui="preview-scope-breadcrumb" hidden></nav><div id="overlay-stage"></div>`);
  await page.evaluate(({ overlays, treeValue }) => {
    window.writes = []; window.forwarded = []; window.selectionEvents = [];
    window.pointerTrace = [];
    for (const type of ['pointerdown','pointerup','click','dblclick']) window.addEventListener(type, event => {
      window.pointerTrace.push({type,detail:event.detail,target:event.target.outerHTML?.slice(0,120)});
    });
    // Same registration order and bubble phase as Theia's pre/main.js.
    window.addEventListener('keydown', event => window.forwarded.push(event.key));
    window.addEventListener('akari-preview-scope-selection', event => window.selectionEvents.push(event.detail));
    window.akari = { state: { editPath: 'fixture', summary: { output: { width: 640, height: 360 }, overlays,
      ...(treeValue === null ? {} : { tree: treeValue }) } }, stageScale: () => 1,
      engine: { overlayWrite: async (_path, id, patch) => {
        window.writes.push({ id, patch }); if (window.rejectWrite) throw new Error('fixture write failure');
      } } };
  }, { overlays, treeValue });
  await page.addScriptTag({ content: runtime });
  await page.addScriptTag({ content: interaction });
  await page.evaluate(async () => { await window.akari.runtime.mount(window.akari.state.summary); window.akari.runtime.tick(1, true); });
  return page;
}
const state = page => page.evaluate(() => { const a = window.akari.interaction;
  return { selectedId: a.selectedId, scopeId: a.scopeId, floorScopeId: a.floorScopeId, activeEdit: a.activeEdit }; });
const point = (page, id) => page.evaluate(id => {
  const e = [...document.querySelectorAll('[data-overlay-id]')].find(e => e.dataset.overlayId === id);
  const r = window.akari.interaction.fragmentBounds(e);
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}, id);
async function click(page, id, count = 1, modifiers = 0) {
  const p = await point(page, id), cdp = await page.createCDPSession();
  try {
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y, modifiers });
    for (let clickCount = 1; clickCount <= count; clickCount++) {
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', clickCount, modifiers });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', clickCount, modifiers });
    }
  } finally { await cdp.detach(); }
}
async function deep(page, id) { await click(page, id, 1, 2); }
async function drag(page, id, dx = 25, dy = 18) {
  const p = await point(page, id);
  await page.mouse.move(p.x, p.y); await page.mouse.down();
  // Disable snapping to make the expected pixel displacement deterministic.
  await page.keyboard.down('Alt');
  await page.mouse.move(p.x + dx, p.y + dy, { steps: 6 });
  await page.mouse.up(); await page.keyboard.up('Alt');
  await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 30)));
}
async function bounds(page) {
  return page.evaluate(() => {
    const a = window.akari.interaction;
    const rect = e => { const r = e.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom }; };
    const boxes = ['a', 'b'].map(id => a.fragmentBounds(document.querySelector(`[data-overlay-id="${id}"]`)));
    const frame = document.querySelector('.akari-interaction-selection-frame');
    return { frame: frame && rect(frame), union: { left: Math.min(...boxes.map(r => r.left)), top: Math.min(...boxes.map(r => r.top)),
      right: Math.max(...boxes.map(r => r.right)), bottom: Math.max(...boxes.map(r => r.bottom)) },
      handles: frame?.querySelectorAll('[data-akari-interaction="selection-handle"]').length };
  });
}
const near = (a, b) => Object.keys(a).every(k => Math.abs(a[k] - b[k]) < 2);

test('hierarchical interaction gestures in the classic browser runtime', async t => {
  const browser = await launchBrowser(); t.after(() => browser.close());
  await t.test('root click selects group; frame unions visible descendants only, with no handles', async () => {
    const page = await fixture(browser); try {
      await click(page, 'a');
      assert.equal((await state(page)).selectedId, 'outer');
      const geometry = await bounds(page);
      assert.ok(near(geometry.frame, geometry.union), JSON.stringify(geometry)); assert.equal(geometry.handles, 0);
      await click(page, 'a', 2);
      assert.deepEqual(await state(page), { selectedId: 'g', scopeId: 'outer', floorScopeId: null, activeEdit: false }, JSON.stringify(await page.evaluate(() => window.pointerTrace)));
      assert.match(await (await page.$('[data-akari-ui="preview-scope-breadcrumb"]')).evaluate(e => e.textContent), /全体.*Outer/u);
      await page.click('[data-akari-ui="preview-scope-breadcrumb"] button');
      assert.equal((await state(page)).scopeId, null);
      assert.equal((await state(page)).selectedId, 'outer', 'breadcrumb preserves the selected subtree');
    } finally { await page.close(); }
  });
  await t.test('group drag moves all members and emits exactly one translation-only patch', async () => {
    const page = await fixture(browser); try {
      const before = await bounds(page);
      await click(page, 'a'); await drag(page, 'a');
      const after = await bounds(page);
      assert.ok(Math.abs(after.union.left - before.union.left - 25) < 1);
      assert.ok(Math.abs(after.union.top - before.union.top - 18) < 1);
      assert.deepEqual(await page.evaluate(() => window.writes), [{ id: 'outer', patch: { transform: { x: 25, y: 18 } } }]);
    } finally { await page.close(); }
  });
  await t.test('failed group write rolls back all visible descendants', async () => {
    const page = await fixture(browser); try {
      const before = await bounds(page);
      await page.evaluate(() => { window.rejectWrite = true; });
      await click(page, 'a'); await drag(page, 'a');
      assert.ok(near((await bounds(page)).union, before.union));
    } finally { await page.close(); }
  });
  await t.test('deep selection then text edit: Esc cancels, parent, parent, clear; no forwarded Escape', async () => {
    const page = await fixture(browser); try {
      await deep(page, 'a'); await click(page, 'a', 2);
      assert.equal((await state(page)).activeEdit, true);
      await page.keyboard.type(' edited');
      const expected = [['a', 'g'], ['g', 'outer'], ['outer', null], [null, null]];
      for (const [selectedId, scopeId] of expected) {
        await page.keyboard.press('Escape');
        assert.deepEqual(await state(page), { selectedId, scopeId, floorScopeId: null, activeEdit: false });
      }
      assert.equal(await page.evaluate(() => window.forwarded.filter(k => k === 'Escape').length), 0);
      assert.deepEqual(await page.evaluate(() => window.writes), []);
      await page.keyboard.press('Escape');
      assert.equal(await page.evaluate(() => window.forwarded.filter(k => k === 'Escape').length), 1, 'idle root Esc is unhandled');
    } finally { await page.close(); }
  });
  await t.test('Enter/Shift+Enter and IME guard follow the same scope ladder', async () => {
    const page = await fixture(browser); try {
      await click(page, 'a'); await page.keyboard.press('Enter');
      assert.equal((await state(page)).selectedId, 'g');
      await page.keyboard.press('Enter'); assert.equal((await state(page)).selectedId, 'a');
      await page.keyboard.press('Enter'); assert.equal((await state(page)).activeEdit, true);
      await page.evaluate(() => document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', isComposing: true, bubbles: true })));
      assert.equal((await state(page)).activeEdit, true);
      await page.keyboard.press('Enter'); assert.equal((await state(page)).activeEdit, false);
      await page.keyboard.down('Shift'); await page.keyboard.press('Enter'); await page.keyboard.up('Shift');
      assert.equal((await state(page)).selectedId, 'g');
    } finally { await page.close(); }
  });
  await t.test('floor clamps selection; idle Escape forwards to the timeline', async () => {
    const page = await fixture(browser); try {
      await page.evaluate(() => window.akari.interaction.setSelectionFloor('g'));
      await click(page, 'a');
      for (let i = 0; i < 4; i++) await page.keyboard.press('Escape');
      assert.deepEqual(await state(page), { selectedId: null, scopeId: 'g', floorScopeId: 'g', activeEdit: false });
      assert.equal(await page.evaluate(() => window.forwarded.filter(k => k === 'Escape').length), 3);
      await click(page, 'plain'); assert.equal((await state(page)).selectedId, null);
    } finally { await page.close(); }
  });
  await t.test('masked part selection bounds are smaller than bag union and exclude hidden siblings', async () => {
    const page = await fixture(browser); try {
      await click(page, 'bag#A'); assert.equal((await state(page)).selectedId, 'bag');
      const bagRect = await (await page.$('.akari-interaction-selection-frame')).evaluate(e => ({ width: e.offsetWidth, height: e.offsetHeight }));
      await click(page, 'bag#A', 2); assert.equal((await state(page)).selectedId, 'bag#A');
      const partRect = await (await page.$('.akari-interaction-selection-frame')).evaluate(e => ({ width: e.offsetWidth, height: e.offsetHeight }));
      assert.ok(partRect.height < bagRect.height / 2);
    } finally { await page.close(); }
  });
  await t.test('scope survives remount after text commit and preserves the selected leaf', async () => {
    const page = await fixture(browser); try {
      await deep(page, 'a'); await click(page, 'a', 2); await page.keyboard.type(' remount');
      await page.keyboard.press('Enter');
      await page.evaluate(async () => {
        await window.akari.runtime.mount(window.akari.state.summary); window.akari.runtime.tick(1, true);
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      });
      assert.deepEqual(await state(page), { selectedId: 'a', scopeId: 'g', floorScopeId: null, activeEdit: false });
    } finally { await page.close(); }
  });
  await t.test('Escape during group drag cancels only the gesture, and consecutive drags accumulate', async () => {
    const page = await fixture(browser); try {
      await click(page, 'a'); const before = await bounds(page), p = await point(page, 'a');
      await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.mouse.move(p.x + 40, p.y + 30);
      await page.keyboard.press('Escape'); await page.mouse.up();
      assert.equal((await state(page)).selectedId, 'outer');
      assert.ok(near((await bounds(page)).union, before.union));
      assert.equal(await page.evaluate(() => window.writes.length), 0);
      await drag(page, 'a'); await drag(page, 'a');
      assert.deepEqual(await page.evaluate(() => window.writes.map(w => w.patch.transform)), [{ x: 25, y: 18 }, { x: 50, y: 36 }]);
    } finally { await page.close(); }
  });
  await t.test('absent tree and empty tree produce identical legacy click/drag/resize/edit/Esc traces', async () => {
    const traces = [];
    for (const treeValue of [null, []]) {
      const page = await fixture(browser, treeValue); try {
        await click(page, 'plain'); const selected = await state(page);
        await page.evaluate(() => window.akari.interaction.setSelectionFloor('plain'));
        assert.deepEqual(await state(page), selected, 'timeline focus cannot change a legacy selection');
        const handles = (await page.$$('.akari-interaction-handle')).length;
        await drag(page, 'plain');
        const handle = await page.$('.akari-interaction-handle.is-se');
        const r = await handle.boundingBox();
        await page.mouse.move(r.x + r.width / 2, r.y + r.height / 2); await page.mouse.down();
        await page.mouse.move(r.x + r.width / 2 + 15, r.y + r.height / 2 + 8, { steps: 6 }); await page.mouse.up();
        await click(page, 'plain', 2); assert.equal((await state(page)).activeEdit, true);
        await page.keyboard.type(' legacy'); await page.keyboard.press('Escape');
        const after = await state(page);
        const writes = await page.evaluate(() => window.writes);
        assert.equal(after.selectedId, 'plain'); assert.equal(after.activeEdit, false); assert.equal(handles, 4);
        assert.equal(writes.length, 2); assert.notEqual(writes[1].patch.transform.scale, 1);
        traces.push({ selected, after, writes, handles });
      } finally { await page.close(); }
    }
    assert.deepEqual(traces[0], traces[1]);
  });
});
