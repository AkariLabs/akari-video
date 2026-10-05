import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { launchBrowser } from './fixtures/browser.mjs';

const source = name => readFileSync(new URL(`../src/${name}`, import.meta.url), 'utf8');

async function fixture(browser, split = false, clipped = false) {
  const page = await browser.newPage();
  await page.setViewport({ width: 640, height: 360 });
  await page.setContent(`<style>body{margin:0}#overlay-stage{position:relative;width:640px;height:360px}${source('interaction.css')}</style><div id="overlay-stage"></div>`);
  await page.evaluate(({ split, clipped }) => {
    const paint = clipped ? 'background:linear-gradient(#5b0000,#a31b18);background-clip:text;color:transparent;' : '';
    const html = `<div id="text" ${split ? 'data-akari-split="chars"' : ''} style="position:absolute;left:40px;top:40px;font:32px sans-serif;${paint}">ABCDE</div>`;
    window.writes = [];
    window.akari = { state: { editPath: 'fixture', summary: {
      output: { width: 640, height: 360 },
      overlays: [{ id: 'text', html, start: 0, duration: 10 }],
      tree: [{ id: 'text', kind: 'leaf', parentId: null }],
    } }, stageScale: () => 1,
    engine: { overlayWrite: async (_path, _id, patch) => { window.writes.push(patch); } } };
  }, { split, clipped });
  for (const name of ['text-split.js', 'overlay-runtime.js', 'interaction.js']) {
    await page.addScriptTag({ content: source(name) });
  }
  await page.evaluate(async () => {
    await window.akari.runtime.mount(window.akari.state.summary);
    window.akari.runtime.tick(1, true);
  });
  return page;
}

async function click(page, x, y, count = 1) {
  const cdp = await page.createCDPSession();
  try {
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    for (const clickCount of count === 2 ? [1, 2] : [1]) {
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount });
    }
  } finally { await cdp.detach(); }
}

const caret = page => page.evaluate(() => {
  const element = document.querySelector('#text');
  const selection = window.getSelection();
  let offset = null;
  if (selection.anchorNode && element.contains(selection.anchorNode)) {
    const beforeCaret = document.createRange();
    beforeCaret.selectNodeContents(element);
    beforeCaret.setEnd(selection.anchorNode, selection.anchorOffset);
    offset = beforeCaret.toString().length;
  }
  return {
    active: document.activeElement === element,
    editing: element.getAttribute('data-akari-interaction-editing'),
    rangeCount: selection.rangeCount,
    collapsed: selection.rangeCount === 1 && selection.getRangeAt(0).collapsed,
    inText: element.contains(selection.anchorNode),
    offset,
    text: element.textContent,
    children: element.children.length,
    selectionFrame: !!document.querySelector('.akari-interaction-selection-frame'),
  };
});

test('double click places the caret at the clicked character after split collapse; Enter uses the end',
  { skip: !process.env.CHROME_BIN }, async t => {
    process.env.CHROME_PATH ??= process.env.CHROME_BIN;
    const browser = await launchBrowser();
    t.after(async () => {
      const timer = setTimeout(() => browser.process()?.kill('SIGKILL'), 3000);
      try { await browser.close(); } finally { clearTimeout(timer); }
    });

    for (const split of [false, true]) {
      await t.test(`double click near the first letter, split=${split}`, async () => {
        const page = await fixture(browser, split);
        try {
          if (split) {
            assert.ok(await page.evaluate(() => document.querySelector('#text').querySelectorAll('.akari-u').length > 0));
          }
          const point = await page.evaluate(() => {
            const text = document.querySelector('#text').querySelector('.akari-u')?.firstChild
              ?? document.querySelector('#text').firstChild;
            const range = document.createRange();
            range.setStart(text, 0); range.setEnd(text, 1);
            const rect = range.getBoundingClientRect();
            return { x: rect.right - 1, y: rect.top + rect.height / 2 };
          });
          await click(page, point.x, point.y, 2);
          const position = await caret(page);
          assert.equal(position.active, true);
          assert.equal(position.editing, 'true');
          assert.equal(position.rangeCount, 1);
          assert.equal(position.collapsed, true);
          assert.equal(position.inText, true);
          assert.equal(position.offset, 1);
          assert.equal(position.children, 0);
          assert.equal(position.selectionFrame, true);
          await page.keyboard.type('X');
          assert.equal((await caret(page)).text, 'AXBCDE');
        } finally { await page.close(); }
      });
    }

    await t.test('glyph geometry handles a point claimed by another layer', async () => {
      const page = await fixture(browser);
      try {
        await page.evaluate(() => {
          Object.defineProperty(document, 'caretPositionFromPoint', {
            configurable: true,
            value: () => ({ offsetNode: document.body, offset: 0 }),
          });
          Object.defineProperty(document, 'caretRangeFromPoint', {
            configurable: true,
            value: () => { const range = document.createRange(); range.setStart(document.body, 0); return range; },
          });
        });
        const point = await page.evaluate(() => {
          const range = document.createRange();
          range.setStart(document.querySelector('#text').firstChild, 0);
          range.setEnd(document.querySelector('#text').firstChild, 1);
          const rect = range.getBoundingClientRect();
          return { x: rect.right - 1, y: rect.top + rect.height / 2 };
        });
        await click(page, point.x, point.y, 2);
        assert.equal((await caret(page)).offset, 1);
        await page.keyboard.type('X');
        assert.equal((await caret(page)).text, 'AXBCDE');
      } finally { await page.close(); }
    });

    await t.test('the visible caret stays outside gradient-clipped text and is removed on exit', async () => {
      const page = await fixture(browser, false, true);
      try {
        const point = await page.evaluate(() => {
          const range = document.createRange();
          range.setStart(document.querySelector('#text').firstChild, 0);
          range.setEnd(document.querySelector('#text').firstChild, 1);
          const rect = range.getBoundingClientRect();
          return { x: rect.right - 1, y: rect.top + rect.height / 2 };
        });
        await click(page, point.x, point.y, 2);
        const overlay = await page.evaluate(() => {
          const element = document.querySelector('#text');
          const caret = document.querySelector('.akari-interaction-edit-caret');
          const range = window.getSelection().getRangeAt(0);
          const rangeRect = range.getClientRects()[0] ?? range.getBoundingClientRect();
          const caretRect = caret.getBoundingClientRect();
          const caretStyle = getComputedStyle(caret);
          return {
            count: document.querySelectorAll('.akari-interaction-edit-caret').length,
            marker: caret.getAttribute('data-akari-interaction'),
            clip: getComputedStyle(element).backgroundClip,
            color: getComputedStyle(element).color,
            outsideFragment: !element.closest('[data-overlay-id]').contains(caret),
            display: caret.style.display,
            position: caretStyle.position,
            pointerEvents: caretStyle.pointerEvents,
            zIndex: caretStyle.zIndex,
            background: caretStyle.backgroundColor,
            width: caretRect.width,
            animations: caret.getAnimations().length,
            xDifference: Math.abs(caretRect.left - rangeRect.left),
            topDifference: Math.abs(caretRect.top - rangeRect.top),
            heightDifference: Math.abs(caretRect.height - rangeRect.height),
          };
        });
        assert.equal(overlay.count, 1);
        assert.equal(overlay.marker, 'edit-caret');
        assert.equal(overlay.clip, 'text');
        assert.match(overlay.color, /^(?:transparent|rgba\(0, 0, 0, 0\))$/u);
        assert.equal(overlay.outsideFragment, true);
        assert.equal(overlay.display, 'block');
        assert.equal(overlay.position, 'fixed');
        assert.equal(overlay.pointerEvents, 'none');
        assert.equal(overlay.zIndex, '2147483647');
        assert.equal(overlay.background, 'rgb(77, 190, 255)');
        assert.equal(overlay.width, 2);
        assert.equal(overlay.animations, 1);
        assert.ok(overlay.xDifference <= 2);
        assert.ok(overlay.topDifference <= 2);
        assert.ok(overlay.heightDifference <= 2);

        assert.equal(await page.evaluate(() => {
          const text = document.querySelector('#text').firstChild;
          const range = document.createRange();
          range.setStart(text, 0); range.setEnd(text, 2);
          const selection = window.getSelection();
          selection.removeAllRanges(); selection.addRange(range);
          document.dispatchEvent(new Event('selectionchange'));
          return document.querySelector('.akari-interaction-edit-caret').style.display;
        }), 'none');
        await page.keyboard.press('Escape');
        assert.equal(await page.evaluate(() => document.querySelectorAll('.akari-interaction-edit-caret').length), 0);

        await click(page, point.x, point.y, 2);
        await page.keyboard.type('X');
        await page.keyboard.press('Enter');
        await page.waitForFunction(() => window.writes.length === 1);
        const saved = await page.evaluate(() => ({
          count: document.querySelectorAll('.akari-interaction-edit-caret').length,
          html: window.writes[0].html,
        }));
        assert.equal(saved.count, 0);
        assert.match(saved.html, /AXBCDE/u);
        assert.doesNotMatch(saved.html, /akari-interaction-edit-caret/u);
      } finally { await page.close(); }
    });

    await t.test('Enter starts editing at the end', async () => {
      const page = await fixture(browser);
      try {
        const box = await (await page.$('#text')).boundingBox();
        await click(page, box.x + 8, box.y + box.height / 2);
        await page.keyboard.press('Enter');
        const position = await caret(page);
        assert.equal(position.active, true);
        assert.equal(position.rangeCount, 1);
        assert.equal(position.collapsed, true);
        assert.equal(position.offset, 5);
        await page.keyboard.type('X');
        assert.equal((await caret(page)).text, 'ABCDEX');
      } finally { await page.close(); }
    });
  });
