import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { launchBrowser } from './fixtures/browser.mjs';
import { applyPartMask } from '../src/parts.mjs';

const source = name => readFileSync(new URL(`../src/${name}`, import.meta.url), 'utf8');
const card = readFileSync(new URL('../../render-cut/test/fixtures/object-tree-html-bag/overlays/card.html', import.meta.url), 'utf8');
const errorText = 'この部品は文字を 1 つだけ持つ形にしてください';
const plainHtml = '<div class="plain" style="position: absolute; left: 40px; top: 40px;">Plain</div>';

async function fixture(browser, { id = 's01.C', part = 'C', html = applyPartMask(card, part)[0] } = {}) {
  const page = await browser.newPage();
  await page.setViewport({ width: 640, height: 360 });
  await page.setContent(`<style>body{margin:0}#overlay-stage{position:relative;width:640px;height:360px}${source('interaction.css')}</style><div id="overlay-stage"></div>`);
  await page.evaluate(({ id, part, html }) => {
    window.writes = []; window.errors = [];
    const nested = id === 's01.B' || id === 's01#A';
    window.akari = { state: { editPath: 'fixture', summary: {
      output: { width: 640, height: 360 },
      overlays: [{ id, html, ...(part ? { part } : {}), start: 0, duration: 10 }],
      tree: [...(nested ? [{ id: 's01', parentId: null, kind: 'bag' }] : []),
        { id, parentId: nested ? 's01' : null, kind: 'leaf' }]
    } }, stageScale: () => 1,
    showWriteError: error => window.errors.push(error.message),
    engine: { overlayWrite: async (_path, overlayId, patch) => window.writes.push({ overlayId, patch }) } };
  }, { id, part, html });
  for (const name of ['text-split.js', 'overlay-runtime.js', 'interaction.js']) await page.addScriptTag({ content: source(name) });
  await page.evaluate(async () => { await window.akari.runtime.mount(window.akari.state.summary); window.akari.runtime.tick(1, true); });
  return page;
}
async function begin(page, selector) {
  const element = await page.$(selector);
  assert.ok(element, selector);
  const box = await element.boundingBox();
  assert.ok(box, selector);
  const x = box.x + Math.min(10, box.width / 2), y = box.y + box.height / 2;
  const cdp = await page.createCDPSession();
  try {
    for (const [count, modifiers] of [[1, 2], [2, 0]]) {
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, modifiers });
      for (let clickCount = 1; clickCount <= count; clickCount++) {
        await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount, modifiers });
        await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount, modifiers });
      }
    }
  } finally { await cdp.detach(); }
  assert.equal(await page.evaluate(() => window.akari.interaction.activeEdit), true);
  assert.equal(await element.evaluate(e => document.activeElement === e && e.isContentEditable), true);
}
async function replace(page, text) {
  const cdp = await page.createCDPSession();
  try {
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', modifiers: 2, commands: ['selectAll'] });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', modifiers: 2 });
    if (text) await cdp.send('Input.insertText', { text });
    else await page.keyboard.press('Backspace');
  } finally { await cdp.detach(); }
}
const dom = page => page.evaluate(() => document.querySelector('[data-overlay-id]').firstElementChild.outerHTML);
async function commit(page) {
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => !window.akari.interaction.activeEdit);
  await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 30)));
}

test('Escape restores HTML/part/slot content, mirrors, attributes and selection without writes', async t => {
  const browser = await launchBrowser(); t.after(() => browser.close());
  for (const tree of [true, false]) for (const kind of ['html', 'part', 'slot']) {
    await t.test(`${kind}, tree=${tree}`, async () => {
      const attrs = kind === 'slot' ? 'data-akari-slot="title"' : kind === 'part' ? 'data-akari-part="C"' : '';
      const html = `<div style="position:absolute;left:40px;top:40px"><span id="edit" ${attrs} spellcheck="true">Original</span><span data-mirror="text" style="position:absolute;top:40px"><b>Mirror</b></span><span data-akari-slot="title" style="position:absolute;top:80px"><i>Duplicate</i></span></div>`;
      const page = await fixture(browser, { id: 'sample', part: kind === 'part' ? 'C' : null, html });
      try {
        if (!tree) await page.evaluate(() => { window.akari.state.summary.tree = []; });
        const original = await dom(page);
        await begin(page, '#edit'); await replace(page, 'Changed');
        assert.equal(await page.evaluate(() => document.querySelector('[data-mirror="text"]').textContent), 'Changed');
        const composing = await page.evaluate(() => {
          const event = new KeyboardEvent('keydown', { key: 'Escape', isComposing: true, bubbles: true, cancelable: true });
          document.activeElement.dispatchEvent(event);
          return { prevented: event.defaultPrevented, editing: window.akari.interaction.activeEdit, writes: window.writes };
        });
        assert.deepEqual(composing, { prevented: false, editing: true, writes: [] });
        await page.keyboard.press('Escape');
        assert.equal(await page.evaluate(() => window.akari.interaction.activeEdit), false);
        assert.equal(await page.evaluate(() => window.akari.interaction.selectedId), 'sample');
        assert.equal(await dom(page), original);
        assert.deepEqual(await page.evaluate(() => window.writes), []);
        assert.deepEqual(await page.evaluate(() => window.errors), []);
        assert.ok(await page.$('.akari-interaction-selection-frame'));
        await page.mouse.click(600, 330);
        assert.deepEqual(await page.evaluate(() => window.writes), []);
        await begin(page, '#edit'); await replace(page, 'Saved'); await commit(page);
        const writes = await page.evaluate(() => window.writes);
        assert.equal(writes.length, 1);
        if (kind === 'part') assert.deepEqual(writes[0].patch, { text: 'Saved' });
        else if (kind === 'slot') assert.deepEqual(writes[0].patch, { params: { title: 'Saved' } });
        else {
          assert.ok(writes[0].patch.html);
          assert.equal(await page.evaluate(() => document.querySelector('#edit').textContent), 'Saved');
        }
        await begin(page, '#edit'); await replace(page, 'Blurred');
        await page.evaluate(() => document.activeElement.blur());
        assert.equal(await page.evaluate(() => window.writes.length), 2);
      } finally { await page.close(); }
    });
  }
});

test('pointermove Meta disables snapping; Shift keeps corner ratio and move snap', async t => {
  const browser = await launchBrowser(); t.after(() => browser.close());
  for (const kind of ['leaf', 'group', 'resize']) await t.test(kind, async () => {
    const page = await fixture(browser, { id: 'sample', part: null,
      html: '<div id="edit" style="position:absolute;left:40px;top:40px;width:100px;height:60px;background:red">Box</div>' });
    try {
      if (kind === 'group') await page.evaluate(() => { window.akari.state.summary.tree = [
        { id: 'group', kind: 'group', parentId: null, transform: { x: 0, y: 0 } },
        { id: 'sample', kind: 'leaf', parentId: 'group' }
      ]; });
      await page.mouse.click(80, 65);
      const cdp = await page.createCDPSession();
      const start = kind === 'resize' ? await (await page.$('.akari-interaction-handle.is-nw')).boundingBox()
        : { x: 80, y: 65, width: 0, height: 0 };
      const x = start.x + start.width / 2, y = start.y + start.height / 2;
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
      const results = [];
      for (const modifiers of [0, 4, 8, 4, 0]) {
        const target = kind === 'resize' ? { x: 3, y: 18 } : { x: x - 37, y };
        await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...target, button: 'left', buttons: 1, modifiers });
        results.push(await page.evaluate(() => window.akari.interaction.fragmentBounds(document.querySelector('[data-overlay-id]')).left));
      }
      if (kind !== 'resize') assert.ok(Math.abs(results[0]) < 0.1, JSON.stringify(results));
      assert.ok(Math.abs(results[0] - results[1]) > 0.5, JSON.stringify(results));
      assert.deepEqual(results, [results[0], results[1], results[0], results[1], results[0]]);
      await page.keyboard.press('Escape');
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
      await cdp.detach();
      assert.deepEqual(await page.evaluate(() => window.writes), []);
    } finally { await page.close(); }
  });
});

test('Shift horizontal drag does not magnetize the frozen vertical axis', async () => {
  const browser = await launchBrowser();
  try {
    const page = await fixture(browser, { id: 'sample', part: null,
      html: '<div style="position:absolute;left:40px;top:40px;width:100px;height:60px;background:red">Box</div>' });
    await page.evaluate(() => document.querySelector('[data-overlay-id="sample"]')
      .style.setProperty('--y', '105px'));
    await page.mouse.move(90, 175); await page.mouse.down();
    await page.keyboard.down('Shift');
    await page.mouse.move(130, 188, { steps: 4 });
    await page.mouse.up(); await page.keyboard.up('Shift');
    const pose = await page.evaluate(() => {
      const node = document.querySelector('[data-overlay-id="sample"]');
      return { x: Number.parseFloat(node.style.getPropertyValue('--x')),
        y: Number.parseFloat(node.style.getPropertyValue('--y')) };
    });
    assert.ok(pose.x >= 39 && pose.x <= 41, JSON.stringify(pose));
    assert.equal(pose.y, 105);
    await page.close();
  } finally { await browser.close(); }
});
