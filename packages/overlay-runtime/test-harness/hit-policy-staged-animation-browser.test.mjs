import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { launchBrowser } from './fixtures/browser.mjs';

const runtime = readFileSync(new URL('../src/overlay-runtime.js', import.meta.url), 'utf8');
const interaction = readFileSync(new URL('../src/interaction.js', import.meta.url), 'utf8');
const interactionCss = readFileSync(new URL('../src/interaction.css', import.meta.url), 'utf8');
const fragment = `<div class="fixture">
  <span class="late">late</span><span class="catch" data-akari-hit="catch"></span>
  <span class="pass" data-akari-hit="pass">pass</span>
  <svg class="icon" viewBox="0 0 50 40"><rect x="4" y="4" width="42" height="32" fill="red"/></svg>
</div><style>
.fixture{position:absolute;inset:0;pointer-events:none}
.late{position:absolute;left:100px;top:100px;width:100px;height:50px;display:grid;place-items:center;
  background:orange;opacity:0}
[data-akari-active] .late{animation:late-show 4.52s linear both}
@keyframes late-show{0%,40%{opacity:0} 41%,80%{opacity:1} 81%,100%{opacity:0}}
.catch{position:absolute;left:240px;top:100px;width:50px;height:50px}
.pass{position:absolute;left:310px;top:100px;width:50px;height:50px;background:blue}
.icon{position:absolute;left:380px;top:100px;width:50px;height:40px}
</style>`;

async function fixture(browser, elementSelection = true) {
  const page = await browser.newPage();
  await page.setViewport({ width: 640, height: 360 });
  await page.setContent(`<style>body{margin:0}#underlay{position:absolute;inset:0;background:#222}
    #overlay-stage{position:absolute;inset:0;pointer-events:none}${interactionCss}</style>
    <div id="underlay"><div id="overlay-stage"></div></div>`);
  await page.evaluate(({ fragment, elementSelection }) => {
    window.underlayDown = 0;
    window.writes = [];
    document.querySelector('#underlay').addEventListener('pointerdown', event => {
      if (event.target === document.querySelector('#underlay')) window.underlayDown++;
    });
    window.rootReads = [];
    const original = window.getComputedStyle;
    window.getComputedStyle = function (element, ...args) {
      if (element?.classList?.contains('fixture')
        && element.parentElement?.dataset?.overlayId === 'staged'
        // Other selection/hover code also reads the root; count policy visits.
        && new Error().stack?.includes('at visit')) {
        window.rootReads.push(performance.now());
      }
      return original.call(this, element, ...args);
    };
    const overlay = { id: 'staged', start: 0, duration: 4.5, html: fragment,
      elementSelection: true, elements: {}, transform: { x: 0, y: 0, scale: 1, rotate: 0 } };
    window.akari = { state: { editPath: 'fixture', summary: {
      output: { width: 640, height: 360, fps: 30 }, overlays: [overlay] } },
      capabilities: { elementSelection }, stageScale: () => 1,
      engine: { overlayWrite: async (_path, id, patch) => { window.writes.push({ id, patch }); } } };
  }, { fragment, elementSelection });
  await page.addScriptTag({ content: runtime });
  await page.addScriptTag({ content: interaction });
  await page.evaluate(async () => {
    await window.akari.runtime.mount(window.akari.state.summary);
    window.akari.runtime.tick(0, true);
  });
  return page;
}

const tick = (page, time, playing = true) => page.evaluate(({ time, playing }) => {
  window.akari.runtime.tick(time, playing);
}, { time, playing });
const state = page => page.evaluate(() => ({
  selected: window.akari.interaction.selectedId,
  focus: window.akari.interaction.elementFocus?.ref ?? null,
  late: getComputedStyle(document.querySelector('.late')).pointerEvents,
  reads: window.rootReads.length,
  underlayDown: window.underlayDown,
}));
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

async function installHostCapture(page) {
  // The host registers these after interaction.js, as the shell bootstrap does.
  await page.evaluate(() => {
    window.hostCapture = { playing: true, stopped: 0, downs: [], clicks: [], mixedHits: 0 };
    const label = target => target?.classList?.contains('late') ? 'late'
      : target?.id || target?.tagName?.toLowerCase() || null;
    window.addEventListener('pointerdown', event => {
      window.hostCapture.downs.push({ target: label(event.target), trusted: event.isTrusted });
      if (event.shiftKey || event.ctrlKey || event.metaKey) {
        if (event.target?.closest?.('[data-overlay-id]')) window.hostCapture.mixedHits++;
      }
      if (window.hostCapture.playing) {
        window.hostCapture.playing = false;
        window.hostCapture.stopped++;
      }
    }, true);
    window.addEventListener('click', event => {
      window.hostCapture.clicks.push({ target: label(event.target), trusted: event.isTrusted });
    }, true);
  });
}

test('staged opacity follows play, stop, reverse seek and re-entry without an ending tick', async t => {
  const browser = await launchBrowser(); t.after(() => browser.close());
  const page = await fixture(browser);
  await tick(page, 2.5, true);
  await tick(page, 2.5, false);
  await wait(180);
  assert.equal((await state(page)).late, 'auto');
  await page.mouse.click(150, 125);
  assert.equal((await state(page)).selected, 'staged');
  assert.match((await state(page)).focus, /late/);
  await tick(page, 4.4, false);
  await wait(180);
  assert.equal((await state(page)).late, 'none');
  await page.mouse.click(150, 125);
  assert.equal((await state(page)).underlayDown > 0, true);
  assert.equal((await state(page)).selected, null);
  await tick(page, 2.5, false);
  await wait(180);
  assert.equal((await state(page)).late, 'auto');
  await tick(page, 0, false);
  await wait(180);
  assert.equal((await state(page)).late, 'none', 'reverse seek must remove invisible hits');
  await tick(page, 5, false);
  await tick(page, 2.5, false);
  try {
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.late')).pointerEvents === 'auto',
      { timeout: 700 });
  } catch (error) {
    const diagnostic = await page.evaluate(() => {
      const container = document.querySelector('[data-overlay-id=staged]');
      const late = document.querySelector('.late');
      return { opacity: getComputedStyle(late).opacity, pointer: getComputedStyle(late).pointerEvents,
        active: container.hasAttribute('data-akari-active'), reads: window.rootReads.length,
        busy: window.akari.interaction.activePointerOperation, edit: window.akari.interaction.activeEdit,
        owner: window.akari.interaction.pointerOwner,
        animations: container.getAnimations({ subtree: true }).map(animation => ({
          pending: animation.pending, current: animation.currentTime, playState: animation.playState,
        })) };
    });
    throw new Error(`re-entry did not settle: ${JSON.stringify(diagnostic)}`, { cause: error });
  }
  assert.equal((await state(page)).late, 'auto', 're-entry must invalidate the WeakSet cache');
  assert.ok(await page.evaluate(() => document.querySelector('[data-overlay-id=staged]')
    .getAnimations({ subtree: true }).length > 0), 'same-frame re-entry must recreate the animation');
});

test('paused re-entry treats the first pose as provisional until the settled refresh', async t => {
  const browser = await launchBrowser(); t.after(() => browser.close());
  const page = await fixture(browser);
  await tick(page, 5, false);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
  await page.evaluate(() => {
    // Model a pending pause/currentTime correction: the entry tick reads the old
    // opacity, then the computed pose becomes available before the 120ms refresh.
    const original = window.getComputedStyle;
    window.oldPose = true;
    window.getComputedStyle = function (element, ...args) {
      const style = original.call(this, element, ...args);
      if (!window.oldPose || !element?.classList?.contains('late')) return style;
      return new Proxy(style, { get(target, key) {
        if (key === 'opacity') return '0';
        const value = Reflect.get(target, key, target);
        return typeof value === 'function' ? value.bind(target) : value;
      } });
    };
  });
  await tick(page, 2.5, false);
  assert.ok(await page.evaluate(() => document.querySelector('[data-overlay-id=staged]')
    .getAnimations({ subtree: true }).length > 0), 're-entry must create the gated animation');
  assert.equal((await state(page)).late, 'none', 'entry measured the pre-correction pose');
  await page.evaluate(async () => {
    const animations = document.querySelector('[data-overlay-id=staged]').getAnimations({ subtree: true });
    await Promise.all(animations.map(animation => animation.ready));
    window.oldPose = false;
  });
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.late')).pointerEvents === 'auto',
    { timeout: 700 });
  assert.equal((await state(page)).late, 'auto', 'settled refresh must survive the provisional apply');
});

test('stationary retargeted press drags and commits like a native hit', async t => {
  const browser = await launchBrowser(); t.after(() => browser.close());
  const drag = async stale => {
    const page = await fixture(browser);
    await installHostCapture(page);
    await page.mouse.move(150, 125);
    if (stale) await tick(page, 2.5, true);
    else { await tick(page, 2.5, false); await wait(180); }
    const before = await page.evaluate(() => document.querySelector('.late').getBoundingClientRect().left);
    await page.mouse.down();
    await page.mouse.move(190, 125, { steps: 5 });
    await page.mouse.up();
    await wait(120);
    return page.evaluate(beforeLeft => ({
      delta: document.querySelector('.late').getBoundingClientRect().left - beforeLeft,
      selected: window.akari.interaction.selectedId,
      focus: window.akari.interaction.elementFocus?.ref ?? null,
      active: window.akari.interaction.activePointerOperation,
      writes: window.writes,
      host: window.hostCapture,
    }), before);
  };
  const native = await drag(false);
  const corrected = await drag(true);
  for (const result of [native, corrected]) {
    assert.ok(Math.abs(result.delta - 40) < 2, JSON.stringify(result));
    assert.equal(result.selected, 'staged');
    assert.match(result.focus, /late/);
    assert.equal(result.active, false);
    assert.equal(result.writes.length, 1, JSON.stringify(result));
    assert.equal(result.writes[0].id, 'staged');
    assert.equal(result.host.downs.length, 1);
    assert.deepEqual(result.host.downs[0], { target: 'late', trusted: true });
    assert.equal(result.host.stopped, 1);
    assert.equal(result.host.playing, false);
  }
  assert.ok(Math.abs(native.delta - corrected.delta) < 1);
});

test('first stationary pointerdown retargets a stale hit with and without element capability', async t => {
  const browser = await launchBrowser(); t.after(() => browser.close());
  for (const enabled of [true, false]) {
    const page = await fixture(browser, enabled);
    await installHostCapture(page);
    await page.mouse.move(150, 125);
    await tick(page, 2.5, true);
    assert.equal((await state(page)).late, 'none');
    await page.mouse.down(); await page.mouse.up();
    const hit = await state(page);
    assert.equal(hit.selected, 'staged', JSON.stringify({ enabled, hit }));
    assert.equal(hit.underlayDown, 0);
    assert.equal(enabled ? /late/.test(hit.focus) : hit.focus === null, true);
    let host = await page.evaluate(() => window.hostCapture);
    assert.deepEqual(host.downs, [{ target: 'late', trusted: true }]);
    assert.deepEqual(host.clicks, [{ target: 'late', trusted: true }]);
    assert.equal(host.stopped, 1);
    assert.equal(host.playing, false);
    await tick(page, 4.4, true);
    // The old auto hit must pass through on the very first stationary press.
    await page.evaluate(() => { window.hostCapture.playing = true; });
    await page.mouse.down(); await page.mouse.up();
    assert.equal((await state(page)).underlayDown > 0, true);
    assert.equal((await state(page)).selected, null);
    host = await page.evaluate(() => window.hostCapture);
    assert.deepEqual(host.downs, [
      { target: 'late', trusted: true }, { target: 'underlay', trusted: true },
    ]);
    assert.deepEqual(host.clicks, [
      { target: 'late', trusted: true }, { target: 'underlay', trusted: true },
    ]);
    assert.equal(host.stopped, 2);
  }

  const moved = await fixture(browser);
  await tick(moved, 2.5, true);
  await moved.mouse.move(150, 125);
  await moved.mouse.click(150, 125);
  assert.equal((await state(moved)).selected, 'staged', 'pointermove must refresh before the first press');
});

test('a later host window capture listener receives modifier hits on the corrected overlay', async t => {
  const browser = await launchBrowser(); t.after(() => browser.close());
  const page = await fixture(browser);
  await installHostCapture(page);
  await page.mouse.move(150, 125);
  await tick(page, 2.5, true);
  await page.keyboard.down('Shift');
  await page.mouse.down(); await page.mouse.up();
  await page.keyboard.up('Shift');
  const host = await page.evaluate(() => window.hostCapture);
  assert.equal(host.downs.length, 1);
  assert.deepEqual(host.downs[0], { target: 'late', trusted: true });
  assert.equal(host.mixedHits, 1);
});

test('idle play stays cheap; pointer moves are capped; edit and drag defer; directives and SVG survive', async t => {
  const browser = await launchBrowser(); t.after(() => browser.close());
  const page = await fixture(browser);
  await page.evaluate(() => { window.rootReads.length = 0; });
  for (let frame = 1; frame <= 134; frame++) await tick(page, frame / 30, true);
  assert.ok((await state(page)).reads <= 2, 'no pointer: initial plus settled at most');
  await page.evaluate(() => { window.rootReads.length = 0; });
  for (let frame = 1; frame <= 75; frame++) {
    await tick(page, 2.5 + frame / 200, true);
    await page.mouse.move(150 + frame % 3, 125);
    await wait(16);
  }
  const reads = await page.evaluate(() => window.rootReads);
  for (const from of reads) {
    assert.ok(reads.filter(time => time >= from && time < from + 1000).length <= 10,
      `more than 10 root reads in one second: ${JSON.stringify(reads.slice(0, 20))}`);
  }
  await tick(page, 2.5, false); await wait(180);
  await page.mouse.click(150, 125);
  // An active pointer gesture blocks a stale measurement; release allows the next chance.
  await page.mouse.move(150, 125); await page.mouse.down();
  const beforeDrag = (await state(page)).reads;
  await tick(page, 3.0, true);
  await page.mouse.move(152, 125);
  assert.equal((await state(page)).reads, beforeDrag);
  await page.mouse.up();
  await tick(page, 3.1, false); await wait(180);
  assert.ok((await state(page)).reads > beforeDrag);
  await page.evaluate(() => { window.akari.state.summary.tree = [{ id: 'staged', kind: 'leaf', parentId: null }]; });
  await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(() => window.akari.interaction.activeEdit), true, JSON.stringify(await state(page)));
  const beforeEdit = (await state(page)).reads;
  await tick(page, 3.2, true);
  await page.mouse.move(151, 125);
  assert.equal((await state(page)).reads, beforeEdit);
  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(() => window.akari.interaction.setPointerOwner('external')), true);
  const beforeOwner = (await state(page)).reads;
  await tick(page, 3.3, true);
  await page.mouse.move(152, 125);
  assert.equal((await state(page)).reads, beforeOwner);
  await page.evaluate(() => window.akari.interaction.releasePointerOwner('external'));
  await page.mouse.down(); await page.mouse.up();
  assert.ok((await state(page)).reads > beforeOwner);
  const rules = await page.evaluate(() => ({
    catch: getComputedStyle(document.querySelector('.catch')).pointerEvents,
    pass: getComputedStyle(document.querySelector('.pass')).pointerEvents,
    svg: getComputedStyle(document.querySelector('.icon')).pointerEvents,
    rect: getComputedStyle(document.querySelector('rect')).pointerEvents,
  }));
  assert.deepEqual(rules, { catch: 'auto', pass: 'none', svg: 'none', rect: 'visiblepainted' });
});

test('shape-line proxy remains hittable while pointer moves trigger refreshes', async t => {
  const browser = await launchBrowser(); t.after(() => browser.close());
  const page = await browser.newPage();
  await page.setViewport({ width: 640, height: 360 });
  await page.setContent(`<style>body{margin:0}#overlay-stage{position:relative;width:640px;height:360px;pointer-events:none}${interactionCss}</style><div id="overlay-stage"></div>`);
  await page.evaluate(() => {
    window.akari = { state: { editPath: 'fixture', summary: {
      output: { width: 640, height: 360 }, overlays: [{
        id: 'line', role: 'shape-line', start: 0, duration: 10,
        html: '<svg width="100" height="40"><line x1="0" y1="20" x2="100" y2="20" stroke="white" stroke-width="2"/></svg>',
        transform: { x: 200, y: 160, scale: 1, rotate: 0 },
      }] } }, stageScale: () => 1 };
  });
  await page.addScriptTag({ content: readFileSync(new URL('../src/handle-geometry.js', import.meta.url), 'utf8') });
  await page.addScriptTag({ content: runtime });
  await page.addScriptTag({ content: interaction });
  await page.evaluate(async () => { await window.akari.runtime.mount(window.akari.state.summary); window.akari.runtime.tick(1, true); });
  for (let frame = 1; frame <= 20; frame++) {
    await tick(page, 1 + frame / 30, true);
    await page.mouse.move(250 + frame % 2, 185);
    assert.deepEqual(await page.evaluate(() => ({
      hit: document.elementFromPoint(250, 185)?.getAttribute('data-akari-hit-proxy'),
      count: document.querySelectorAll('[data-overlay-id="line"] [data-akari-hit-proxy="1"]').length,
    })), { hit: '1', count: 1 });
    await wait(16);
  }
  await page.mouse.click(250, 185);
  assert.equal(await page.evaluate(() => window.akari.interaction.selectedId), 'line');
});
