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

test('part text edits preserve shared HTML and reject unsafe element targets', async t => {
  const browser = await launchBrowser(); t.after(() => browser.close());
  for (const [id, part] of [['s01.C', 'C'], ['s01.B', 'B'], ['s01#A', 'A']]) {
    await t.test(`${id} emits only text for the named part itself`, async () => {
      const page = await fixture(browser, { id, part });
      try {
        await begin(page, `[data-akari-part="${part}"]`);
        await replace(page, '新しい文字 <b>&</b>'); await commit(page);
        assert.deepEqual(await page.evaluate(() => window.writes), [{ overlayId: id, patch: { text: '新しい文字 <b>&</b>' } }]);
        assert.deepEqual(await page.evaluate(() => window.errors), []);
      } finally { await page.close(); }
    });
  }
  await t.test('empty part text is saved as an empty string', async () => {
    const page = await fixture(browser);
    try {
      await begin(page, '[data-akari-part="C"]'); await replace(page, ''); await commit(page);
      assert.deepEqual(await page.evaluate(() => window.writes), [{ overlayId: 's01.C', patch: { text: '' } }]);
    } finally { await page.close(); }
  });
  const rejected = [
    ['descendant with sibling and mirror', '<div data-akari-part="C"><span id="edit">First</span><span>Second</span><span data-mirror="text">First</span></div>'],
    ['ancestor', '<div id="edit">Ancestor <span data-akari-part="C">Part</span></div>'],
    ['unrelated element', '<div><span data-akari-part="C">Part</span><span id="edit">Other</span></div>'],
    ['wrong named element', '<div><span data-akari-part="C">Part</span><span id="edit" data-akari-part="D">Other</span></div>']
  ];
  for (const [title, html] of rejected) {
    await t.test(`${title}: restore the complete fragment, report error, send no write`, async () => {
      const page = await fixture(browser, { html: `<div style="position:absolute;left:40px;top:40px">${html}</div>` });
      const consoleErrors = [];
      page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
      try {
        const original = await dom(page);
        await begin(page, '#edit'); await replace(page, 'Replacement'); await commit(page);
        assert.deepEqual(await page.evaluate(() => window.writes), []);
        assert.deepEqual(await page.evaluate(() => window.errors), [errorText]);
        assert.ok(consoleErrors.some(text => text.includes('text の永続化に失敗しました')));
        assert.equal(await dom(page), original, 'including siblings, mirrors, split DOM and editing attributes');
        // The replacement nodes must still be selectable/editable on a second attempt.
        await begin(page, '#edit'); await replace(page, 'Again'); await commit(page);
        assert.equal(await dom(page), original);
        assert.deepEqual(await page.evaluate(() => window.writes), []);
      } finally { await page.close(); }
    });
  }
  await t.test('ordinary HTML still sends exactly the serialized fragment', async () => {
    const page = await fixture(browser, { id: 'plain', part: null, html: plainHtml });
    try {
      await begin(page, '.plain'); await replace(page, 'Updated'); await commit(page);
      assert.deepEqual(await page.evaluate(() => window.writes), [{ overlayId: 'plain', patch: { html: plainHtml.replace('Plain', 'Updated') } }]);
      assert.deepEqual(await page.evaluate(() => window.errors), []);
    } finally { await page.close(); }
  });
  await t.test('slot descendant retains the params path even within a part', async () => {
    const page = await fixture(browser, { html: '<div data-akari-part="C" style="position:absolute;left:40px;top:40px"><span id="edit" data-akari-slot="title">Title</span></div>' });
    try {
      await begin(page, '#edit'); await replace(page, 'New title'); await commit(page);
      assert.deepEqual(await page.evaluate(() => window.writes), [{ overlayId: 's01.C', patch: { params: { title: 'New title' } } }]);
      assert.deepEqual(await page.evaluate(() => window.errors), []);
    } finally { await page.close(); }
  });
  await t.test('a DOM part marker alone does not change an ordinary overlay write route', async () => {
    const html = plainHtml.replace('class="plain"', 'class="plain" data-akari-part="C"');
    const page = await fixture(browser, { id: 'plain', part: null, html });
    try {
      await begin(page, '.plain'); await replace(page, 'Updated'); await commit(page);
      assert.deepEqual(await page.evaluate(() => window.writes), [{ overlayId: 'plain', patch: { html: html.replace('Plain', 'Updated') } }]);
    } finally { await page.close(); }
  });
});
