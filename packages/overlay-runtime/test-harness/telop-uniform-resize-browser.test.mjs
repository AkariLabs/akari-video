import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { launchBrowser } from './fixtures/browser.mjs';

const source = name => readFileSync(new URL('../src/' + name, import.meta.url), 'utf8');
const telopHtml = '<div style="position:absolute;left:70px;top:90px;width:140px;height:70px;background:#e66">Telop</div>';
const ordinaryHtml = '<div style="position:absolute;left:390px;top:90px;width:120px;height:70px;background:#6ae">Ordinary</div>';

async function fixture(browser, nonuniform = false, withGeometry = true) {
  const page = await browser.newPage();
  await page.setViewport({ width: 640, height: 360 });
  await page.setContent('<style>body{margin:0}#overlay-stage{position:relative;width:640px;height:360px}'
    + source('interaction.css') + '</style><div id="overlay-stage"></div>');
  await page.evaluate(({ telopHtml, ordinaryHtml, nonuniform }) => {
    window.writes = [];
    const telopTransform = nonuniform ? { x: 0, y: 0, scale: 1, scaleX: 1.6, scaleY: 1, rotate: 0 }
      : { x: 0, y: 0, scale: 1, rotate: 0 };
    window.akari = { state: { editPath: 'fixture', summary: {
      output: { width: 640, height: 360 },
      overlays: [
        { id: 'overlay-1', sourcePath: 'assets/overlay/telop-sample/fragment.html',
          html: telopHtml, start: 0, duration: 10, transform: telopTransform },
        { id: 'overlay-2', html: ordinaryHtml, start: 0, duration: 10,
          transform: { x: 0, y: 0, scale: 1, rotate: 0 } }
      ],
      tree: [
        { id: 'overlay-1', kind: 'leaf', parentId: null, transform: telopTransform },
        { id: 'overlay-2', kind: 'leaf', parentId: null, transform: { x: 0, y: 0, scale: 1, rotate: 0 } }
      ]
    } }, stageScale: () => 1, engine: { overlayWrite: async (_path, id, patch) => {
      window.writes.push({ id, patch });
    } } };
  }, { telopHtml, ordinaryHtml, nonuniform });
  for (const name of ['text-split.js', 'overlay-runtime.js',
    ...(withGeometry ? ['handle-geometry.js'] : []), 'interaction.js']) {
    await page.addScriptTag({ content: source(name) });
  }
  await page.evaluate(async () => {
    await window.akari.runtime.mount(window.akari.state.summary);
    window.akari.runtime.tick(1, true);
  });
  return page;
}

async function select(page, id) {
  const point = await page.evaluate(id => {
    const container = document.querySelector('[data-overlay-id="' + id + '"]');
    const rect = window.akari.interaction.fragmentBounds(container);
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }, id);
  await page.mouse.click(point.x, point.y);
  await page.waitForFunction(id => window.akari.interaction.selectedId === id, {}, id);
}

async function handles(page) {
  return page.evaluate(() => {
    const frame = document.querySelector('.akari-interaction-selection-frame:not([hidden])');
    return Object.fromEntries(['nw', 'ne', 'sw', 'se', 'n', 'e', 's', 'w'].map(name => {
      const node = frame.querySelector('.akari-interaction-handle.is-' + name);
      const rect = node.getBoundingClientRect();
      return [name, { visible: getComputedStyle(node).display !== 'none',
        x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }];
    }));
  });
}

async function dragCorner(page, point) {
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  const hint = await page.evaluate(() => document.querySelector('[data-akari-interaction="handle-hint"]')?.textContent);
  await page.mouse.move(point.x + 35, point.y + 20, { steps: 8 });
  await page.mouse.up();
  await page.waitForFunction(() => window.writes.length > 0);
  return { hint, writes: await page.evaluate(() => window.writes) };
}

test('telop edges are hidden and corner resize writes a uniform scale', async t => {
  const browser = await launchBrowser();
  t.after(() => browser.close());
  for (const withGeometry of [true, false]) await t.test(`handle geometry=${withGeometry}`, async () => {
    const page = await fixture(browser, false, withGeometry);
    try {
      await select(page, 'overlay-1');
      const telopHandles = await handles(page);
      for (const edge of ['n', 'e', 's', 'w']) assert.equal(telopHandles[edge].visible, false, edge);
      for (const corner of ['nw', 'ne', 'sw', 'se']) assert.equal(telopHandles[corner].visible, true, corner);
      const { hint, writes } = await dragCorner(page, telopHandles.se);
      assert.equal(hint, 'サイズ');
      const transform = writes.at(-1).patch.transform;
      assert.ok(Number.isFinite(transform.scale));
      assert.equal(transform.scaleX, undefined);
      assert.equal(transform.scaleY, undefined);
      await select(page, 'overlay-2');
      const ordinaryHandles = await handles(page);
      for (const edge of ['n', 'e', 's', 'w']) assert.equal(ordinaryHandles[edge].visible, true, edge);
    } finally { await page.close(); }
  });
});

test('saved nonuniform telop is unchanged on mount and converges on corner drag', async t => {
  const browser = await launchBrowser();
  t.after(() => browser.close());
  for (const withGeometry of [true, false]) await t.test(`handle geometry=${withGeometry}`, async () => {
    const page = await fixture(browser, true, withGeometry);
    try {
      assert.equal((await page.evaluate(() => window.writes)).length, 0);
      const initial = await page.evaluate(() => {
        const style = document.querySelector('[data-overlay-id="overlay-1"]').style;
        return [style.getPropertyValue('--scale-x'), style.getPropertyValue('--scale-y')];
      });
      assert.deepEqual(initial, ['1.6', '1']);
      await select(page, 'overlay-1');
      const { writes } = await dragCorner(page, (await handles(page)).se);
      const transform = writes.at(-1).patch.transform;
      assert.ok(Number.isFinite(transform.scale));
      assert.equal(transform.scaleX, undefined);
      assert.equal(transform.scaleY, undefined);
    } finally { await page.close(); }
  });
});
