import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { launchBrowser } from './fixtures/browser.mjs';

const source = name => readFileSync(new URL(`../src/${name}`, import.meta.url), 'utf8');
const html = '<div style="position:absolute;left:220px;top:125px;width:140px;height:80px;background:#e66">Leaf</div>';

async function fixture(browser, rotate = 0, group = false) {
  const page = await browser.newPage();
  await page.setViewport({ width: 640, height: 360 });
  await page.setContent(`<style>body{margin:0}#overlay-stage{position:relative;width:640px;height:360px}${source('interaction.css')}</style><div id="overlay-stage"></div>`);
  await page.evaluate(({ html, rotate, group }) => {
    window.writes = [];
    const parentKind = group === 'bag' ? 'bag' : 'group';
    const tree = group && group !== 'multi' ? [{ id: 'group', kind: parentKind, parentId: null,
      transform: { x: 0, y: 0, scale: 1, rotate: 0 } },
      { id: 'leaf', kind: 'leaf', parentId: 'group', transform: { x: 0, y: 0, scale: 1, rotate } }]
      : [{ id: 'leaf', kind: 'leaf', parentId: null, transform: { x: 0, y: 0, scale: 1, rotate } },
      ...(group === 'multi' ? [{ id: 'other', kind: 'leaf', parentId: null }] : [])];
    window.akari = { state: { editPath: 'fixture', summary: { output: { width: 640, height: 360 },
      overlays: [{ id: 'leaf', html, start: 0, duration: 10, transform: { x: 0, y: 0, scale: 1, rotate } },
        ...(group === 'multi' ? [{ id: 'other', html: '<div style="position:absolute;left:40px;top:40px;width:60px;height:40px;background:blue">Other</div>',
          start: 0, duration: 10 }] : [])], tree } },
      stageScale: () => 1, engine: { overlayWrite: async (_path, id, patch) => {
        window.writes.push({ id, patch });
        if (window.rejectWrite) throw new Error('fixture write failure');
      } } };
  }, { html, rotate, group });
  for (const name of ['text-split.js', 'overlay-runtime.js', 'interaction.js']) {
    await page.addScriptTag({ content: source(name) });
  }
  await page.evaluate(async () => { await window.akari.runtime.mount(window.akari.state.summary); window.akari.runtime.tick(1, true); });
  const hit = await page.evaluate(() => {
    const rect = window.akari.interaction.fragmentBounds(document.querySelector('[data-overlay-id]'));
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  });
  await page.mouse.click(hit.x, hit.y);
  if (group === 'multi') {
    const other = await page.evaluate(() => {
      const rect = window.akari.interaction.fragmentBounds(document.querySelector('[data-overlay-id="other"]'));
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    });
    await page.keyboard.down('Shift');
    await page.mouse.click(other.x, other.y);
    await page.keyboard.up('Shift');
  }
  return page;
}

async function frame(page) {
  return page.evaluate(() => {
    const box = document.querySelector('.akari-interaction-selection-frame:not([hidden])');
    const names = ['nw', 'ne', 'se', 'sw', 'n', 'e', 's', 'w', 'rotate'];
    const points = Object.fromEntries(names.map(name => {
      const node = box?.querySelector(`.akari-interaction-handle.is-${name}`);
      const rect = node?.getBoundingClientRect();
      return [name, node && getComputedStyle(node).display !== 'none'
        ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : null];
    }));
    return { points, transform: box?.style.transform };
  });
}

async function drag(page, from, dx, dy, shift = false) {
  const cdp = await page.createCDPSession();
  const modifiers = shift ? 8 : 0;
  try {
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...from });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...from, button: 'left', buttons: 1, clickCount: 1, modifiers });
    for (let i = 1; i <= 8; i++) {
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x + dx * i / 8,
        y: from.y + dy * i / 8, button: 'left', buttons: 1, modifiers });
    }
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: from.x + dx, y: from.y + dy,
      button: 'left', clickCount: 1, modifiers });
  } finally { await cdp.detach(); }
  return page.evaluate(() => window.writes);
}

const near = (a, b, tolerance = 0.5) => assert.ok(Math.abs(a - b) < tolerance, `${a} != ${b}`);

test('leaf X/Y edge handles keep the opposite edge fixed at 0, 30 and 90 degrees', async t => {
  const browser = await launchBrowser(); t.after(() => browser.close());
  for (const angle of [0, 30, 90]) for (const edge of ['e', 's']) await t.test(`${angle}° ${edge}`, async () => {
    const page = await fixture(browser, angle);
    try {
      const before = await frame(page);
      assert.equal(Object.values(before.points).filter(Boolean).length, 9);
      if (angle) assert.match(before.transform, /rotate/);
      const radians = angle * Math.PI / 180;
      const direction = edge === 'e' ? { x: Math.cos(radians), y: Math.sin(radians) }
        : { x: -Math.sin(radians), y: Math.cos(radians) };
      const writes = await drag(page, before.points[edge], direction.x * 32, direction.y * 32);
      assert.equal(writes.length, 1);
      const transform = writes[0].patch.transform;
      assert.ok(transform[edge === 'e' ? 'scaleX' : 'scaleY'] > 1, JSON.stringify(transform));
      assert.equal(transform[edge === 'e' ? 'scaleY' : 'scaleX'], undefined);
      const after = await frame(page);
      const opposite = edge === 'e' ? 'w' : 'n';
      near(after.points[opposite].x, before.points[opposite].x);
      near(after.points[opposite].y, before.points[opposite].y);
      const v = { x: after.points.se.x - after.points.ne.x, y: after.points.se.y - after.points.ne.y };
      const u = { x: after.points.ne.x - after.points.nw.x, y: after.points.ne.y - after.points.nw.y };
      near(u.x * v.x + u.y * v.y, 0, 2);
    } finally { await page.close(); }
  });
});

test('Shift corner scales axes independently while plain corner stays proportional', async t => {
  const browser = await launchBrowser(); t.after(() => browser.close());
  for (const shift of [false, true]) await t.test(`shift=${shift}`, async () => {
    const page = await fixture(browser);
    try {
      const before = await frame(page);
      const writes = await drag(page, before.points.se, 40, 6, shift);
      const transform = writes[0].patch.transform;
      if (shift) assert.ok(Math.abs(transform.scaleX - transform.scaleY) > 0.1, JSON.stringify(transform));
      else assert.equal(transform.scaleX, undefined);
    } finally { await page.close(); }
  });
});

test('group, bag and multiple selection have no edge handles', async () => {
  const browser = await launchBrowser();
  try {
    for (const kind of [true, 'bag', 'multi']) {
      const page = await fixture(browser, 0, kind);
      const state = await frame(page);
      for (const edge of ['n', 'e', 's', 'w']) assert.equal(state.points[edge], null, kind);
      await page.close();
    }
  } finally { await browser.close(); }
});

test('successful leaf edge, rotation, nudge and drag writes synchronize committed world poses in tree', async t => {
  const browser = await launchBrowser(); t.after(() => browser.close());
  for (const gesture of ['edge', 'rotate', 'nudge', 'drag']) await t.test(gesture, async () => {
    const page = await fixture(browser);
    try {
      const before = await frame(page);
      if (gesture === 'edge') await drag(page, before.points.e, 30, 0);
      if (gesture === 'rotate') await drag(page, before.points.rotate, 35, 20);
      if (gesture === 'nudge') {
        await page.keyboard.press('ArrowRight');
        await page.waitForFunction(() => window.writes.length === 1);
      }
      if (gesture === 'drag') {
        const center = await page.evaluate(() => {
          const rect = window.akari.interaction.fragmentBounds(document.querySelector('[data-overlay-id="leaf"]'));
          return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
        });
        await drag(page, center, 24, 17);
      }
      await page.waitForFunction(() => {
        const node = window.akari.state.summary.tree.find(node => node.id === 'leaf');
        const patch = window.writes[0]?.patch.transform;
        return patch && Object.entries(patch).every(([key, value]) => node.transform?.[key] === value);
      });
      const result = await page.evaluate(() => {
        const node = window.akari.state.summary.tree.find(node => node.id === 'leaf');
        const style = document.querySelector('[data-overlay-id="leaf"]').style;
        return { tree: node.transform, patch: window.writes[0].patch.transform,
          css: { x: parseFloat(style.getPropertyValue('--x')), y: parseFloat(style.getPropertyValue('--y')),
            scale: Number(style.getPropertyValue('--scale')),
            scaleX: Number(style.getPropertyValue('--scale-x') || style.getPropertyValue('--scale')),
            scaleY: Number(style.getPropertyValue('--scale-y') || style.getPropertyValue('--scale')),
            rotate: parseFloat(style.getPropertyValue('--rotate')) } };
      });
      assert.equal(result.tree.x, result.css.x);
      assert.equal(result.tree.y, result.css.y);
      assert.equal(result.tree.rotate, result.css.rotate);
      assert.equal(result.tree.scaleX ?? result.tree.scale, result.css.scaleX);
      assert.equal(result.tree.scaleY ?? result.tree.scale, result.css.scaleY);
      assert.ok(result.patch && Object.keys(result.patch).length > 0);
      if (gesture === 'edge') assert.ok(result.tree.scaleX > 1);
      if (gesture === 'rotate') assert.ok(result.tree.rotate !== 0);
    } finally { await page.close(); }
  });
});

test('failed leaf gesture writes leave the tree world pose unchanged', async t => {
  const browser = await launchBrowser(); t.after(() => browser.close());
  for (const gesture of ['edge', 'rotate', 'nudge', 'drag']) await t.test(gesture, async () => {
    const page = await fixture(browser);
    try {
      const original = await page.evaluate(() => structuredClone(window.akari.state.summary.tree[0].transform));
      await page.evaluate(() => { window.rejectWrite = true; });
      const before = await frame(page);
      if (gesture === 'edge') await drag(page, before.points.e, 30, 0);
      if (gesture === 'rotate') await drag(page, before.points.rotate, 35, 20);
      if (gesture === 'nudge') await page.keyboard.press('ArrowRight');
      if (gesture === 'drag') {
        const center = await page.evaluate(() => {
          const rect = window.akari.interaction.fragmentBounds(document.querySelector('[data-overlay-id="leaf"]'));
          return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
        });
        await drag(page, center, 24, 17);
      }
      await page.waitForFunction(() => window.writes.length === 1);
      await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 20)));
      assert.deepEqual(await page.evaluate(() => window.akari.state.summary.tree[0].transform), original);
    } finally { await page.close(); }
  });
});
