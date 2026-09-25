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
