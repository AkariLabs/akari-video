import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { launchBrowser } from './fixtures/browser.mjs';

const source = name => readFileSync(new URL('../src/' + name, import.meta.url), 'utf8');

test('equal-distance screen center guide wins over an item edge guide', async () => {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 640, height: 360 });
    await page.setContent(`<style>body{margin:0}#overlay-stage{position:relative;width:640px;height:360px;pointer-events:none}${source('interaction.css')}</style><div id="overlay-stage"></div>`);
    await page.evaluate(() => {
      window.akari = { state: { editPath: 'fixture', summary: { output: { width: 640, height: 360 },
        overlays: [
          { id: 'moving', role: 'shape', start: 0, duration: 10,
            html: '<svg width="100" height="60"><rect width="100" height="60" fill="red"/></svg>',
            transform: { x: 270, y: 100 } },
          { id: 'other', role: 'shape', start: 0, duration: 10,
            html: '<svg width="80" height="40"><rect width="80" height="40" fill="blue"/></svg>',
            transform: { x: 290, y: 200 } }
        ] } }, stageScale: () => 1, engine: { overlayWrite: async () => {} } };
    });
    for (const name of ['handle-geometry.js', 'overlay-runtime.js', 'interaction.js']) {
      await page.addScriptTag({ content: source(name) });
    }
    await page.evaluate(async () => {
      await window.akari.runtime.mount(window.akari.state.summary);
      window.akari.runtime.tick(1, true);
    });
    await page.mouse.click(275, 110);
    assert.equal(await page.evaluate(() => window.akari.interaction.selectedId), 'moving');
    const result = await page.evaluate(() => {
      const api = window.akari.interaction;
      const snap = api.computeSnapCorrection({ left: 270, centerX: 320, right: 370,
        top: 100, centerY: 130, bottom: 160 }, { x: null, y: null });
      api.showSnapGuides(snap.x, null);
      const guide = document.querySelector('.akari-interaction-snap-guide.is-vertical');
      return { kind: snap.x?.kind, target: snap.x?.target, itemGuide: guide.classList.contains('is-item'),
        height: Number.parseFloat(guide.style.height) };
    });
    assert.deepEqual(result, { kind: 'canvas', target: 320, itemGuide: false, height: 360 });
    await page.close();
  } finally { await browser.close(); }
});

test('fast drags skip new magnets per axis, and the speed state stays inside one drag', async () => {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 640, height: 360 });
    await page.setContent(`<style>body{margin:0}#overlay-stage{position:relative;width:640px;height:360px;pointer-events:none}${source('interaction.css')}</style><div id="overlay-stage"></div>`);
    await page.evaluate(() => {
      window.akari = { state: { editPath: 'fixture', summary: { output: { width: 640, height: 360 }, overlays: [] } },
        stageScale: () => 1, engine: { overlayWrite: async () => {} } };
    });
    for (const name of ['handle-geometry.js', 'overlay-runtime.js', 'interaction.js']) {
      await page.addScriptTag({ content: source(name) });
    }
    const result = await page.evaluate(async () => {
      await window.akari.runtime.mount(window.akari.state.summary);
      let now = 1000;
      performance.now = () => now;
      const api = window.akari.interaction;
      const box = (left, top) => ({ left, right: left + 60, top, bottom: top + 40,
        centerX: left + 30, centerY: top + 20 });
      // 横へ 2 表示px/ms で動かしながら画面中央（x=320）付近を通過する。縦は止まっていて中央（y=180）付近。
      let snap = api.computeSnapCorrection(box(200, 162), { x: null, y: null });
      const steps = [];
      for (const left of [220, 240, 260, 280, 288]) {
        now += 10;
        snap = api.computeSnapCorrection(box(left, 162), snap);
        steps.push({ x: snap.x?.target ?? null, y: snap.y?.target ?? null });
      }
      // 別のドラッグ（previousSnap を新しく始める）は、前のドラッグの速さを引き継がない。
      now += 5;
      const fresh = api.computeSnapCorrection(box(288, 162), { x: null, y: null });
      return { steps, fresh: { x: fresh.x?.target ?? null, y: fresh.y?.target ?? null } };
    });
    // 左端 288 → 中央 318（目標 320 まで 2px）でも、素早い横移動中は x に吸着しない。縦（y 中央 180）は吸着する。
    assert.deepEqual(result.steps.at(-1), { x: null, y: 180 });
    assert.ok(result.steps.every(step => step.y === 180));
    // 新しいドラッグの最初の判定は止まっている扱いなので、中央へ吸着する。
    assert.deepEqual(result.fresh, { x: 320, y: 180 });
    await page.close();
  } finally { await browser.close(); }
});
