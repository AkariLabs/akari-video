import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { launchBrowser } from './fixtures/browser.mjs';
import { SHELL_TIGHT_FRAGMENTS, SHELL_TIGHT_CONTENT } from './fixtures/tight-bounds-fixtures.mjs';
import { BRANCH_POINT_FRAGMENT_BOUNDS } from './fixtures/tight-bounds-baseline-fragment-bounds.mjs';

const runtime = readFileSync(new URL('../src/overlay-runtime.js', import.meta.url), 'utf8');
const interaction = readFileSync(new URL('../src/interaction.js', import.meta.url), 'utf8');
const selection = readFileSync(new URL('../src/element-selection.mjs', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/interaction.css', import.meta.url), 'utf8');
const demoDiagram = readFileSync(new URL('../../../apps/shell/resources/onboarding-sample/talkinghead-desk-ja-01/overlays/demo-diagram/fragment.html', import.meta.url), 'utf8');
const legacyStart = interaction.indexOf('  function legacyFragmentBounds(');
assert.ok(legacyStart >= 0, 'legacy fragmentBounds anchor');
const fragmentStart = interaction.indexOf('  function fragmentBounds(', legacyStart + 1);
const fragmentEnd = interaction.indexOf('  function svgReferenceRect(', fragmentStart);
assert.ok(fragmentStart >= 0 && fragmentEnd > fragmentStart, 'fragmentBounds replacement anchors');
const baselineInteraction = interaction.slice(0, fragmentStart) + BRANCH_POINT_FRAGMENT_BOUNDS
  + interaction.slice(fragmentEnd);
test('painted-root fallback retains the exact branch-point fragmentBounds body', () => {
  const copied = interaction.slice(interaction.indexOf('  function legacyFragmentBounds('),
    interaction.indexOf('  function fragmentBounds(', interaction.indexOf('  function legacyFragmentBounds(')))
    .replace('function legacyFragmentBounds', 'function fragmentBounds');
  assert.equal(copied, BRANCH_POINT_FRAGMENT_BOUNDS);
});
function close(actual, expected, label) {
  for (const key of ['left', 'top', 'width', 'height'])
    assert.ok(Math.abs(actual[key] - expected[key]) <= 1, `${label} ${key}: ${actual[key]} != ${expected[key]}`);
}
async function fixture(browser, html, script = interaction, size = { width: 640, height: 360 }, tree = null) {
  const page = await browser.newPage(); await page.setViewport(size);
  await page.setContent(`<style>body{margin:0}[data-akari-ui="preview-scope-breadcrumb"]{position:absolute}#overlay-stage{position:relative;width:${size.width}px;height:${size.height}px}${css}</style>
    <nav data-akari-ui="preview-scope-breadcrumb" hidden></nav><div id="overlay-stage"></div>`);
  await page.evaluate(({ fragment, size, tree }) => { window.akari = { state: { editPath: 'fixture', summary: {
    output: size, ...(tree ? { tree } : {}), overlays: [{ id: 'item', html: fragment,
      elementSelection: true, elements: {}, start: 0, duration: 20,
      transform: { x: 0, y: 0, scale: 1, rotate: 0 } }] } },
    capabilities: { elementSelection: true }, stageScale: () => 1,
    engine: { overlayWrite: async () => {} } }; }, { fragment: html, size, tree });
  await page.addScriptTag({ content: runtime }); await page.addScriptTag({ content: script });
  await page.evaluate(async () => { await window.akari.runtime.mount(window.akari.state.summary); window.akari.runtime.tick(1, true); });
  return page;
}
async function point(page, selector) {
  return page.evaluate(name => { const r = document.querySelector(name).getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, selector);
}
async function settle(page) { await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))); }
async function state(page) {
  return page.evaluate(() => {
    const frame = document.querySelector('.akari-interaction-selection-frame');
    const rect = frame?.getBoundingClientRect();
    return { focus: window.akari.interaction.elementFocus?.ref ?? null,
      bounds: window.akari.interaction.fragmentBounds(document.querySelector('[data-overlay-id="item"]')),
      frameStyle: frame?.getAttribute('style'), frame: rect && { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
      handles: frame && [...frame.querySelectorAll('.akari-interaction-handle')]
        .filter(handle => getComputedStyle(handle).display !== 'none')
        .map(handle => [...handle.classList].find(name => name.startsWith('is-'))) };
  });
}

test('all five fixture item frames fit painted content', async t => {
  const browser = await launchBrowser(); t.after(() => browser.close());
  for (const [key, selector] of [['chart', '.bar'], ['wide', '.badge'], ['scaffold', '.card'],
    ['holder', '.card'], ['pair', '.chip']]) {
    const page = await fixture(browser, SHELL_TIGHT_FRAGMENTS[key]);
    const p = await point(page, selector); await page.mouse.click(p.x, p.y);
    for (let i = 0; i < 3 && (await state(page)).focus; i++) await page.keyboard.press('Escape');
    await settle(page); const result = await state(page), expected = SHELL_TIGHT_CONTENT[`tsb-${key}`];
    close(result.bounds, expected, `${key} item`); close(result.frame, expected, `${key} frame`);
    await page.close();
  }
});

test('Escape skips scaffold and one-child holder; Enter picks painted content', async t => {
  const browser = await launchBrowser(); t.after(() => browser.close());
  for (const [key, child, parent, first] of [
    ['chart', '.bar', '.chart[0]', '.chart[0]'],
    ['scaffold', '.card', null, '.card[0]'],
    ['holder', '.card', null, '.card[0]'],
    ['pair', '.chip', '.pair[0]', '.pair[0]']]) {
    const page = await fixture(browser, SHELL_TIGHT_FRAGMENTS[key]);
    const p = await point(page, child); await page.mouse.click(p.x, p.y);
    assert.ok((await state(page)).focus, key);
    await page.keyboard.press('Escape'); assert.equal((await state(page)).focus, parent, `${key} parent`);
    if (parent) await page.keyboard.press('Escape');
    assert.equal((await state(page)).focus, null);
    await page.keyboard.press('Enter'); assert.equal((await state(page)).focus, first, `${key} Enter`);
    await page.close();
  }
});

test('transparent two-child group uses content frame and only rotation handle', async t => {
  const browser = await launchBrowser(); t.after(() => browser.close());
  const page = await fixture(browser, SHELL_TIGHT_FRAGMENTS.pair);
  const p = await point(page, '.chip'); await page.mouse.click(p.x, p.y); await page.keyboard.press('Escape');
  await settle(page); let s = await state(page); assert.equal(s.focus, '.pair[0]');
  close(s.frame, SHELL_TIGHT_CONTENT['tsb-pair'], 'pair'); assert.deepEqual(s.handles, ['is-rotate']);
  await page.mouse.move(p.x, p.y); await page.mouse.down();
  await page.mouse.move(p.x + 20, p.y + 15, { steps: 3 }); await page.mouse.up();
  await settle(page); s = await state(page); close(s.frame, { left: 180, top: 155, width: 320, height: 80 }, 'moved pair');
  await page.evaluate(() => { document.querySelector('.pair').style.rotate = '25deg'; });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.match(await page.evaluate(() => document.querySelector('.akari-interaction-selection-frame').style.transform), /rotate\(25deg\)/);
  const oriented = await page.evaluate(() => {
    const box = document.querySelector('.pair').getBoundingClientRect();
    const frame = document.querySelector('.akari-interaction-selection-frame');
    const visual = frame.getBoundingClientRect();
    return { width: frame.offsetWidth, height: frame.offsetHeight,
      centerDrift: Math.hypot(box.left + box.width / 2 - visual.left - visual.width / 2,
        box.top + box.height / 2 - visual.top - visual.height / 2) };
  });
  assert.ok(Math.abs(oriented.width - 320) < 2 && Math.abs(oriented.height - 80) < 2
    && oriented.centerDrift < 2, JSON.stringify(oriented));
  assert.deepEqual((await state(page)).handles, ['is-rotate']);
});

test('selection thresholds: one/two children, 1.5, 50%, and 95%', async t => {
  const browser = await launchBrowser(); t.after(() => browser.close());
  const page = await browser.newPage(); await page.setViewport({ width: 640, height: 360 });
  await page.setContent('<div id="root" style="position:relative;width:640px;height:360px"></div>');
  await page.addScriptTag({ content: selection.slice(selection.indexOf('// BEGIN element-selection'),
    selection.indexOf('// END element-selection')) });
  const results = await page.evaluate(() => {
    const root = document.querySelector('#root'), output = root.getBoundingClientRect();
    const check = (width, height, count, painted = false, childWidth = 200, outputWidth = 640) => {
      root.innerHTML = `<div class="holder" style="position:absolute;width:${width}px;height:${height}px;${painted ? 'background:#ddd' : ''}">
        <div class="a" style="position:absolute;left:0;top:0;width:${childWidth / count}px;height:100px;background:red"></div>
        ${count === 2 ? `<div class="b" style="position:absolute;left:${childWidth / 2}px;top:0;width:${childWidth / 2}px;height:100px;background:blue"></div>` : ''}</div>`;
      return selectableElement(root, root.firstElementChild, { ...output, width: outputWidth });
    };
    return { one: check(200, 100, 1), two: check(200, 100, 2),
      ratioBefore: check(269.9, 100, 2, false, 180, 500), ratioAt: check(270, 100, 2, false, 180, 500),
      fiftyBefore: check(319.9, 100, 2), fiftyAt: check(320, 100, 2),
      painted: check(320, 100, 2, true),
      ninetyFiveBefore: check(607.9, 341.9, 2, true, 607.9),
      ninetyFiveAt: check(608, 342, 2, true, 608) };
  });
  assert.deepEqual(results, { one: false, two: true, ratioBefore: true, ratioAt: false,
    fiftyBefore: true, fiftyAt: false, painted: true, ninetyFiveBefore: true, ninetyFiveAt: false });
});

test('SVG shapes and canvas contribute beneath a transparent root', async t => {
  const browser = await launchBrowser(); t.after(() => browser.close());
  const svg = await fixture(browser, `<div class="root" style="position:absolute;inset:0"><svg style="position:absolute;left:100px;top:60px;width:200px;height:100px" viewBox="0 0 200 100"><rect x="20" y="10" width="50" height="40" fill="red"/></svg></div>`);
  const a = (await state(svg)).bounds;
  assert.ok(a.left >= 119 && a.top >= 69 && a.width < 100 && a.height < 80, JSON.stringify(a));
  const canvas = await fixture(browser, `<div class="root" style="position:absolute;inset:0"><canvas width="100" height="60" style="position:absolute;left:80px;top:40px;width:100px;height:60px"></canvas></div>`);
  await canvas.evaluate(() => { const ctx = document.querySelector('canvas').getContext('2d'); ctx.fillStyle = 'red'; ctx.fillRect(10, 10, 30, 20); });
  const b = (await state(canvas)).bounds;
  assert.ok(b.left >= 80 && b.right <= 180 && b.width > 0 && b.height > 0, JSON.stringify(b));
});

test('painted root fragmentBounds remains identical to the branch point across SVG, canvas, image, background and text', async t => {
  const browser = await launchBrowser(); t.after(() => browser.close());
  const svg = (size, clipped) => `<svg style="position:absolute;left:40px;top:30px;width:${size[0]}px;height:${size[1]}px" viewBox="0 0 ${size[0]} ${size[1]}">
    ${clipped ? '<defs><clipPath id="crop"><rect x="5" y="5" width="70" height="70"/></clipPath></defs><g clip-path="url(#crop)">' : ''}
    <circle cx="50" cy="50" r="20" fill="red"/>${clipped ? '</g>' : ''}</svg>`;
  const painted = (full, overflow) => `<div style="position:absolute;left:${full ? 0 : 40}px;top:${full ? 0 : 30}px;width:${full ? 640 : 200}px;height:${full ? 360 : 180}px;background:#ddd">
    <i style="position:absolute;left:${overflow ? 230 : 20}px;top:20px;width:30px;height:30px;background:red"></i></div>`;
  const image = '<img style="position:absolute;left:40px;top:30px;width:200px;height:180px" src="data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'2\' height=\'2\'%3E%3Crect width=\'2\' height=\'2\' fill=\'red\'/%3E%3C/svg%3E">';
  const cases = [svg([200, 200], false), svg([640, 360], false),
    svg([200, 200], true), svg([640, 360], true),
    '<canvas width="200" height="180" style="position:absolute;left:40px;top:30px;width:200px;height:180px"></canvas>',
    image, painted(false, false), painted(false, true), painted(true, false), painted(true, true),
    '<div style="position:absolute;left:40px;top:30px;width:200px;height:180px;color:#111">direct text<i style="position:absolute;left:230px;top:20px;width:30px;height:30px;background:red"></i></div>'];
  for (const [index, html] of cases.entries()) {
    const now = await fixture(browser, html), old = await fixture(browser, html, baselineInteraction);
    if (html.startsWith('<canvas')) {
      for (const page of [now, old]) await page.evaluate(() => {
        const context = document.querySelector('canvas').getContext('2d');
        context.fillStyle = 'red'; context.fillRect(15, 15, 30, 25);
      });
    }
    if (html.startsWith('<img')) for (const page of [now, old])
      await page.evaluate(() => document.querySelector('img').decode());
    close((await state(now)).bounds, (await state(old)).bounds, `painted root ${index}`);
    await now.close(); await old.close();
  }
});

test('an empty transparent group is skipped by Enter and loses focus without switching targets', async t => {
  const browser = await launchBrowser(); t.after(() => browser.close());
  const page = await fixture(browser, SHELL_TIGHT_FRAGMENTS.pair);
  const first = await point(page, '.chip'); await page.mouse.click(first.x, first.y);
  await page.keyboard.press('Escape'); assert.equal((await state(page)).focus, '.pair[0]');
  await page.evaluate(() => { for (const chip of document.querySelectorAll('.chip')) chip.style.display = 'none'; });
  await settle(page); await settle(page);
  assert.equal((await state(page)).focus, null);
  await page.keyboard.press('Enter'); assert.equal((await state(page)).focus, null);
  await page.evaluate(() => { for (const chip of document.querySelectorAll('.chip')) chip.style.display = ''; });
  await settle(page);
  assert.equal((await state(page)).focus, null);
  await page.keyboard.press('Enter'); assert.equal((await state(page)).focus, '.pair[0]');
});

test('a childless unpainted leaf keeps the branch-point selection, box frame and resize handles', async t => {
  const browser = await launchBrowser(); t.after(() => browser.close());
  const tree = [{ id: 'item', parentId: null, kind: 'leaf', label: 'item' }];
  const html = '<div class="root" style="position:absolute;inset:0"><div class="wide" style="position:absolute;left:140px;top:70px;width:200px;height:100px"></div></div>';
  const page = await fixture(browser, html, interaction, { width: 640, height: 360 }, tree);
  await page.evaluate(() => window.akari.interaction.selectFromTimeline('item'));
  await page.keyboard.press('Enter'); await settle(page);
  const result = await state(page);
  assert.equal(result.focus, '.wide[0]');
  close(result.frame, { left: 140, top: 70, width: 200, height: 100 }, 'childless leaf');
  assert.equal(result.handles.length, 9);
  assert.ok(result.handles.includes('is-nw') && result.handles.includes('is-edge')
    && result.handles.includes('is-rotate'));
  await page.close();
});

test('a transparent group whose children are all opacity zero is not selectable', async t => {
  const browser = await launchBrowser(); t.after(() => browser.close());
  const page = await fixture(browser, SHELL_TIGHT_FRAGMENTS.pair);
  const first = await point(page, '.chip'); await page.mouse.click(first.x, first.y);
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
  await page.evaluate(() => { for (const chip of document.querySelectorAll('.chip')) chip.style.opacity = '0'; });
  await page.addScriptTag({ content: selection.slice(selection.indexOf('// BEGIN element-selection'),
    selection.indexOf('// END element-selection')) });
  const eligible = await page.evaluate(() => {
    const root = document.querySelector('.tsb-pair-root');
    const pair = root.querySelector('.pair');
    return { container: isSelectionContainer(pair), selectable: selectableElement(root, pair,
      document.querySelector('#overlay-stage').getBoundingClientRect()) };
  });
  assert.deepEqual(eligible, { container: true, selectable: false });
  await page.keyboard.press('Enter'); assert.equal((await state(page)).focus, null);
});

test('unaddressed painted descendants keep their transparent owner selectable', async t => {
  const browser = await launchBrowser(); t.after(() => browser.close());
  const tree = [{ id: 'item', parentId: null, kind: 'leaf', label: 'item' }];
  const root = inner => `<div class="root" style="position:absolute;inset:0">${inner}</div>`;
  const group = inner => `<div class="group" style="position:absolute;left:100px;top:80px;width:200px;height:100px">${inner}</div>`;
  const text = '<span style="position:absolute;display:block;left:100px;top:50px;width:50px;height:20px">BB</span>';
  const cases = [
    { name: 'two classless text leaves', html: root(group('<span style="position:absolute;display:block;left:10px;top:10px;width:40px;height:20px">AA</span>' + text)),
      focus: '.group[0]', bounds: { left: 110, top: 90, width: 140, height: 60 } },
    { name: 'named child plus classless text', html: root(group('<div class="card" style="position:absolute;left:10px;top:10px;width:40px;height:20px;background:red"></div>' + text)),
      focus: '.group[0]', bounds: { left: 110, top: 90, width: 140, height: 60 } },
    { name: 'one classless SVG', html: root(group('<svg style="position:absolute;left:60px;top:20px;width:40px;height:40px" viewBox="0 0 40 40"><rect x="5" y="5" width="20" height="20" fill="red"/></svg>')),
      focus: '.group[0]', bounds: { left: 165, top: 105, width: 20, height: 20 } },
    { name: 'wide scaffold with classless text', html: root('<div class="scaffold" style="position:absolute;left:10%;top:10%;width:80%;height:80%"><span style="position:absolute;display:block;left:20px;top:20px;width:80px;height:30px">AA</span></div>'),
      focus: '.scaffold[0]', bounds: { left: 84, top: 56, width: 80, height: 30 } },
    { name: 'wide scaffold with two named cards', html: SHELL_TIGHT_FRAGMENTS.scaffold,
      focus: '.card[0]', bounds: { left: 84, top: 56, width: 110, height: 70 } },
  ];
  for (const item of cases) {
    const page = await fixture(browser, item.html, interaction, { width: 640, height: 360 }, tree);
    await page.evaluate(() => window.akari.interaction.selectFromTimeline('item'));
    await page.keyboard.press('Enter'); await settle(page);
    const result = await state(page);
    assert.equal(result.focus, item.focus, item.name);
    close(result.frame, item.bounds, item.name);
    if (item.focus !== '.card[0]') assert.deepEqual(result.handles, ['is-rotate'], item.name);
    await page.close();
  }
});

test('painted roots and contained 98%-plus wrapper match branch-point fragmentBounds', async t => {
  const browser = await launchBrowser(); t.after(() => browser.close());
  for (const html of [
    `<div class="root" style="position:absolute;inset:0;background:#eee"><span style="position:absolute;left:20px;top:20px;background:red">A</span></div>`,
    `<div class="root" style="position:absolute;inset:0"><div class="holder" style="position:absolute;left:180px;top:80px;width:280px;height:200px"><div style="position:absolute;inset:0;background:#ccc"></div></div></div>`]) {
    const now = await fixture(browser, html), old = await fixture(browser, html, baselineInteraction);
    close((await state(now)).bounds, (await state(old)).bounds, 'branch-point');
    await now.close(); await old.close();
  }
});

test('47x9 and 9x47 visible handles clear the element, center drag and double-click work', async t => {
  const browser = await launchBrowser(); t.after(() => browser.close());
  for (const [width, height] of [[47, 9], [9, 47]]) {
    const page = await fixture(browser, `<div class="root" style="position:absolute;inset:0"><div class="thin" style="position:absolute;left:200px;top:100px;width:${width}px;height:${height}px;background:#ddd">X</div></div>`);
    const p = await point(page, '.thin'); await page.mouse.click(p.x, p.y);
    const overlaps = await page.evaluate(() => { const box = document.querySelector('.thin').getBoundingClientRect();
      return [...document.querySelectorAll('.akari-interaction-selection-frame .akari-interaction-handle')]
        .filter(handle => getComputedStyle(handle).display !== 'none')
        .filter(handle => { const r = handle.getBoundingClientRect();
          return r.left < box.right && r.right > box.left && r.top < box.bottom && r.bottom > box.top; })
        .map(handle => handle.className); });
    assert.deepEqual(overlaps, [], `${width}x${height}`);
    await page.mouse.move(p.x, p.y); await page.mouse.down();
    await page.mouse.move(p.x + 15, p.y + 10, { steps: 3 }); await page.mouse.up();
    const moved = await point(page, '.thin');
    assert.ok(Math.hypot(moved.x - p.x - 15, moved.y - p.y - 10) < 2, JSON.stringify({ width, height, p, moved }));
    const cdp = await page.createCDPSession();
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: moved.x, y: moved.y });
    for (let count = 1; count <= 2; count++) {
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: moved.x, y: moved.y,
        button: 'left', clickCount: count });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: moved.x, y: moved.y,
        button: 'left', clickCount: count });
    }
    await cdp.detach();
    assert.equal(await page.evaluate(() => document.activeElement?.isContentEditable), true);
    await page.close();
  }
});

function instrumentTiming(source) {
  const wrap = (name, next, key) => {
    const start = source.indexOf(`function ${name}(`);
    assert.ok(start >= 0, name);
    const signatureEnd = source.indexOf(') {', start);
    const open = signatureEnd + 2;
    const after = source.indexOf(next, open);
    assert.ok(after > open, `${name} end`);
    const close = source.lastIndexOf('}', after);
    const before = source.slice(0, open + 1);
    const body = source.slice(open + 1, close);
    source = `${before}const __started = performance.now(); try {${body}} finally {
      (window.__timings ??= {}).${key} ??= [];
      window.__timings.${key}.push(performance.now() - __started);
    }${source.slice(close)}`;
  };
  wrap('nearestSelectableElement', '\nfunction firstSelectableElement', 'nearest');
  wrap('firstSelectableElement', '\nfunction elementByAddress', 'first');
  wrap('refreshSelectionFrame', '\n  function trackSelectionFrame', 'frame');
  return source;
}

test('demo-diagram selection timings stay under a loose hover budget', async t => {
  const browser = await launchBrowser(); t.after(() => browser.close());
  const results = {};
  for (const [label, source] of [['current', interaction]]) {
    const page = await fixture(browser, demoDiagram, instrumentTiming(source), { width: 1280, height: 720 });
    const p = await point(page, '.demo-diagram__title');
    assert.ok(p.x > 0 && p.x < 1280 && p.y > 0 && p.y < 720, JSON.stringify(p));
    const hoverSamples = [];
    for (let index = 0; index < 5; index++) {
      await page.mouse.move(p.x + (index % 2), p.y); await settle(page);
      hoverSamples.push(await page.evaluate(() => window.__timings?.nearest?.at(-1)));
    }
    const hover = hoverSamples.sort((a, b) => a - b)[2];
    await page.mouse.click(p.x, p.y); await settle(page);
    await page.evaluate(() => { window.akari.interaction.clearElementFocus(); window.__timings = {}; });
    await page.keyboard.press('Enter');
    const enter = await page.evaluate(() => window.__timings?.first?.at(-1));
    await page.evaluate(() => { window.__timings = {}; });
    await page.keyboard.press('Escape');
    const escape = await page.evaluate(() => window.__timings?.nearest?.at(-1));
    await page.mouse.click(p.x, p.y);
    assert.ok((await state(page)).focus, `${label} focused frame`);
    await page.evaluate(() => { window.__timings = {}; });
    await settle(page); await settle(page);
    const frames = await page.evaluate(() => window.__timings?.frame ?? []);
    results[label] = { hover, enter, escape,
      frame: frames.length ? frames.sort((a, b) => a - b)[Math.floor(frames.length / 2)] : null };
    await page.close();
  }
  console.log('demo-diagram timing ms per operation:', JSON.stringify(results));
  for (const [label, value] of Object.entries(results)) {
    for (const [operation, milliseconds] of Object.entries(value))
      assert.ok(Number.isFinite(milliseconds), `${label} ${operation}: ${milliseconds}`);
  }
  assert.ok(results.current.hover < 20, JSON.stringify(results));
});
