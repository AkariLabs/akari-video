import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { launchBrowser } from './fixtures/browser.mjs';

const source = name => readFileSync(new URL(`../src/${name}`, import.meta.url), 'utf8');
async function fixture(browser, tree) {
  const page = await browser.newPage();
  await page.setViewport({ width: 640, height: 360 });
  await page.setContent(`<style>body{margin:0}#overlay-stage{position:relative;width:640px;height:300px}${source('interaction.css')}</style><div id="overlay-stage"></div><input id="outside">`);
  await page.evaluate(tree => {
    window.forwarded = []; window.laterCapture = []; window.writes = [];
    for (const type of ['keydown', 'keyup', 'keypress']) {
      window.addEventListener(type, e => window.forwarded.push({ type, key: e.key, prevented: e.defaultPrevented }));
    }
    window.akari = { state: { editPath: 'fixture', summary: {
      output: { width: 640, height: 300 },
      overlays: [{ id: 'text', start: 0, duration: 10,
        html: '<div id="text" style="position:absolute;left:40px;top:40px;font:32px sans-serif">あいう</div>' }],
      ...(tree ? { tree: [{ id: 'text', kind: 'leaf', parentId: null }] } : {})
    } }, stageScale: () => 1,
    engine: { overlayWrite: async (_path, id, patch) => window.writes.push({ id, patch }) } };
  }, tree);
  for (const name of ['overlay-runtime.js', 'interaction.js']) await page.addScriptTag({ content: source(name) });
  await page.evaluate(async () => {
    await window.akari.runtime.mount(window.akari.state.summary); window.akari.runtime.tick(1, true);
    for (const type of ['keydown', 'keyup', 'keypress']) {
      window.addEventListener(type, e => window.laterCapture.push({ type, key: e.key }), true);
    }
  });
  return page;
}
async function begin(page) {
  const element = await page.$('#text');
  const box = await element.boundingBox();
  const cdp = await page.createCDPSession();
  try {
    const x = box.x + 10, y = box.y + box.height / 2;
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    for (const clickCount of [1, 2]) {
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount });
    }
  } finally { await cdp.detach(); }
  assert.equal(await page.evaluate(() => window.akari.interaction.activeEdit), true);
  await clearProbe(page);
}
const clearProbe = page => page.evaluate(() => { window.forwarded = []; window.laterCapture = []; });
const text = page => page.evaluate(() => document.querySelector('#text').textContent);
const writes = page => page.evaluate(() => window.writes);
async function isolated(page) {
  assert.deepEqual(await page.evaluate(() => ({ bubble: window.forwarded, capture: window.laterCapture })), { bubble: [], capture: [] });
}
async function nativeCommand(page, key, command) {
  const cdp = await page.createCDPSession();
  try {
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code: `Key${key.toUpperCase()}`,
      modifiers: process.platform === 'darwin' ? 4 : 2, commands: [command] });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code: `Key${key.toUpperCase()}`,
      modifiers: process.platform === 'darwin' ? 4 : 2 });
  } finally { await cdp.detach(); }
}

test('contenteditable keys stay local and retain native editing', async t => {
  const browser = await launchBrowser();
  t.after(async () => {
    // Some headless-shell builds leave their process alive after Browser.close.
    // Bound cleanup to the child launched by this test, never another browser.
    const timer = setTimeout(() => browser.process()?.kill('SIGKILL'), 3000);
    try { await browser.close(); } finally { clearTimeout(timer); }
  });
  for (const tree of [true, false]) {
    await t.test(`deletion, text, caret, select-all and undo; tree=${tree}`, async () => {
      const page = await fixture(browser, tree);
      try {
        await begin(page);
        await page.keyboard.press('Backspace'); assert.equal(await text(page), 'あい');
        await page.keyboard.press('ArrowLeft');
        await page.keyboard.press('Delete'); assert.equal(await text(page), 'あ');
        await page.keyboard.press('ArrowRight');
        await page.keyboard.press('Space'); await page.keyboard.type('cfvab');
        assert.equal(await text(page), 'あ cfvab');
        for (const key of ['ArrowUp', 'ArrowDown']) await page.keyboard.press(key);
        await nativeCommand(page, 'a', 'selectAll');
        assert.equal(await page.evaluate(() => window.getSelection().toString()), 'あ cfvab');
        await page.keyboard.type('X'); assert.equal(await text(page), 'X');
        await nativeCommand(page, 'z', 'undo'); assert.equal(await text(page), 'あ cfvab');
        await isolated(page);
        assert.deepEqual(await writes(page), [], 'arrows never nudge or persist while editing');
        await page.keyboard.press('Enter');
        await page.waitForFunction(() => window.writes.length === 1);
        assert.equal(await page.evaluate(() => window.akari.interaction.activeEdit), false);
        assert.match((await writes(page))[0].patch.html, /あ cfvab/);
        assert.equal(await page.evaluate(() => window.forwarded.some(e => e.type === 'keydown' && e.key === 'Enter')), false);
        await clearProbe(page); await page.keyboard.press('Delete');
        assert.deepEqual(await page.evaluate(() => window.forwarded.filter(e => e.type === 'keydown').map(e => e.key)), ['Delete']);
      } finally { await page.close(); }
    });
    await t.test(`Escape cancels, blur commits and releases forwarding; tree=${tree}`, async () => {
      const page = await fixture(browser, tree);
      try {
        await begin(page); await page.keyboard.type('changed'); await page.keyboard.press('Escape');
        assert.equal(await text(page), 'あいう'); assert.deepEqual(await writes(page), []);
        assert.equal(await page.evaluate(() => window.akari.interaction.activeEdit), false);
        assert.equal(await page.evaluate(() => window.forwarded.some(e => e.type === 'keydown')), false);
        await begin(page); await page.keyboard.press('Backspace');
        await page.focus('#outside');
        await page.waitForFunction(() => window.writes.length === 1);
        assert.match((await writes(page))[0].patch.html, /あい<\/div>/);
        await clearProbe(page);
        for (const key of ['Delete', 'Backspace', 'Space', 'c', 'f']) await page.keyboard.press(key);
        assert.deepEqual(await page.evaluate(() => window.forwarded.filter(e => e.type === 'keydown').map(e => e.key)), ['Delete', 'Backspace', ' ', 'c', 'f']);
      } finally { await page.close(); }
    });
  }
  await t.test('composing events pass through without committing/cancelling', async () => {
    const page = await fixture(browser, true);
    try {
      await begin(page);
      const defaults = await page.evaluate(() => {
        const element = document.querySelector('#text');
        return ['keydown', 'keyup', 'keypress'].flatMap(type => ['Enter', 'Escape', 'Backspace'].map(key => {
          const event = new KeyboardEvent(type, { key, isComposing: true, bubbles: true, cancelable: true });
          element.dispatchEvent(event); return event.defaultPrevented;
        }));
      });
      assert.deepEqual(defaults, Array(9).fill(false));
      assert.equal(await page.evaluate(() => window.forwarded.length), 9);
      assert.equal(await page.evaluate(() => window.akari.interaction.activeEdit), true);
      assert.deepEqual(await writes(page), []);
    } finally { await page.close(); }
  });
});
