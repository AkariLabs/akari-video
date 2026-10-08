import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { launchBrowser } from './fixtures/browser.mjs';
import { BREADCRUMB_FRAGMENT, BREADCRUMB_TREE } from './fixtures/breadcrumb-compact-fixtures.mjs';

const runtime = readFileSync(new URL('../src/overlay-runtime.js', import.meta.url), 'utf8');
const interaction = readFileSync(new URL('../src/interaction.js', import.meta.url), 'utf8');
const interactionCSS = readFileSync(new URL('../src/interaction.css', import.meta.url), 'utf8');
const handler = readFileSync(new URL('../../../apps/shell/extensions/akari-preview/src/browser/akari-preview-open-handler.ts', import.meta.url), 'utf8');
const breadcrumbStart = handler.lastIndexOf('[data-akari-ui', handler.indexOf('preview-scope-breadcrumb'));
const breadcrumbCSS = handler.slice(breadcrumbStart,
  handler.indexOf('.akari-interaction-selection-frame[data', breadcrumbStart)).split('\\').join('');

async function fixture(browser, tree = BREADCRUMB_TREE, fragment = BREADCRUMB_FRAGMENT) {
  const page = await browser.newPage();
  await page.setViewport({ width: 700, height: 400 });
  await page.setContent(`<style>body{margin:0}.preview-pane{position:relative;width:640px;height:360px;overflow:hidden;background:#222}
    #overlay-stage{position:relative;width:640px;height:360px}${breadcrumbCSS}${interactionCSS}</style>
    <section class="preview-pane"><nav data-akari-ui="preview-scope-breadcrumb" hidden></nav>
    <div id="overlay-stage"></div></section>`);
  await page.evaluate(({ fragment, tree }) => {
    window.writes = [];
    window.akari = { capabilities: { elementSelection: true }, stageScale: () => 1,
      state: { editPath: 'fixture', summary: { output: { width: 640, height: 360 },
        ...(tree ? { tree } : {}),
        overlays: [{ id: 'bars', name: 'Bars', html: fragment, elementSelection: true,
          elements: {}, start: 0, duration: 20, transform: { x: 0, y: 0, scale: 1, rotate: 0 } }] } },
      engine: { overlayWrite: async (_path, id, patch) => window.writes.push({ id, patch }) } };
  }, { fragment, tree });
  await page.addScriptTag({ content: runtime });
  await page.addScriptTag({ content: interaction });
  await page.evaluate(async () => {
    await window.akari.runtime.mount(window.akari.state.summary);
    window.akari.runtime.tick(1, true);
    if (window.akari.interaction.hasSelectionTree) {
      window.akari.interaction.selectFromTimeline('bars');
      const rect = document.querySelector('.target-bar').getBoundingClientRect();
      window.akari.interaction.focusElementAtPoint('bars', rect.left + rect.width / 2, rect.top + rect.height / 2);
    }
  });
  if (!tree) {
    const point = await page.evaluate(() => { const r = document.querySelector('.target-bar').getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    await page.mouse.click(point.x, point.y);
  }
  return page;
}

const inspect = page => page.evaluate(() => {
  const nav = document.querySelector('[data-akari-ui="preview-scope-breadcrumb"]');
  const pane = document.querySelector('.preview-pane');
  const rect = node => { const r = node.getBoundingClientRect();
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; };
  return { nav: rect(nav), pane: rect(pane), text: nav.textContent,
    labels: [...nav.querySelectorAll('button')].map(button => button.textContent),
    ellipsis: [...nav.querySelectorAll('span')].some(span => span.textContent === '…'),
    background: getComputedStyle(nav).backgroundColor, lineHeight: getComputedStyle(nav).lineHeight,
    buttonRows: [...new Set([...nav.querySelectorAll('button')].map(button => Math.round(button.getBoundingClientRect().top)))] };
});

test('breadcrumb stays at the transparent lower edge and folds deeply nested levels', async t => {
  const browser = await launchBrowser(); t.after(() => browser.close());
  const page = await fixture(browser);
  const wide = await inspect(page);
  assert.equal(wide.text, '全体 › Outer group › Inner group › Bars › outer-card › inner-card › target-bar');
  assert.equal(wide.ellipsis, false);
  assert.equal(wide.background, 'rgba(0, 0, 0, 0)');
  assert.ok(wide.nav.height <= 16 && wide.pane.bottom - wide.nav.bottom <= 7, JSON.stringify(wide));
  assert.ok(wide.nav.top > wide.pane.top + 40);
  await page.evaluate(() => { document.querySelector('.preview-pane').style.width = '200px'; });
  await page.waitForFunction(() => document.querySelector('[data-akari-ui="preview-scope-breadcrumb"]').textContent.includes('…'));
  const narrow = await inspect(page);
  assert.ok(narrow.nav.height <= 16 && narrow.nav.width <= 184, JSON.stringify(narrow));
  assert.equal(narrow.buttonRows.length, 1);
  assert.equal(narrow.ellipsis, true);
  assert.deepEqual(narrow.labels.slice(-2), ['inner-card', 'target-bar']);
  await page.evaluate(() => { document.querySelector('.preview-pane').style.width = '640px'; });
  await page.waitForFunction(() => !document.querySelector('[data-akari-ui="preview-scope-breadcrumb"]').textContent.includes('…'));
  assert.equal((await inspect(page)).text, wide.text);
});

test('breadcrumb hover matches stage, group, item and element; click still navigates', async t => {
  const browser = await launchBrowser(); t.after(() => browser.close());
  const page = await fixture(browser);
  for (const [index, kind] of [[0, 'stage'], [1, 'group'], [3, 'item'], [4, 'element'], [6, 'element']]) {
    const button = await page.$(`[data-akari-ui="preview-scope-breadcrumb"] button:nth-of-type(${index + 1})`);
    await button.hover();
    const result = await page.evaluate(({ kind, index }) => {
      const frame = document.querySelector('[data-akari-ui="preview-hover-frame"]');
      const actual = frame.getBoundingClientRect();
      const target = kind === 'stage' ? document.querySelector('#overlay-stage')
        : kind === 'group' || kind === 'item' ? document.querySelector('[data-overlay-id="bars"]')
        : document.querySelector(index === 4 ? '.outer-card' : '.target-bar');
      const expected = kind === 'item' || kind === 'group'
        ? window.akari.interaction.fragmentBounds(target) : target.getBoundingClientRect();
      return { hidden: frame.hidden, mark: frame.hasAttribute('data-breadcrumb-hover'),
        actual: { left: actual.left, top: actual.top, width: actual.width, height: actual.height },
        expected: { left: expected.left, top: expected.top, width: expected.width, height: expected.height } };
    }, { kind, index });
    assert.equal(result.hidden, false, JSON.stringify(result));
    assert.equal(result.mark, true);
    for (const edge of ['left', 'top', 'width', 'height']) {
      assert.ok(Math.abs(result.actual[edge] - result.expected[edge]) <= 1, JSON.stringify({ index, result }));
    }
  }
  await page.mouse.move(680, 380);
  assert.equal(await page.evaluate(() => document.querySelector('[data-akari-ui="preview-hover-frame"]').hidden), true);
  await page.focus('[data-akari-ui="preview-scope-breadcrumb"] button:nth-of-type(4)');
  assert.equal(await page.evaluate(() => document.querySelector('[data-akari-ui="preview-hover-frame"]').hasAttribute('data-breadcrumb-hover')), true);
  await page.evaluate(() => document.activeElement.blur());
  assert.equal(await page.evaluate(() => document.querySelector('[data-akari-ui="preview-hover-frame"]').hidden), true);
  const underSeparator = await page.evaluate(() => {
    const separator = document.querySelector('.akari-breadcrumb-separator').getBoundingClientRect();
    const hit = document.elementFromPoint(separator.left + separator.width / 2, separator.top + separator.height / 2);
    return { tag: hit?.tagName, text: hit?.textContent?.slice(0, 30), inside: hit?.closest('[data-akari-ui="preview-scope-breadcrumb"]') !== null,
      pointer: getComputedStyle(document.querySelector('[data-akari-ui="preview-scope-breadcrumb"]')).pointerEvents };
  });
  assert.equal(underSeparator.inside, false, JSON.stringify(underSeparator));
  await page.click('[data-akari-ui="preview-scope-breadcrumb"] button:nth-of-type(5)');
  assert.equal(await page.evaluate(() => window.akari.interaction.elementFocus?.ref), '.outer-card[0]');
});

test('flat project item breadcrumb click over the stage keeps its item selection', async t => {
  const browser = await launchBrowser(); t.after(() => browser.close());
  const page = await fixture(browser, null);
  assert.equal(await page.evaluate(() => window.akari.interaction.elementFocus?.ref), '.target-bar[0]');
  await page.click('[data-akari-ui="preview-scope-breadcrumb"] button:nth-of-type(3)');
  assert.equal(await page.evaluate(() => window.akari.interaction.elementFocus?.ref), '.outer-card[0]');
  const targetPoint = await page.evaluate(() => { const r = document.querySelector('.target-bar').getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  await page.mouse.click(targetPoint.x, targetPoint.y);
  assert.equal(await page.evaluate(() => window.akari.interaction.elementFocus?.ref), '.target-bar[0]');
  await page.click('[data-akari-ui="preview-scope-breadcrumb"] button:nth-of-type(2)');
  const result = await page.evaluate(() => ({ selectedId: window.akari.interaction.selectedId,
    focus: window.akari.interaction.elementFocus }));
  assert.deepEqual(result, { selectedId: 'bars', focus: null });
});

test('click clears breadcrumb hover until the pointer really moves', async t => {
  const browser = await launchBrowser(); t.after(() => browser.close());
  const page = await fixture(browser);
  const selector = '[data-akari-ui="preview-scope-breadcrumb"] button:last-of-type';
  const point = await page.evaluate(selector => { const r = document.querySelector(selector).getBoundingClientRect();
    return { x: r.left + 6, y: r.top + r.height / 2 }; }, selector);
  await page.mouse.click(point.x, point.y);
  await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 500)));
  let state = await page.evaluate(() => ({ frame: document.querySelector('[data-akari-ui="preview-hover-frame"]')?.hidden,
    mark: document.querySelector('[data-akari-ui="preview-hover-frame"]')?.hasAttribute('data-breadcrumb-hover') }));
  assert.equal(state.frame, true, JSON.stringify(state));
  assert.equal(state.mark, false);
  await page.mouse.move(point.x + 3, point.y);
  state = await page.evaluate(() => ({ frame: document.querySelector('[data-akari-ui="preview-hover-frame"]')?.hidden,
    mark: document.querySelector('[data-akari-ui="preview-hover-frame"]')?.hasAttribute('data-breadcrumb-hover') }));
  assert.deepEqual(state, { frame: false, mark: true });
  await page.mouse.move(680, 380);
  assert.equal(await page.evaluate(() => document.querySelector('[data-akari-ui="preview-hover-frame"]').hidden), true);
});

test('a separator gap passes the real click to different material underneath', async t => {
  const browser = await launchBrowser(); t.after(() => browser.close());
  const fragment = BREADCRUMB_FRAGMENT.replace(/<\/div>$/u,
    '<div class="under-breadcrumb" style="position:absolute;left:0;top:338px;width:110px;height:20px;pointer-events:auto;background:#334455"></div></div>');
  const page = await fixture(browser, BREADCRUMB_TREE, fragment);
  const point = await page.evaluate(() => {
    const span = document.querySelector('.akari-breadcrumb-separator').getBoundingClientRect();
    const nav = document.querySelector('[data-akari-ui="preview-scope-breadcrumb"]').getBoundingClientRect();
    return { x: span.left + 1, y: nav.top + nav.height / 2 };
  });
  assert.equal(await page.evaluate(point => document.elementFromPoint(point.x, point.y)?.className,
    point), 'under-breadcrumb');
  await page.mouse.click(point.x, point.y);
  assert.equal(await page.evaluate(() => window.akari.interaction.elementFocus?.ref), '.under-breadcrumb[0]');
});

test('item and root breadcrumb clicks keep their established selection results and clear hover', async t => {
  const browser = await launchBrowser(); t.after(() => browser.close());
  const page = await fixture(browser);
  await page.click('[data-akari-ui="preview-scope-breadcrumb"] button:nth-of-type(4)');
  await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 500)));
  let state = await page.evaluate(() => ({ id: window.akari.interaction.selectedId,
    focus: window.akari.interaction.elementFocus,
    hover: document.querySelector('[data-akari-ui="preview-hover-frame"]')?.hasAttribute('data-breadcrumb-hover') }));
  assert.deepEqual(state, { id: 'bars', focus: null, hover: false });
  const remainingPoint = await page.evaluate(() => {
    const r = document.querySelector('[data-akari-ui="preview-scope-breadcrumb"] button').getBoundingClientRect();
    return { x: r.left + 6, y: r.top + r.height / 2 };
  });
  await page.mouse.move(remainingPoint.x, remainingPoint.y);
  await page.mouse.move(remainingPoint.x + 3, remainingPoint.y);
  assert.equal(await page.evaluate(() => document.querySelector('[data-akari-ui="preview-hover-frame"]')?.hasAttribute('data-breadcrumb-hover')), true);
  await page.mouse.move(680, 380);
  await page.evaluate(() => {
    const r = document.querySelector('.target-bar').getBoundingClientRect();
    window.akari.interaction.focusElementAtPoint('bars', r.left + r.width / 2, r.top + r.height / 2);
  });
  const rootPoint = await page.evaluate(() => {
    const r = document.querySelector('[data-akari-ui="preview-scope-breadcrumb"] button').getBoundingClientRect();
    return { x: r.left + 6, y: r.top + r.height / 2 };
  });
  await page.mouse.click(rootPoint.x, rootPoint.y);
  await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 500)));
  state = await page.evaluate(() => ({ id: window.akari.interaction.selectedId,
    focus: window.akari.interaction.elementFocus,
    hover: document.querySelector('[data-akari-ui="preview-hover-frame"]')?.hasAttribute('data-breadcrumb-hover'),
    hidden: document.querySelector('[data-akari-ui="preview-scope-breadcrumb"]').hidden }));
  assert.deepEqual(state, { id: null, focus: null, hover: false, hidden: false });
  await page.mouse.move(rootPoint.x + 3, rootPoint.y);
  assert.equal(await page.evaluate(() => document.querySelector('[data-akari-ui="preview-hover-frame"]')?.hasAttribute('data-breadcrumb-hover')), true);
  await page.mouse.move(680, 380);
  await page.evaluate(() => {
    window.akari.interaction.selectFromTimeline('bars');
    const r = document.querySelector('.target-bar').getBoundingClientRect();
    window.akari.interaction.focusElementAtPoint('bars', r.left + r.width / 2, r.top + r.height / 2);
  });
  await page.click('[data-akari-ui="preview-scope-breadcrumb"] button:nth-of-type(2)');
  await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 500)));
  state = await page.evaluate(() => ({ id: window.akari.interaction.selectedId,
    focus: window.akari.interaction.elementFocus,
    hover: document.querySelector('[data-akari-ui="preview-hover-frame"]')?.hasAttribute('data-breadcrumb-hover') }));
  assert.deepEqual(state, { id: 'outer', focus: null, hover: false });
});

test('a selection handle wins the hit test when it overlaps breadcrumb text', async t => {
  const browser = await launchBrowser(); t.after(() => browser.close());
  const page = await fixture(browser);
  await page.evaluate(() => {
    const button = document.querySelector('[data-akari-ui="preview-scope-breadcrumb"] button');
    const handle = document.querySelector('.akari-interaction-handle.is-nw');
    const b = button.getBoundingClientRect(), h = handle.getBoundingClientRect();
    document.querySelector('.target-bar').style.translate = `${b.left + b.width / 2 - h.left - h.width / 2}px ${b.top + b.height / 2 - h.top - h.height / 2}px`;
  });
  await page.waitForFunction(() => {
    const b = document.querySelector('[data-akari-ui="preview-scope-breadcrumb"] button').getBoundingClientRect();
    const h = document.querySelector('.akari-interaction-handle.is-nw').getBoundingClientRect();
    const x = h.left + h.width / 2, y = h.top + h.height / 2;
    return x >= b.left && x <= b.right && y >= b.top && y <= b.bottom;
  });
  const hit = await page.evaluate(() => { const h = document.querySelector('.akari-interaction-handle.is-nw').getBoundingClientRect();
    return document.elementFromPoint(h.left + h.width / 2, h.top + h.height / 2)?.classList.contains('akari-interaction-handle'); });
  assert.equal(hit, true);
});

test('rotated element breadcrumb hover uses the selected rotated box', async t => {
  const browser = await launchBrowser(); t.after(() => browser.close());
  const page = await fixture(browser);
  await page.evaluate(() => { document.querySelector('.target-bar').style.rotate = '30deg'; });
  await page.hover('[data-akari-ui="preview-scope-breadcrumb"] button:last-of-type');
  const geometry = await page.evaluate(() => {
    const frame = document.querySelector('[data-akari-ui="preview-hover-frame"]');
    const element = document.querySelector('.target-bar');
    const rect = element.getBoundingClientRect(), hover = frame.getBoundingClientRect();
    return { transform: frame.style.transform, marked: frame.hasAttribute('data-breadcrumb-hover'),
      centerError: Math.hypot(hover.left + hover.width / 2 - rect.left - rect.width / 2,
        hover.top + hover.height / 2 - rect.top - rect.height / 2),
      widthError: Math.abs(Number.parseFloat(frame.style.width) - element.offsetWidth),
      heightError: Math.abs(Number.parseFloat(frame.style.height) - element.offsetHeight) };
  });
  assert.equal(geometry.marked, true, JSON.stringify(geometry));
  assert.ok(Math.abs(Number.parseFloat(geometry.transform.slice(7)) - 30) <= .5, JSON.stringify(geometry));
  assert.ok(geometry.centerError <= 1 && geometry.widthError <= 1 && geometry.heightError <= 1, JSON.stringify(geometry));
});
