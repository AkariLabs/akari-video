import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { launchBrowser } from './fixtures/browser.mjs';

const source = name => readFileSync(new URL(`../src/${name}`, import.meta.url), 'utf8');
const telop = '<div class="plate" style="position:absolute;left:55px;top:55px;width:220px;height:100px;background:#b45">'
  + '<span class="text" style="position:absolute;left:20px;top:25px;color:white;font-size:24px">Telop words</span>'
  + '<span class="badge" style="position:absolute;left:170px;top:20px;width:20px;height:20px;background:#fff"></span></div>';
const plateTelop = '<div class="wrap" style="position:absolute;left:55px;top:55px;width:220px;height:100px">'
  + '<div class="plate" style="position:absolute;inset:0;background:#b45"></div>'
  + '<span class="text" style="position:absolute;left:20px;top:25px;color:white;font-size:24px">Telop words</span></div>';
const ordinary = '<div class="card" style="position:absolute;left:365px;top:55px;width:180px;height:100px;background:#47a">'
  + '<span class="label" style="position:absolute;left:20px;top:25px;color:white;font-size:24px">Normal words</span></div>';

async function fixture(browser, telopFragment = telop) {
  const page = await browser.newPage();
  await page.setViewport({ width: 640, height: 360 });
  await page.setContent(`<style>body{margin:0;position:relative}#overlay-stage{position:relative;width:640px;height:360px}`
    + `nav[data-akari-ui="preview-scope-breadcrumb"]{position:absolute;bottom:0;pointer-events:none;z-index:10}`
    + `nav[data-akari-ui="preview-scope-breadcrumb"] button{pointer-events:auto}${source('interaction.css')}</style>`
    + '<nav data-akari-ui="preview-scope-breadcrumb"></nav><div id="overlay-stage"></div>');
  await page.evaluate(({ telop, ordinary }) => {
    window.writes = [];
    const overlays = [
      { id: 'telop-one', sourcePath: 'assets/overlay/telop-sample/fragment.html', html: telop },
      { id: 'ordinary', sourcePath: 'assets/overlay/custom/fragment.html', html: ordinary }
    ].map(item => ({ ...item, name: item.id, elementSelection: true, elements: {}, start: 0, duration: 10,
      transform: { x: 0, y: 0, scale: 1, rotate: 0 } }));
    window.akari = { capabilities: { elementSelection: true },
      state: { editPath: 'fixture', summary: { output: { width: 640, height: 360 }, overlays,
        tree: overlays.map(item => ({ id: item.id, kind: 'leaf', parentId: null, transform: item.transform })) } },
      stageScale: () => 1, engine: { overlayWrite: async (_path, id, patch) => window.writes.push({ id, patch }) } };
  }, { telop: telopFragment, ordinary });
  await page.addScriptTag({ content: source('overlay-runtime.js') });
  await page.addScriptTag({ content: source('interaction.js') });
  await page.evaluate(async () => { await window.akari.runtime.mount(window.akari.state.summary); window.akari.runtime.tick(1, true); });
  return page;
}

const point = (page, selector, dx = 0.5, dy = 0.5) => page.evaluate(({ selector, dx, dy }) => {
  const box = document.querySelector(selector).getBoundingClientRect();
  return { x: box.left + box.width * dx, y: box.top + box.height * dy };
}, { selector, dx, dy });
const state = page => page.evaluate(() => ({ id: window.akari.interaction.selectedId,
  focus: window.akari.interaction.elementFocus?.ref ?? null,
  telop: window.akari.interaction.selectedTelop, inner: window.akari.interaction.telopInner,
  editing: window.akari.interaction.activeEdit,
  breadcrumb: document.querySelector('[data-akari-ui="preview-scope-breadcrumb"]').textContent }));
async function click(page, position, count = 1) {
  const cdp = await page.target().createCDPSession();
  for (let clickCount = 1; clickCount <= count; clickCount++) {
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...position, button: 'left', clickCount });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...position, button: 'left', clickCount });
  }
  await cdp.detach();
}

test('telop starts outside for click, deep click, hover and host focus; the inner switch is selection scoped', async t => {
  const browser = await launchBrowser(); t.after(() => browser.close());
  const page = await fixture(browser);
  const text = await point(page, '.text');
  await page.mouse.move(text.x, text.y);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const hover = await page.evaluate(() => {
    const frame = document.querySelector('[data-akari-ui="preview-hover-frame"]');
    const telop = document.querySelector('[data-overlay-id="telop-one"]');
    return { frame: frame?.getBoundingClientRect().width, outer: window.akari.interaction.fragmentBounds(telop).width };
  });
  assert.ok(Math.abs(hover.frame - hover.outer) < 1, JSON.stringify(hover));
  await page.mouse.click(text.x, text.y);
  assert.deepEqual((({ id, focus, telop, inner }) => ({ id, focus, telop, inner }))(await state(page)),
    { id: 'telop-one', focus: null, telop: true, inner: false });
  assert.match((await state(page)).breadcrumb, /^全体 › telop-one$/u);
  await page.keyboard.down('Control');
  await page.mouse.click(text.x, text.y);
  await page.keyboard.up('Control');
  assert.equal((await state(page)).focus, null);
  assert.equal(await page.evaluate(({ x, y }) => window.akari.interaction.focusElementAtPoint('telop-one', x, y), text), false);
  assert.equal((await state(page)).focus, null);

  assert.equal(await page.evaluate(() => window.akari.interaction.setTelopInnerSelection('telop-one', true)), true);
  assert.equal((await state(page)).inner, true);
  await page.mouse.move(text.x, text.y);
  await page.mouse.down();
  const afterDown = await state(page);
  await page.mouse.up();
  const afterUp = await state(page);
  assert.equal((await state(page)).focus, '.text[0]', JSON.stringify({ afterDown, afterUp }));
  await page.keyboard.press('Escape');
  assert.deepEqual((({ id, focus, inner }) => ({ id, focus, inner }))(await state(page)),
    { id: 'telop-one', focus: null, inner: false });
  await page.keyboard.press('Escape');
  assert.equal((await state(page)).id, null);

  await page.mouse.click(text.x, text.y);
  await page.evaluate(() => window.akari.interaction.setTelopInnerSelection('telop-one', true));
  const normal = await point(page, '.label');
  await page.mouse.click(normal.x, normal.y);
  assert.equal((await state(page)).focus, '.label[0]');
  await page.mouse.click(text.x, text.y);
  assert.equal((await state(page)).inner, false);
  assert.equal((await state(page)).focus, null);
  await page.evaluate(() => window.akari.interaction.setTelopInnerSelection('telop-one', true));
  await page.mouse.click(610, 320);
  assert.equal((await state(page)).id, null);
  assert.equal((await state(page)).inner, false);
  await page.evaluate(() => window.akari.interaction.selectFromTimeline('telop-one'));
  assert.equal((await state(page)).focus, null);
  assert.equal((await state(page)).inner, false);
  assert.match((await state(page)).breadcrumb, /^全体 › telop-one$/u);
  await page.evaluate(() => window.akari.interaction.setTelopInnerSelection('telop-one', true));
  await page.evaluate(() => document.querySelector('[data-akari-ui="preview-scope-breadcrumb"] button:last-child').click());
  assert.equal((await state(page)).inner, false);
});

test('telop double click edits text without a focus step; plate double click stays outside', async t => {
  const browser = await launchBrowser(); t.after(() => browser.close());
  const page = await fixture(browser);
  const plate = await point(page, '.plate', 0.9, 0.8);
  await click(page, plate, 2);
  assert.equal((await state(page)).editing, false);
  assert.equal((await state(page)).focus, null);
  const text = await point(page, '.text');
  await click(page, text, 2);
  assert.equal((await state(page)).editing, true, JSON.stringify({ state: await state(page),
    target: await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.outerHTML?.slice(0, 300), text) }));
  assert.equal((await state(page)).focus, null);
  await page.keyboard.press('Escape');
  assert.deepEqual((({ id, focus, editing, inner }) => ({ id, focus, editing, inner }))(await state(page)),
    { id: 'telop-one', focus: null, editing: false, inner: false });
  await click(page, text, 2);
  await page.keyboard.type('!');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.writes.length > 0);
  assert.equal((await state(page)).focus, null);
  assert.equal((await state(page)).inner, false);
});

test('Enter opens the selected telop and Esc returns to outside before clearing selection', async t => {
  const browser = await launchBrowser(); t.after(() => browser.close());
  const page = await fixture(browser);
  const text = await point(page, '.text');
  await page.mouse.click(text.x, text.y);
  await page.keyboard.press('Enter');
  assert.equal((await state(page)).focus, '.text[0]');
  assert.equal((await state(page)).inner, true);
  await page.keyboard.press('Escape');
  assert.equal((await state(page)).focus, null);
  assert.equal((await state(page)).inner, false);
  await page.keyboard.press('Escape');
  assert.equal((await state(page)).id, null);
});

test('ordinary HTML keeps deepest click, deep click, Enter and rejects the telop switch', async t => {
  const browser = await launchBrowser(); t.after(() => browser.close());
  const page = await fixture(browser);
  const label = await point(page, '.label');
  await page.mouse.click(label.x, label.y);
  assert.equal((await state(page)).focus, '.label[0]');
  await page.keyboard.down('Control');
  await page.mouse.click(label.x, label.y);
  await page.keyboard.up('Control');
  assert.equal((await state(page)).focus, '.label[0]');
  const before = await state(page);
  assert.equal(await page.evaluate(() => window.akari.interaction.setTelopInnerSelection('ordinary', true)), false);
  assert.deepEqual(await state(page), before);
  await page.evaluate(() => window.akari.interaction.selectFromTimeline('telop-one'));
  await page.evaluate(() => window.akari.interaction.selectFromTimeline('ordinary'));
  assert.equal((await state(page)).focus, null);
  await page.keyboard.press('Enter');
  assert.equal((await state(page)).focus, '.label[0]');
});

test('element edge write and inline remount keep the telop identity for the next outer selection', async t => {
  const browser = await launchBrowser(); t.after(() => browser.close());
  const page = await fixture(browser, plateTelop);
  const text = await point(page, '.text');
  await page.mouse.click(text.x, text.y);
  assert.equal(await page.evaluate(() => window.akari.interaction.setTelopInnerSelection('telop-one', true)), true);
  const plate = await point(page, '.plate', 0.9, 0.8);
  await page.mouse.click(plate.x, plate.y);
  assert.equal((await state(page)).focus, '.plate[0]');
  const edge = await page.evaluate(() => {
    const handle = document.querySelector('.akari-interaction-selection-frame .akari-interaction-handle.is-e');
    const box = handle.getBoundingClientRect();
    return { x: box.left + box.width / 2, y: box.top + box.height / 2,
      visible: getComputedStyle(handle).display !== 'none',
      frame: document.querySelector('.akari-interaction-selection-frame').className,
      handles: [...document.querySelectorAll('.akari-interaction-selection-frame .akari-interaction-handle')]
        .filter(node => getComputedStyle(node).display !== 'none').map(node => node.className) };
  });
  assert.equal(edge.visible, true, JSON.stringify(edge));
  await page.mouse.move(edge.x, edge.y);
  await page.mouse.down();
  await page.mouse.move(edge.x + 30, edge.y, { steps: 4 });
  await page.mouse.up();
  await page.waitForFunction(() => window.writes.some(write => write.patch.element?.style?.width));
  const write = await page.evaluate(() => window.writes.find(entry => entry.patch.element?.style?.width));
  assert.equal(write.id, 'telop-one');
  assert.equal(write.patch.element.ref, '.plate[0]');
  await page.evaluate(async ({ ref, style }) => {
    const summary = window.akari.state.summary;
    const overlays = summary.overlays.map(overlay => overlay.id === 'telop-one'
      ? { ...overlay, html: overlay.html.replace('background:#b45',
        `background:#b45;${Object.entries(style).map(([name, value]) => `${name}:${value}`).join(';')}`),
        elements: { [ref]: { style } } } : overlay);
    window.akari.state.summary = { ...summary, overlays };
    await window.akari.runtime.mount(window.akari.state.summary);
    window.akari.runtime.tick(1, true);
  }, { ref: write.patch.element.ref, style: write.patch.element.style });
  assert.equal(await page.evaluate(() => window.akari.state.summary.overlays[0].sourcePath),
    'assets/overlay/telop-sample/fragment.html');
  await page.mouse.click(610, 320);
  const remountedText = await point(page, '.text');
  await page.mouse.click(remountedText.x, remountedText.y);
  const after = await state(page);
  assert.deepEqual({ id: after.id, focus: after.focus, telop: after.telop, inner: after.inner },
    { id: 'telop-one', focus: null, telop: true, inner: false });
  assert.equal(await page.evaluate(() => document.querySelector('.akari-interaction-selection-frame')?.classList.contains('is-telop')), true);
});
