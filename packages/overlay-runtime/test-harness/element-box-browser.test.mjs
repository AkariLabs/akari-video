import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { launchBrowser } from './fixtures/browser.mjs';
import { BOX_FRAGMENTS } from './fixtures/element-box-fixtures.mjs';

const runtime = readFileSync(new URL('../src/overlay-runtime.js', import.meta.url), 'utf8');
const interaction = readFileSync(new URL('../src/interaction.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/interaction.css', import.meta.url), 'utf8');

async function fixture(browser, fragment = BOX_FRAGMENTS.bars, enabled = true, tree = null) {
  const page = await browser.newPage();
  await page.setViewport({ width: 640, height: 360 });
  await page.setContent(`<style>body{margin:0}#overlay-stage{position:relative;width:640px;height:360px}${css}</style>
    <nav data-akari-ui="preview-scope-breadcrumb" hidden></nav><div id="overlay-stage"></div>`);
  await page.evaluate(({ fragment, enabled, tree }) => {
    window.writes = [];
    window.akari = { state: { editPath: 'fixture', summary: { output: { width: 640, height: 360 },
      overlays: [{ id: 'chart', html: fragment, elementSelection: true, elements: {}, start: 0, duration: 20,
        transform: { x: 0, y: 0, scale: 1, rotate: 0 } }], ...(tree ? { tree } : {}) } },
      ...(enabled ? { capabilities: { elementSelection: true } } : {}), stageScale: () => 1,
      showWriteError: error => (window.errors ??= []).push(String(error)),
      engine: { overlayWrite: async (_path, id, patch) => {
        window.writes.push({ id, patch });
        if (window.rejectWrite) throw new Error('rejected');
      } } };
  }, { fragment, enabled, tree });
  await page.addScriptTag({ content: runtime });
  await page.addScriptTag({ content: interaction });
  await page.evaluate(async () => { await window.akari.runtime.mount(window.akari.state.summary); window.akari.runtime.tick(1, true); });
  return page;
}

async function focus(page, selector = '.bar:nth-of-type(1)') {
  const point = await page.evaluate(selector => {
    const rect = document.querySelector(selector).getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }, selector);
  await page.mouse.click(point.x, point.y);
  return point;
}

async function measure(page, selector = '.bar:nth-of-type(1)') {
  return page.evaluate(selector => {
    const element = document.querySelector(selector);
    const rect = element.getBoundingClientRect();
    const frame = document.querySelector('.akari-interaction-selection-frame');
    const handles = Object.fromEntries([...frame.querySelectorAll('.akari-interaction-handle')]
      .map(handle => {
        const name = [...handle.classList].find(value => /^is-(?:n|e|s|w|nw|ne|se|sw|rotate|move)$/.test(value))?.slice(3);
        const bounds = handle.getBoundingClientRect();
        return [name, { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2,
          visible: getComputedStyle(handle).display !== 'none' }];
      }));
    return { rect: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom,
      width: rect.width, height: rect.height, centerX: rect.left + rect.width / 2,
      centerY: rect.top + rect.height / 2 }, handles, focus: window.akari.interaction.elementFocus,
      writes: window.writes, style: element.getAttribute('style'),
      labelTop: document.querySelectorAll('.value-label')[0]?.getBoundingClientRect().top };
  }, selector);
}

async function drag(page, from, dx, dy, shift = false) {
  await page.mouse.move(from.x, from.y);
  if (shift) await page.keyboard.down('Shift');
  await page.mouse.down();
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 4 });
  await page.mouse.up();
  if (shift) await page.keyboard.up('Shift');
  await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 30)));
}

test('element edge changes height, holds opposite edge, and writes once', async t => {
  const browser = await launchBrowser(); t.after(() => browser.close());
  const page = await fixture(browser); await focus(page);
  const before = await measure(page);
  assert.equal(before.focus?.ref, '.bar[0]');
  assert.equal(Object.values(before.handles).filter(handle => handle.visible).length, 9);
  assert.equal(before.handles.move.visible, false);
  await drag(page, before.handles.n, 0, -60);
  const after = await measure(page);
  assert.ok(Math.abs(after.rect.height - before.rect.height - 60) < 1.5, JSON.stringify(after));
  assert.ok(Math.abs(after.rect.bottom - before.rect.bottom) < 1);
  assert.ok(Math.abs(after.labelTop - before.labelTop + 60) < 1.5);
  assert.equal(after.writes.length, 1);
  assert.ok(after.writes[0].patch.element.style.height);
  assert.equal(after.writes[0].patch.element.style.width, undefined);
  assert.equal(after.writes[0].patch.element.style.translate, undefined);
  assert.equal(after.writes[0].patch.element.style['box-sizing'], 'border-box');
  assert.equal(after.writes[0].patch.element.style.flex, '0 0 auto');
});

test('corner, rotation, Escape and failed write keep element ownership', async t => {
  const browser = await launchBrowser(); t.after(() => browser.close());
  const page = await fixture(browser); await focus(page);
  let before = await measure(page);
  await drag(page, before.handles.se, 20, 30);
  let after = await measure(page);
  assert.ok(Math.abs(after.rect.width / before.rect.width - after.rect.height / before.rect.height) < 0.01);
  assert.ok(Math.abs(after.rect.left - before.rect.left) < 1);
  assert.ok(Math.abs(after.rect.top - before.rect.top) < 1);
  before = after;
  await drag(page, before.handles.rotate, 20, 10, true);
  after = await measure(page);
  assert.ok(after.writes.at(-1)?.patch.element.style.rotate);
  assert.equal(Number.parseFloat(after.writes.at(-1).patch.element.style.rotate) % 15, 0);
  assert.ok(Math.hypot(after.rect.centerX - before.rect.centerX,
    after.rect.centerY - before.rect.centerY) < 1);
  before = after;
  await page.mouse.move(before.handles.e.x, before.handles.e.y);
  await page.mouse.down();
  await page.mouse.move(before.handles.e.x + 25, before.handles.e.y, { steps: 3 });
  await page.keyboard.press('Escape');
  await page.mouse.up();
  after = await measure(page);
  assert.equal(after.writes.length, before.writes.length);
  assert.ok(Math.abs(after.rect.width - before.rect.width) < 1);
  const writeErrors = [];
  page.on('console', message => {
    if (message.type() === 'error' && message.text().includes('永続化に失敗')) writeErrors.push(message.text());
  });
  await page.evaluate(() => { window.rejectWrite = true; });
  await drag(page, after.handles.e, 20, 0);
  assert.ok((await measure(page)).writes.length > before.writes.length);
  assert.ok(Math.abs((await measure(page)).rect.width - before.rect.width) < 1);
  assert.equal((await measure(page)).style, before.style);
  assert.equal(writeErrors.length, 1);
});

test('small focused element leaves its center free; capability absent keeps item handles', async t => {
  const browser = await launchBrowser(); t.after(() => browser.close());
  const small = await fixture(browser, BOX_FRAGMENTS.small); await focus(small, '.tiny');
  const state = await measure(small, '.tiny');
  assert.equal(state.handles.n.visible, false);
  assert.equal(state.handles.e.visible, false);
  assert.ok(Math.hypot(state.handles.nw.x - state.rect.centerX,
    state.handles.nw.y - state.rect.centerY) > 18);
  await drag(small, { x: state.rect.centerX, y: state.rect.centerY }, 16, 0);
  const moved = await measure(small, '.tiny');
  assert.ok(Math.abs(moved.rect.centerX - state.rect.centerX - 16) < 1);
  const cdp = await small.createCDPSession();
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: moved.rect.centerX, y: moved.rect.centerY });
  for (let count = 1; count <= 2; count++) {
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: moved.rect.centerX,
      y: moved.rect.centerY, button: 'left', clickCount: count });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: moved.rect.centerX,
      y: moved.rect.centerY, button: 'left', clickCount: count });
  }
  await cdp.detach();
  const edit = await small.evaluate(() => ({ editable: document.activeElement?.isContentEditable,
    active: document.activeElement?.outerHTML?.slice(0, 200),
    target: document.elementFromPoint(document.querySelector('.tiny').getBoundingClientRect().left + 12,
      document.querySelector('.tiny').getBoundingClientRect().top + 8)?.outerHTML?.slice(0, 200) }));
  assert.equal(edit.editable, true, JSON.stringify(edit));
  const without = await fixture(browser, BOX_FRAGMENTS.bars, false); await focus(without);
  const plain = await measure(without);
  assert.equal(plain.focus, null);
  assert.equal(Object.values(plain.handles).filter(handle => handle.visible).length, 10);
});

test('all four small corners and the rotate handle clear the element before and after rotation', async t => {
  const browser = await launchBrowser(); t.after(() => browser.close());
  const page = await fixture(browser, BOX_FRAGMENTS.small); await focus(page, '.tiny');
  const session = await page.createCDPSession(); await session.send('DOM.enable');
  const root = (await session.send('DOM.getDocument')).root.nodeId;
  const quad = async selector => {
    const { nodeId } = await session.send('DOM.querySelector', { nodeId: root, selector });
    return (await session.send('DOM.getBoxModel', { nodeId })).model.border;
  };
  const separated = (a, b) => {
    for (const shape of [a, b]) for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      const nx = -(shape[j * 2 + 1] - shape[i * 2 + 1]);
      const ny = shape[j * 2] - shape[i * 2];
      const project = points => [0, 1, 2, 3].map(k => points[k * 2] * nx + points[k * 2 + 1] * ny);
      const x = project(a), y = project(b);
      if (Math.max(...x) <= Math.min(...y) || Math.max(...y) <= Math.min(...x)) return true;
    }
    return false;
  };
  for (const angle of [0, 31]) {
    await page.evaluate(angle => { document.querySelector('.tiny').style.rotate = `${angle}deg`; }, angle);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const element = await quad('.tiny');
    for (const name of ['nw', 'ne', 'se', 'sw', 'rotate']) {
      const handle = await quad(`.akari-interaction-handle.is-${name}`);
      assert.ok(separated(element, handle), JSON.stringify({ angle, name, element, handle }));
    }
  }
});

test('inline text converts to a box for move, resize and rotation; SVG keeps its viewBox', async t => {
  const browser = await launchBrowser(); t.after(() => browser.close());
  const inline = await fixture(browser, BOX_FRAGMENTS.inline); await focus(inline, '.text');
  let state = await measure(inline, '.text');
  const inlineStart = state.rect.left;
  await drag(inline, { x: state.rect.centerX, y: state.rect.centerY }, 20, 0);
  state = await measure(inline, '.text');
  assert.equal(state.writes.at(-1).patch.element.style.display, 'inline-block');
  assert.ok(Math.abs(state.rect.left - inlineStart - 20) < 1);
  await drag(inline, state.handles.e, -30, 0);
  state = await measure(inline, '.text');
  assert.ok(state.writes.at(-1)?.patch.element?.style.width, JSON.stringify(state));
  await drag(inline, state.handles.rotate, 20, 0);
  state = await measure(inline, '.text');
  assert.ok(state.writes.at(-1).patch.element.style.rotate);
  const svg = await fixture(browser, BOX_FRAGMENTS.svg); await focus(svg, 'rect');
  const before = await measure(svg, '.mini-chart');
  await drag(svg, before.handles.se, 30, 20, true);
  const after = await measure(svg, '.mini-chart');
  assert.ok(after.rect.width > before.rect.width + 10);
  assert.ok(after.writes.at(-1).patch.element.style.width);
});

test('arrow nudge also moves an inline span and saves its display companion', async t => {
  const browser = await launchBrowser(); t.after(() => browser.close());
  const page = await fixture(browser, BOX_FRAGMENTS.inline); await focus(page, '.text');
  const before = await measure(page, '.text');
  await page.keyboard.press('ArrowRight');
  await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 460)));
  const after = await measure(page, '.text');
  assert.ok(Math.abs(after.rect.left - before.rect.left - 1) < 1);
  assert.equal(after.writes.at(-1).patch.element.style.display, 'inline-block');
});

test('selection frame follows independently measured corners under ancestor and element rotation', async t => {
  const browser = await launchBrowser(); t.after(() => browser.close());
  const page = await fixture(browser); await focus(page);
  await page.evaluate(() => {
    document.querySelector('.chart').style.transform = 'rotate(20deg) scale(1.5)';
    document.querySelector('.bar').style.rotate = '30deg';
  });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const session = await page.createCDPSession();
  await session.send('DOM.enable');
  const root = (await session.send('DOM.getDocument')).root.nodeId;
  const quad = async selector => {
    const { nodeId } = await session.send('DOM.querySelector', { nodeId: root, selector });
    return (await session.send('DOM.getBoxModel', { nodeId })).model.border;
  };
  const element = await quad('.bar');
  const frame = await quad('.akari-interaction-selection-frame');
  for (let i = 0; i < 8; i += 2) {
    assert.ok(Math.hypot(frame[i] - element[i], frame[i + 1] - element[i + 1]) < 1.5,
      JSON.stringify({ i, frame, element }));
  }
  const cursor = await page.evaluate(() => getComputedStyle(document.querySelector('.akari-interaction-handle.is-e')).cursor);
  assert.equal(cursor, 'nwse-resize');
});

test('idle focused frames do not mutate author style, then follow rotation and zoom', async t => {
  const browser = await launchBrowser(); t.after(() => browser.close());
  const page = await fixture(browser); await focus(page);
  const mutations = await page.evaluate(() => new Promise(resolve => {
    const element = document.querySelector('.bar');
    let count = 0, frames = 0;
    const observer = new MutationObserver(records => { count += records.length; });
    observer.observe(element, { attributes: true });
    const next = () => {
      if (++frames >= 24) { observer.disconnect(); resolve(count); }
      else requestAnimationFrame(next);
    };
    requestAnimationFrame(next);
  }));
  assert.equal(mutations, 0);
  await page.evaluate(() => {
    document.querySelector('.chart').style.transform = 'rotate(20deg) scale(1.5)';
    const stage = document.querySelector('#overlay-stage');
    stage.style.transformOrigin = '0 0';
    stage.style.transform = 'scale(0.8)';
  });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const session = await page.createCDPSession(); await session.send('DOM.enable');
  const root = (await session.send('DOM.getDocument')).root.nodeId;
  const quad = async selector => {
    const { nodeId } = await session.send('DOM.querySelector', { nodeId: root, selector });
    return (await session.send('DOM.getBoxModel', { nodeId })).model.border;
  };
  const element = await quad('.bar'), frame = await quad('.akari-interaction-selection-frame');
  for (let i = 0; i < 8; i += 2) {
    assert.ok(Math.hypot(element[i] - frame[i], element[i + 1] - frame[i + 1]) < 1.5,
      JSON.stringify({ i, element, frame }));
  }
});

test('returning from element focus restores the original ten item handle styles and positions', async t => {
  const browser = await launchBrowser(); t.after(() => browser.close());
  const tree = [{ id: 'chart', parentId: null, kind: 'leaf', label: 'chart' }];
  const baseline = await fixture(browser, BOX_FRAGMENTS.bars, true, tree);
  await baseline.evaluate(() => window.akari.interaction.selectFromTimeline('chart'));
  const focused = await fixture(browser, BOX_FRAGMENTS.bars, true, tree); await focus(focused);
  for (let i = 0; i < 5; i++) {
    if (!(await focused.evaluate(() => window.akari.interaction.elementFocus))) break;
    await focused.keyboard.press('Escape');
  }
  const settleFrames = () => new Promise(resolve => {
    let frames = 0;
    const next = () => { if (++frames >= 5) resolve(); else requestAnimationFrame(next); };
    requestAnimationFrame(next);
  });
  await baseline.evaluate(settleFrames);
  await focused.evaluate(settleFrames);
  const focusAfter = await focused.evaluate(() => window.akari.interaction.elementFocus);
  assert.equal(focusAfter, null);
  const snapshot = page => page.evaluate(() => {
    const frame = document.querySelector('.akari-interaction-selection-frame');
    const frameRect = frame.getBoundingClientRect();
    return [...frame.querySelectorAll('.akari-interaction-handle')]
      .filter(handle => !handle.classList.contains('is-line-start') && !handle.classList.contains('is-line-end'))
      .map(handle => {
        const rect = handle.getBoundingClientRect();
        return { className: handle.className, style: handle.getAttribute('style'),
          x: rect.left + rect.width / 2 - frameRect.left,
          y: rect.top + rect.height / 2 - frameRect.top,
          display: getComputedStyle(handle).display };
      });
  });
  const before = await snapshot(baseline), after = await snapshot(focused);
  assert.equal(before.length, 10);
  assert.deepEqual(after, before);
});

test('remount and synthetic host selection retain the same element ref and its nine handles', async t => {
  const browser = await launchBrowser(); t.after(() => browser.close());
  const tree = [{ id: 'chart', parentId: null, kind: 'leaf', label: 'chart' }];
  const page = await fixture(browser, BOX_FRAGMENTS.bars, true, tree); await focus(page);
  assert.equal((await measure(page)).focus?.ref, '.bar[0]');
  await page.evaluate(async next => {
    window.akari.state.summary.overlays[0].html = next;
    await window.akari.runtime.mount(window.akari.state.summary);
    window.akari.runtime.tick(1, true);
    const owner = document.querySelector('[data-overlay-id="chart"]');
    const bounds = owner.querySelector('.chart').getBoundingClientRect();
    owner.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true,
      clientX: bounds.left + bounds.width / 2, clientY: bounds.top + bounds.height / 2 }));
    window.akari.interaction.selectFromTimeline('chart');
  }, BOX_FRAGMENTS.bars.replace('>55<', '>56<'));
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const state = await measure(page);
  assert.equal(state.focus?.ref, '.bar[0]');
  assert.equal(Object.values(state.handles).filter(handle => handle.visible).length, 9);
  assert.equal(state.handles.move.visible, false);
});

test('capability flag selects bar handles while its absence retains ten item handles', async t => {
  const browser = await launchBrowser(); t.after(() => browser.close());
  const enabled = await fixture(browser, BOX_FRAGMENTS.bars, true); await focus(enabled);
  const element = await measure(enabled);
  assert.equal(element.focus?.ref, '.bar[0]');
  assert.equal(Object.values(element.handles).filter(handle => handle.visible).length, 9);
  const disabled = await fixture(browser, BOX_FRAGMENTS.bars, false); await focus(disabled);
  const item = await measure(disabled);
  assert.equal(item.focus, null);
  assert.equal(Object.values(item.handles).filter(handle => handle.visible).length, 10);
});

test('an authored important width leaves measured frame on the unchanged box', async t => {
  const browser = await launchBrowser(); t.after(() => browser.close());
  const page = await fixture(browser);
  await page.addStyleTag({ content: '#overlay-stage .bar { width: 50px !important; }' });
  await focus(page);
  const before = await measure(page);
  await drag(page, before.handles.e, 30, 0);
  const after = await measure(page);
  const frameWidth = await page.evaluate(() => document.querySelector('.akari-interaction-selection-frame')
    .getBoundingClientRect().width);
  assert.ok(Math.abs(after.rect.width - before.rect.width) < 1, JSON.stringify({ before, after }));
  assert.ok(Math.abs(frameWidth - after.rect.width) < 1);
  assert.ok(after.writes.at(-1)?.patch.element.style.width);
  assert.equal(await page.evaluate(() => window.errors?.length ?? 0), 0);
});

test('rotated ancestor and element keep the opposite edge fixed while resizing', async t => {
  const browser = await launchBrowser(); t.after(() => browser.close());
  const page = await fixture(browser); await focus(page);
  await page.evaluate(() => {
    document.querySelector('.chart').style.transform = 'rotate(20deg) scale(1.5)';
    document.querySelector('.bar').style.rotate = '30deg';
  });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const session = await page.createCDPSession(); await session.send('DOM.enable');
  const root = (await session.send('DOM.getDocument')).root.nodeId;
  const quad = async () => {
    const { nodeId } = await session.send('DOM.querySelector', { nodeId: root, selector: '.bar' });
    return (await session.send('DOM.getBoxModel', { nodeId })).model.border;
  };
  const before = await quad();
  const handle = (await measure(page)).handles.e;
  const axis = { x: before[2] - before[0], y: before[3] - before[1] };
  const length = Math.hypot(axis.x, axis.y);
  await drag(page, handle, axis.x / length * 30, axis.y / length * 30);
  const after = await quad();
  const middle = q => ({ x: (q[0] + q[6]) / 2, y: (q[1] + q[7]) / 2 });
  const a = middle(before), b = middle(after);
  assert.ok(Math.hypot(a.x - b.x, a.y - b.y) < 1, JSON.stringify({ before, after }));
  const right = { x: (after[2] + after[4]) / 2, y: (after[3] + after[5]) / 2 };
  const pointer = { x: handle.x + axis.x / length * 30,
    y: handle.y + axis.y / length * 30 };
  assert.ok(Math.hypot(right.x - pointer.x, right.y - pointer.y) < 1.5,
    JSON.stringify({ right, pointer }));
  assert.ok((await measure(page)).writes.at(-1).patch.element.style.width);
});
