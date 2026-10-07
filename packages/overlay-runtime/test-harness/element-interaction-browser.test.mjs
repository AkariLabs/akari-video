import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { launchBrowser } from './fixtures/browser.mjs';
import { applyElementOverrides } from '../src/parts.mjs';
import { FRAGMENTS } from '../../../apps/shell/extensions/akari-preview/evidence/preview-element-select-move-v1/scripts/fixtures.mjs';

const runtime = readFileSync(new URL('../src/overlay-runtime.js', import.meta.url), 'utf8');
const interaction = readFileSync(new URL('../src/interaction.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/interaction.css', import.meta.url), 'utf8');
const html = '<div class="chart" style="position:absolute;left:70px;top:60px;display:flex;gap:12px;align-items:end;height:130px">'
  + Array.from({ length: 5 }, (_, index) => `<div class="bar" style="background:#48f;width:28px;height:${50 + index * 15}px"></div>`).join('')
  + '</div>';
const evidenceFragment = name => FRAGMENTS[name];

async function fixture(browser, enabled, { id = 'chart', fragment = html, tree } = {}) {
  const page = await browser.newPage();
  await page.setViewport({ width: 640, height: 360 });
  await page.setContent(`<style>body{margin:0}#overlay-stage{position:relative;width:640px;height:360px}${css}</style>
    <nav data-akari-ui="preview-scope-breadcrumb" hidden></nav><div id="overlay-stage"></div>`);
  await page.evaluate(({ fragment, enabled, id, tree }) => {
    window.writes = [];
    window.akari = { state: { editPath: 'fixture', summary: { output: { width: 640, height: 360 },
      overlays: [{ id, html: fragment, elementSelection: true, elements: {}, start: 0, duration: 20,
        transform: { x: 0, y: 0, scale: 1, rotate: 0 } }], ...(tree ? { tree } : {}) } },
      ...(enabled ? { capabilities: { elementSelection: true } } : {}),
      stageScale: () => 1,
      showWriteError: error => (window.errors ??= []).push(String(error)),
      engine: { overlayWrite: async (_path, id, patch) => {
        window.writes.push({ id, patch });
        if (window.rejectWrite) throw new Error('element ref rejected');
      } } };
  }, { fragment, enabled, id, tree });
  await page.addScriptTag({ content: runtime });
  await page.addScriptTag({ content: interaction });
  await page.evaluate(async () => { await window.akari.runtime.mount(window.akari.state.summary); window.akari.runtime.tick(1, true); });
  return page;
}
const state = page => page.evaluate(() => {
  const element = document.querySelectorAll('.bar')[2];
  const frame = document.querySelector('.akari-interaction-selection-frame');
  const rect = element.getBoundingClientRect();
  const bounds = frame?.getBoundingClientRect();
  return { id: window.akari.interaction.selectedId, focus: window.akari.interaction.elementFocus,
    element: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
    chartTop: document.querySelector('.chart')?.getBoundingClientRect().top,
    translate: element.style.translate,
    frame: bounds && { x: bounds.left, y: bounds.top, width: bounds.width, height: bounds.height },
    visibleHandles: frame ? [...frame.querySelectorAll('.akari-interaction-handle')]
      .filter(handle => getComputedStyle(handle).display !== 'none').length : null,
    writes: window.writes, breadcrumb: document.querySelector('[data-akari-ui="preview-scope-breadcrumb"]')?.textContent };
});

test('failed element write restores the authored inline value', async t => {
  const browser = await launchBrowser(); t.after(() => browser.close());
  const page = await fixture(browser, true);
  const p = await point(page);
  await page.mouse.click(p.x, p.y);
  const start = (await state(page)).element;
  await page.evaluate(() => { window.rejectWrite = true; });
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 24, start.y - 18, { steps: 4 });
  await page.mouse.up();
  await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 50)));
  const restored = await state(page);
  assert.ok(Math.abs(restored.element.x - start.x) < 1);
  assert.ok(Math.abs(restored.element.y - start.y) < 1);
  assert.equal(restored.translate, '');
});
test('arrows move the focused element and coalesce a key burst', async t => {
  const browser = await launchBrowser(); t.after(() => browser.close());
  const page = await fixture(browser, true);
  const p = await point(page);
  await page.mouse.click(p.x, p.y);
  const start = (await state(page)).element;
  for (let index = 0; index < 3; index++) await page.keyboard.press('ArrowRight');
  await page.keyboard.down('Shift');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.up('Shift');
  await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 450)));
  const after = await state(page);
  assert.ok(Math.abs(after.element.x - start.x - 13) < 1, JSON.stringify(after));
  assert.equal(after.writes.length, 1);
  assert.equal(after.writes[0].patch.element.ref, '.bar[2]');
});
test('SVG, telop and classless card hits choose their eligible ancestors', async t => {
  const browser = await launchBrowser(); t.after(() => browser.close());
  for (const [id, selector, expected] of [
    ['svg', 'rect', '.mini-chart[0]'],
    ['telop', '.text', '.text[0]'],
    ['card', 'p', '.card[0]']
  ]) {
    const page = await fixture(browser, true, { id, fragment: evidenceFragment(id) });
    const p = await page.evaluate(selector => {
      const rect = document.querySelector(selector).getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    }, selector);
    await page.mouse.click(p.x, p.y);
    const focus = await page.evaluate(() => window.akari.interaction.elementFocus);
    assert.equal(focus?.ref, expected, `${id}: ${JSON.stringify(await page.evaluate(({ p, selector }) => ({
      target: document.elementFromPoint(p.x, p.y)?.outerHTML?.slice(0, 200),
      selected: document.querySelector(selector)?.outerHTML?.slice(0, 200) }), { p, selector }))}`);
    if (id === 'telop') {
      await page.keyboard.press('Escape');
      assert.equal((await page.evaluate(() => window.akari.interaction.elementFocus))?.ref, '.plate[0]');
      await page.keyboard.press('Escape');
      assert.equal(await page.evaluate(() => window.akari.interaction.elementFocus), null);
      await page.keyboard.press('Enter');
      assert.equal((await page.evaluate(() => window.akari.interaction.elementFocus))?.ref, '.plate[0]');
      await page.keyboard.down('Shift');
      await page.keyboard.press('Enter');
      await page.keyboard.up('Shift');
      assert.equal(await page.evaluate(() => window.akari.interaction.elementFocus), null);
      await page.keyboard.press('Escape');
      assert.equal(await page.evaluate(() => window.akari.interaction.selectedId), null);
    }
  }
});
test('hover frame follows the eligible text and plate rectangles', async t => {
  const browser = await launchBrowser(); t.after(() => browser.close());
  const page = await fixture(browser, true, { id: 'telop', fragment: evidenceFragment('telop') });
  const measure = selector => page.evaluate(selector => {
    const r = document.querySelector(selector).getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height,
      cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
  }, selector);
  const hovered = () => page.evaluate(() => {
    const frame = document.querySelector('[data-akari-ui="preview-hover-frame"]');
    if (!frame || frame.hidden) return null;
    const r = frame.getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  });
  const text = await measure('.text');
  await page.mouse.move(text.cx, text.cy);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const textHover = await hovered();
  assert.ok(textHover && Math.abs(textHover.left - text.left) < 1
    && Math.abs(textHover.width - text.width) < 1, JSON.stringify(textHover));
  const plate = await measure('.plate');
  await page.mouse.move(plate.left + 5, plate.top + 5);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const plateHover = await hovered();
  assert.ok(plateHover && Math.abs(plateHover.left - plate.left) < 1
    && Math.abs(plateHover.width - plate.width) < 1, JSON.stringify(plateHover));
});
test('blank stage click clears element focus, frame and breadcrumb together', async t => {
  const browser = await launchBrowser(); t.after(() => browser.close());
  const page = await fixture(browser, true, { id: 'card', fragment: evidenceFragment('card') });
  const p = await page.evaluate(() => {
    const r = document.querySelector('.card p').getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await page.mouse.click(p.x, p.y);
  const before = await page.evaluate(() => ({ focus: window.akari.interaction.elementFocus,
    breadcrumb: document.querySelector('[data-akari-ui="preview-scope-breadcrumb"]').textContent }));
  assert.equal(before.focus?.ref, '.card[0]');
  assert.match(before.breadcrumb, /card/);
  await page.mouse.click(610, 320);
  const after = await page.evaluate(() => {
    const nav = document.querySelector('[data-akari-ui="preview-scope-breadcrumb"]');
    const frame = document.querySelector('.akari-interaction-selection-frame');
    return { id: window.akari.interaction.selectedId, focus: window.akari.interaction.elementFocus,
      breadcrumb: nav.textContent, hidden: nav.hidden, frame: Boolean(frame?.isConnected && !frame.hidden) };
  });
  assert.deepEqual(after, { id: null, focus: null, breadcrumb: '', hidden: true, frame: false });
});
test('breadcrumb labels use sibling numbers and ids, and each level is clickable', async t => {
  const browser = await launchBrowser(); t.after(() => browser.close());
  const fragment = `<div><div class="plate" style="position:absolute;left:40px;top:40px;width:300px;height:100px;background:#345">
    <span class="text" style="display:inline-block;margin:20px;color:white">ONE</span>
    <span class="text" id="named" style="display:inline-block;margin:20px;color:white">TWO</span>
  </div></div>`;
  const page = await fixture(browser, true, { id: 'card', fragment });
  const clickSelector = async selector => {
    const p = await page.evaluate(selector => {
      const r = document.querySelector(selector).getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }, selector);
    await page.mouse.click(p.x, p.y);
  };
  const clickCrumb = async label => {
    const p = await page.evaluate(label => {
      const button = [...document.querySelectorAll('[data-akari-ui="preview-scope-breadcrumb"] button')]
        .find(candidate => candidate.textContent === label);
      if (!button) return null;
      const r = button.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }, label);
    assert.ok(p, label);
    await page.mouse.click(p.x, p.y);
  };
  await clickSelector('.text');
  assert.equal((await page.evaluate(() => window.akari.interaction.elementFocus))?.label, 'text 1');
  assert.match(await page.evaluate(() => document.querySelector('[data-akari-ui="preview-scope-breadcrumb"]').textContent),
    /全体 › card › plate › text 1/);
  await clickSelector('#named');
  assert.equal((await page.evaluate(() => window.akari.interaction.elementFocus))?.label, '#named');
  await clickCrumb('plate');
  assert.equal((await page.evaluate(() => window.akari.interaction.elementFocus))?.ref, '.plate[0]');
  await clickCrumb('card');
  assert.equal(await page.evaluate(() => window.akari.interaction.elementFocus), null);
});
test('delete shortcuts are blocked while another owner command still reaches the host', async t => {
  const browser = await launchBrowser(); t.after(() => browser.close());
  const page = await fixture(browser, true);
  const p = await point(page);
  await page.mouse.click(p.x, p.y);
  await page.evaluate(() => window.addEventListener('keydown', event => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'd') {
      window.commandOwner = window.akari.interaction.selectedId;
    }
  }));
  await page.keyboard.press('Delete');
  await page.keyboard.press('Backspace');
  await page.keyboard.down(process.platform === 'darwin' ? 'Meta' : 'Control');
  await page.keyboard.press('x');
  await page.keyboard.press('d');
  await page.keyboard.up(process.platform === 'darwin' ? 'Meta' : 'Control');
  const observed = await page.evaluate(() => ({ id: window.akari.interaction.selectedId,
    focus: window.akari.interaction.elementFocus, errors: window.errors, commandOwner: window.commandOwner }));
  assert.equal(observed.id, 'chart');
  assert.equal(observed.focus?.ref, '.bar[2]');
  assert.equal(observed.errors.length, 3);
  assert.ok(observed.errors.every(error => error.includes('要素は削除できません（Esc でアイテムを選ぶと削除できます）')));
  assert.equal(observed.commandOwner, 'chart');
});
test('focused controls keep native deletion and cut keys while an element is selected', async t => {
  const browser = await launchBrowser(); t.after(() => browser.close());
  const page = await fixture(browser, true);
  const p = await point(page);
  await page.mouse.click(p.x, p.y);
  await page.evaluate(() => {
    const input = document.createElement('input');
    input.value = 'abc';
    document.body.appendChild(input);
    window.passedKeys = [];
    window.addEventListener('keydown', event => {
      if (['Delete', 'Backspace', 'x'].includes(event.key)) {
        window.passedKeys.push({ key: event.key, prevented: event.defaultPrevented });
      }
    });
    input.focus(); input.setSelectionRange(3, 3);
  });
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Delete');
  await page.keyboard.down(process.platform === 'darwin' ? 'Meta' : 'Control');
  await page.keyboard.press('x');
  await page.keyboard.up(process.platform === 'darwin' ? 'Meta' : 'Control');
  const observed = await page.evaluate(() => {
    const input = document.querySelector('input');
    const activeOnly = new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true });
    window.dispatchEvent(activeOnly);
    input.blur();
    const targetOnly = new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true });
    input.dispatchEvent(targetOnly);
    const editor = document.createElement('div');
    editor.contentEditable = 'true'; editor.textContent = 'text';
    document.body.appendChild(editor); editor.focus();
    const editable = new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true });
    editor.dispatchEvent(editable);
    return { value: input.value, keys: window.passedKeys, errors: window.errors ?? [],
      activeOnlyPrevented: activeOnly.defaultPrevented, targetOnlyPrevented: targetOnly.defaultPrevented,
      editablePrevented: editable.defaultPrevented, focus: window.akari.interaction.elementFocus };
  });
  assert.equal(observed.value, 'ab');
  assert.equal(observed.errors.length, 0);
  assert.ok(observed.keys.length >= 3 && observed.keys.every(entry => entry.prevented === false),
    JSON.stringify(observed.keys));
  assert.equal(observed.activeOnlyPrevented, false);
  assert.equal(observed.targetOnlyPrevented, false);
  assert.equal(observed.editablePrevented, false);
  assert.equal(observed.focus?.ref, '.bar[2]');
});
test('Shift click and blank marquee clear focus; double click still edits text', async t => {
  const browser = await launchBrowser(); t.after(() => browser.close());
  const page = await fixture(browser, true);
  let p = await point(page);
  await page.mouse.click(p.x, p.y);
  await page.keyboard.down('Shift');
  await page.mouse.click(p.x, p.y);
  await page.keyboard.up('Shift');
  assert.equal(await page.evaluate(() => window.akari.interaction.elementFocus), null);
  p = await point(page);
  await page.mouse.click(p.x, p.y);
  assert.equal((await page.evaluate(() => window.akari.interaction.elementFocus))?.ref, '.bar[2]');
  await page.mouse.move(500, 300);
  await page.mouse.down();
  await page.mouse.move(530, 320, { steps: 3 });
  await page.mouse.up();
  assert.equal(await page.evaluate(() => window.akari.interaction.elementFocus), null);
  const textPage = await fixture(browser, true, { id: 'telop', fragment: evidenceFragment('telop') });
  const at = await textPage.evaluate(() => {
    const r = document.querySelector('.text').getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await textPage.mouse.click(at.x, at.y);
  const textPoint = await textPage.evaluate(() => {
    const r = document.querySelector('.text').getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  const cdp = await textPage.createCDPSession();
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: textPoint.x, y: textPoint.y });
  for (let count = 1; count <= 2; count++) {
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: textPoint.x, y: textPoint.y,
      button: 'left', clickCount: count });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: textPoint.x, y: textPoint.y,
      button: 'left', clickCount: count });
  }
  await cdp.detach();
  assert.equal(await textPage.evaluate(() => window.akari.interaction.activeEdit), true);
});
test('Escape cancels an element drag without clearing focus', async t => {
  const browser = await launchBrowser(); t.after(() => browser.close());
  const page = await fixture(browser, true);
  const p = await point(page);
  await page.mouse.click(p.x, p.y);
  const before = (await state(page)).element;
  await page.mouse.move(before.x, before.y);
  await page.mouse.down();
  await page.mouse.move(before.x + 25, before.y + 12, { steps: 4 });
  await page.keyboard.press('Escape');
  await page.mouse.up();
  const after = await state(page);
  assert.equal(after.focus?.ref, '.bar[2]');
  assert.ok(Math.abs(after.element.x - before.x) < 1 && Math.abs(after.element.y - before.y) < 1);
  assert.equal(after.writes.length, 0);
});
test('Enter with no eligible descendant keeps the existing item behavior', async t => {
  const browser = await launchBrowser(); t.after(() => browser.close());
  const page = await fixture(browser, true, { fragment:
    '<div style="position:absolute;left:70px;top:60px;width:160px;height:60px;background:#345;color:white">Plain</div>' });
  await page.mouse.click(100, 90);
  assert.equal(await page.evaluate(() => window.akari.interaction.selectedId), 'chart');
  await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(() => window.akari.interaction.elementFocus), null);
  assert.equal(await page.evaluate(() => window.akari.interaction.selectedId), 'chart');
});
test('switching owners cannot reuse the same element address', async t => {
  const browser = await launchBrowser(); t.after(() => browser.close());
  const page = await fixture(browser, true);
  const p = await point(page);
  await page.mouse.click(p.x, p.y);
  assert.equal((await page.evaluate(() => window.akari.interaction.elementFocus))?.ref, '.bar[2]');
  await page.evaluate(async () => {
    const first = window.akari.state.summary.overlays[0];
    window.akari.state.summary.overlays.push({ ...first, id: 'other' });
    await window.akari.runtime.mount(window.akari.state.summary);
    window.akari.runtime.tick(1, true);
    const other = document.querySelector('[data-overlay-id="other"]');
    other.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true,
      clientX: 170, clientY: 150 }));
  });
  const selected = await page.evaluate(() => ({ id: window.akari.interaction.selectedId,
    focus: window.akari.interaction.elementFocus }));
  assert.equal(selected.id, 'other');
  assert.equal(selected.focus, null);
});
test('group keeps its first click and permits element focus inside', async t => {
  const browser = await launchBrowser(); t.after(() => browser.close());
  const page = await fixture(browser, true, { id: 'leaf', tree: [
    { id: 'group', parentId: null, kind: 'group', label: 'Group', transform: {} },
    { id: 'leaf', parentId: 'group', kind: 'leaf', label: 'Leaf' }
  ] });
  let p = await point(page);
  await page.mouse.click(p.x, p.y);
  assert.equal(await page.evaluate(() => window.akari.interaction.selectedId), 'group');
  p = await point(page);
  const cdp = await page.createCDPSession();
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y });
  for (let count = 1; count <= 2; count++) {
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y,
      button: 'left', clickCount: count });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y,
      button: 'left', clickCount: count });
  }
  await cdp.detach();
  p = await point(page);
  await page.mouse.click(p.x, p.y);
  assert.equal((await page.evaluate(() => window.akari.interaction.elementFocus))?.ref, '.bar[2]',
    JSON.stringify(await page.evaluate(() => ({ id: window.akari.interaction.selectedId,
      scope: window.akari.interaction.scopeId, focus: window.akari.interaction.elementFocus }))));
});
test('direct modifier click enters a group leaf and its element', async t => {
  const browser = await launchBrowser(); t.after(() => browser.close());
  const page = await fixture(browser, true, { id: 'leaf', tree: [
    { id: 'group', parentId: null, kind: 'group', label: 'Group', transform: {} },
    { id: 'leaf', parentId: 'group', kind: 'leaf', label: 'Leaf' }
  ] });
  const p = await point(page);
  const modifiers = process.platform === 'darwin' ? 4 : 2;
  const cdp = await page.createCDPSession();
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y, modifiers });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y,
    button: 'left', clickCount: 1, modifiers });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y,
    button: 'left', clickCount: 1, modifiers });
  await cdp.detach();
  const selected = await page.evaluate(() => ({ id: window.akari.interaction.selectedId,
    focus: window.akari.interaction.elementFocus }));
  assert.equal(selected.id, 'leaf');
  assert.equal(selected.focus?.ref, '.bar[2]', JSON.stringify(selected));
});
test('timeline selection can receive a modifier hit point and notify element focus', async t => {
  const browser = await launchBrowser(); t.after(() => browser.close());
  const tree = [
    { id: 'group', parentId: null, kind: 'group', label: 'Group', transform: {} },
    { id: 'leaf', parentId: 'group', kind: 'leaf', label: 'Leaf' }
  ];
  const page = await fixture(browser, true, { id: 'leaf', tree });
  await page.evaluate(() => {
    window.focusEvents = [];
    window.addEventListener('akari-preview-scope-selection', event => {
      window.focusEvents.push({ notify: event.detail.notify,
        element: window.akari.interaction.elementFocus });
    });
    window.akari.interaction.selectFromTimeline('leaf');
  });
  const p = await point(page);
  const observed = await page.evaluate(({ x, y }) => {
    const handled = window.akari.interaction.focusElementAtPoint('leaf', x, y);
    return { handled, id: window.akari.interaction.selectedId,
      focus: window.akari.interaction.elementFocus, events: window.focusEvents };
  }, p);
  assert.equal(observed.handled, true);
  assert.equal(observed.id, 'leaf');
  assert.equal(observed.focus?.ref, '.bar[2]');
  assert.ok(observed.events.some(entry => entry.notify === true && entry.element?.ref === '.bar[2]'));
  const cleared = await page.evaluate(() => {
    window.akari.interaction.clearElementFocus();
    return { focus: window.akari.interaction.elementFocus, event: window.focusEvents.at(-1) };
  });
  assert.equal(cleared.focus, null);
  assert.equal(cleared.event.notify, false);
});
test('point focus retries a same-frame timeline selection once it reaches the leaf', async t => {
  const browser = await launchBrowser(); t.after(() => browser.close());
  const page = await fixture(browser, true, { id: 'leaf', tree: [
    { id: 'group', parentId: null, kind: 'group', label: 'Group', transform: {} },
    { id: 'leaf', parentId: 'group', kind: 'leaf', label: 'Leaf' }
  ] });
  const p = await point(page);
  const immediate = await page.evaluate(({ x, y }) => {
    const result = window.akari.interaction.focusElementAtPoint('leaf', x, y);
    window.akari.interaction.selectFromTimeline('leaf');
    return result;
  }, p);
  assert.equal(immediate, false);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal((await page.evaluate(() => window.akari.interaction.elementFocus))?.ref, '.bar[2]');
});
test('point focus ignores disabled, bag, wrong id and multi selection, and leaves blank points at item level', async t => {
  const browser = await launchBrowser(); t.after(() => browser.close());
  const tree = [
    { id: 'group', parentId: null, kind: 'group', label: 'Group', transform: {} },
    { id: 'leaf', parentId: 'group', kind: 'leaf', label: 'Leaf' }
  ];
  for (const [enabled, eligible] of [[false, true], [true, false]]) {
    const page = await fixture(browser, enabled, { id: 'leaf', tree });
    await page.evaluate(eligible => {
      window.akari.state.summary.overlays[0].elementSelection = eligible;
      window.akari.interaction.selectFromTimeline('leaf');
    }, eligible);
    const p = await point(page);
    const result = await page.evaluate(({ x, y }) => window.akari.interaction.focusElementAtPoint('leaf', x, y), p);
    assert.equal(result, false);
    assert.equal(await page.evaluate(() => window.akari.interaction.elementFocus), null);
  }
  const page = await fixture(browser, true, { id: 'leaf', tree });
  await page.evaluate(() => window.akari.interaction.selectFromTimeline('leaf'));
  const p = await point(page);
  assert.equal(await page.evaluate(({ x, y }) => window.akari.interaction.focusElementAtPoint('wrong', x, y), p), false);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(await page.evaluate(() => window.akari.interaction.elementFocus), null);
  assert.equal(await page.evaluate(() => window.akari.interaction.focusElementAtPoint('leaf', 600, 300)), true);
  assert.equal(await page.evaluate(() => window.akari.interaction.elementFocus), null);
  await page.evaluate(async () => {
    const summary = window.akari.state.summary;
    summary.overlays.push({ ...summary.overlays[0], id: 'other', transform: { x: 200, y: 0, scale: 1, rotate: 0 } });
    summary.tree.push({ id: 'other', parentId: 'group', kind: 'leaf', label: 'Other' });
    await window.akari.runtime.mount(summary);
    window.akari.runtime.tick(1, true);
    window.akari.interaction.selectFromTimeline('leaf');
  });
  const other = await page.evaluate(() => {
    const r = document.querySelectorAll('[data-overlay-id="other"] .bar')[2].getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await page.keyboard.down('Shift');
  await page.mouse.click(other.x, other.y);
  await page.keyboard.up('Shift');
  const multi = await page.evaluate(({ x, y }) => ({ ids: window.akari.interaction.selectedIds,
    handled: window.akari.interaction.focusElementAtPoint('other', x, y),
    focus: window.akari.interaction.elementFocus }), other);
  assert.equal(multi.ids.length, 2, JSON.stringify(multi));
  assert.equal(multi.handled, false);
  assert.equal(multi.focus, null);
});
test('remount and synthetic host selection keep the original ref, then clear a missing ref', async t => {
  const browser = await launchBrowser(); t.after(() => browser.close());
  const fragment = `<div class="chart" style="position:absolute;left:40px;top:40px;width:320px;height:160px;background:#ddd">
    <div class="bar" style="position:absolute;left:20px;top:20px;width:30px;height:80px;background:#18a878"></div>
    <div class="other" style="position:absolute;left:125px;top:65px;width:70px;height:40px;background:#3479c0"></div>
  </div>`;
  const page = await fixture(browser, true, { fragment });
  const at = await page.evaluate(() => {
    const r = document.querySelector('.bar').getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await page.mouse.click(at.x, at.y);
  const initial = await page.evaluate(() => window.akari.interaction.elementFocus);
  assert.equal(initial?.ref, '.bar[0]');
  const moved = applyElementOverrides(fragment, { '.bar[0]': { style: { translate: '20px 0px' } } })[0];
  await page.evaluate(async next => {
    window.akari.state.summary.overlays[0].html = next;
    await window.akari.runtime.mount(window.akari.state.summary);
    window.akari.runtime.tick(1, true);
    const owner = document.querySelector('[data-overlay-id="chart"]');
    const center = owner.querySelector('.chart').getBoundingClientRect();
    owner.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true,
      clientX: center.left + center.width / 2, clientY: center.top + center.height / 2 }));
  }, moved);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const restored = await page.evaluate(() => {
    const frame = document.querySelector('.akari-interaction-selection-frame');
    const element = document.querySelector('.bar');
    const a = frame.getBoundingClientRect(), b = element.getBoundingClientRect();
    return { id: window.akari.interaction.selectedId, focus: window.akari.interaction.elementFocus,
      difference: Math.max(Math.abs(a.left - b.left), Math.abs(a.top - b.top),
        Math.abs(a.width - b.width), Math.abs(a.height - b.height)),
      handles: [...frame.querySelectorAll('.akari-interaction-handle')]
        .filter(handle => getComputedStyle(handle).display !== 'none').length };
  });
  assert.equal(restored.id, 'chart');
  assert.equal(restored.focus?.ref, '.bar[0]');
  assert.ok(restored.difference < 1, JSON.stringify(restored));
  assert.equal(restored.handles, 9);
  await page.evaluate(async () => {
    window.akari.state.summary.overlays[0].html = '<div class="chart" style="position:absolute;left:40px;top:40px;width:320px;height:160px;background:#ddd"><div class="other" style="width:70px;height:40px;background:#3479c0"></div></div>';
    await window.akari.runtime.mount(window.akari.state.summary);
    window.akari.runtime.tick(1, true);
  });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const missing = await page.evaluate(() => ({ focus: window.akari.interaction.elementFocus,
    handles: [...document.querySelectorAll('.akari-interaction-selection-frame .akari-interaction-handle')]
      .filter(handle => getComputedStyle(handle).display !== 'none').length }));
  assert.equal(missing.focus, null);
  assert.ok(missing.handles > 0);
});
const point = page => page.evaluate(() => {
  const rect = document.querySelectorAll('.bar')[2].getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
});

test('shell capability selects and moves a bar; default keeps item selection', async t => {
  const browser = await launchBrowser(); t.after(() => browser.close());
  const page = await fixture(browser, true);
  const p = await point(page);
  await page.mouse.click(p.x, p.y);
  let current = await state(page);
  assert.equal(current.id, 'chart');
  assert.equal(current.focus?.ref, '.bar[2]');
  assert.equal(current.visibleHandles, 7);
  assert.match(current.breadcrumb, /bar 3/);
  assert.ok(Math.abs(current.frame.x + current.frame.width / 2 - current.element.x) < 1);
  const start = current.element;
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 60, start.y - 40, { steps: 5 });
  await page.mouse.up();
  current = await state(page);
  assert.ok(Math.abs(current.element.x - start.x - 60) < 1);
  assert.ok(Math.abs(current.element.y - start.y + 40) < 1, JSON.stringify(current));
  assert.equal(current.writes.at(-1)?.patch.element.ref, '.bar[2]');
  const remounted = applyElementOverrides(html,
    { '.bar[2]': { style: { translate: current.writes.at(-1).patch.element.style.translate } } })[0];
  await page.evaluate(async nextHtml => {
    const overlay = window.akari.state.summary.overlays[0];
    overlay.html = nextHtml;
    overlay.elements = { '.bar[2]': { style: { translate: window.writes.at(-1).patch.element.style.translate } } };
    await window.akari.runtime.mount(window.akari.state.summary);
    window.akari.runtime.tick(1, true);
  }, remounted);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const afterMount = await state(page);
  assert.equal(afterMount.focus?.ref, '.bar[2]');
  assert.ok(Math.abs(afterMount.frame.x + afterMount.frame.width / 2 - afterMount.element.x) < 1);
  assert.ok(Math.abs(afterMount.element.x - current.element.x) < 1);
  assert.ok(Math.abs(afterMount.element.y - current.element.y) < 1);
  await page.keyboard.press('Escape');
  assert.equal((await state(page)).focus, null);
  await page.keyboard.press('Enter');
  assert.equal((await state(page)).focus?.ref, '.bar[0]');
  await page.keyboard.down('Shift');
  await page.keyboard.press('Enter');
  await page.keyboard.up('Shift');
  assert.equal((await state(page)).focus, null);
  await page.keyboard.press('Escape');
  assert.equal((await state(page)).id, null);
  const defaultPage = await fixture(browser, false);
  const defaultPoint = await point(defaultPage);
  await defaultPage.mouse.move(defaultPoint.x, defaultPoint.y);
  await defaultPage.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const defaultHover = await defaultPage.evaluate(() => {
    const frame = document.querySelector('[data-akari-ui="preview-hover-frame"]');
    const chart = document.querySelector('.chart');
    return { hoverWidth: frame?.getBoundingClientRect().width,
      chartWidth: chart?.getBoundingClientRect().width };
  });
  assert.ok(Math.abs(defaultHover.hoverWidth - defaultHover.chartWidth) < 1, JSON.stringify(defaultHover));
  await defaultPage.mouse.click(defaultPoint.x, defaultPoint.y);
  assert.equal((await state(defaultPage)).focus, null);
});
