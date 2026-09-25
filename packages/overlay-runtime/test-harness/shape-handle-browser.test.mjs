import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { launchBrowser } from './fixtures/browser.mjs';

const source = name => readFileSync(new URL('../src/' + name, import.meta.url), 'utf8');

test('painted shape and line SVG descendants select their overlay and expose visible bounds', async () => {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 640, height: 360 });
    await page.setContent(`<style>body{margin:0}#overlay-stage{position:relative;width:640px;height:360px;pointer-events:none}${source('interaction.css')}
      .akari-interaction-selection-frame.is-line{border-color:transparent}
      .akari-interaction-selection-frame.is-line .is-line-start{top:50%;left:0;width:12px;height:12px;transform:translate(-50%,-50%)}
      .akari-interaction-selection-frame.is-line .is-line-end{top:50%;right:0;width:12px;height:12px;transform:translate(50%,-50%)}
      </style><div id="overlay-stage"></div>`);
    await page.evaluate(() => {
      window.writes = [];
      window.akari = { state: { editPath: 'fixture', summary: {
        output: { width: 640, height: 360 },
        overlays: [
          { id: 'rect', role: 'shape', start: 0, duration: 10, track: 0,
            html: '<svg width="120" height="80" viewBox="0 0 120 80"><rect width="120" height="80" fill="#e66"/></svg>',
            transform: { x: 50, y: 40, scale: 1, rotate: 0 } },
          { id: 'line', role: 'shape-line', start: 0, duration: 10, track: 1,
            html: '<svg width="100" height="40" viewBox="0 0 100 40"><line x1="0" y1="20" x2="100" y2="20" stroke="#fff" stroke-width="8"/></svg>',
            transform: { x: 200, y: 160, scale: 1, rotate: 0 } }
        ] } }, stageScale: () => 1, engine: {
        overlayWrite: async (_path, id, patch) => window.writes.push({ id, patch })
      } };
    });
    for (const name of ['handle-geometry.js', 'overlay-runtime.js', 'interaction.js']) {
      await page.addScriptTag({ content: source(name) });
    }
    await page.evaluate(async () => {
      await window.akari.runtime.mount(window.akari.state.summary);
      window.akari.runtime.tick(1, true);
    });
    const hit = await page.evaluate(() => ({
      tag: document.elementFromPoint(110, 80)?.tagName.toLowerCase(),
      pointer: getComputedStyle(document.querySelector('[data-overlay-id="rect"] rect')).pointerEvents
    }));
    assert.deepEqual(hit, { tag: 'rect', pointer: 'visiblepainted' });
    await page.mouse.click(110, 80);
    assert.equal(await page.evaluate(() => window.akari.interaction.selectedId), 'rect');
    const frame = await page.evaluate(() => {
      const rect = document.querySelector('.akari-interaction-selection-frame').getBoundingClientRect();
      return { width: rect.width, height: rect.height };
    });
    assert.equal(frame.width, 120);
    assert.equal(frame.height, 80);
    await page.mouse.move(110, 80); await page.mouse.down();
    await page.keyboard.down('Meta');
    await page.mouse.move(130, 90, { steps: 3 });
    await page.mouse.up(); await page.keyboard.up('Meta');
    assert.equal((await page.evaluate(() => window.writes))[0]?.id, 'rect');
    const originalX = await page.evaluate(() => document.querySelector('[data-overlay-id="rect"]').style.getPropertyValue('--x'));
    await page.keyboard.down('Alt');
    await page.mouse.move(130, 90); await page.mouse.down();
    await page.mouse.move(150, 100, { steps: 3 }); await page.mouse.up();
    await page.keyboard.up('Alt');
    await page.waitForFunction(() => window.writes.length === 2);
    const duplicate = await page.evaluate(() => ({
      patch: window.writes[1].patch,
      originalX: document.querySelector('[data-overlay-id="rect"]').style.getPropertyValue('--x')
    }));
    assert.equal(duplicate.patch.duplicate, true);
    assert.equal(duplicate.patch.transform.x, Number.parseFloat(originalX) + 20);
    assert.equal(duplicate.originalX, originalX);
    const rotationStart = await page.evaluate(() => {
      const item = document.querySelector('[data-overlay-id="rect"]');
      const box = window.akari.interaction.fragmentBounds(item);
      const handle = document.querySelector('.akari-interaction-action.is-rotate').getBoundingClientRect();
      return { center: { x: box.left + box.width / 2, y: box.top + box.height / 2 },
        handle: { x: handle.left + handle.width / 2, y: handle.top + handle.height / 2 } };
    });
    const startAngle = Math.atan2(rotationStart.handle.y - rotationStart.center.y,
      rotationStart.handle.x - rotationStart.center.x);
    const radius = Math.hypot(rotationStart.handle.x - rotationStart.center.x,
      rotationStart.handle.y - rotationStart.center.y);
    await page.mouse.move(rotationStart.handle.x, rotationStart.handle.y); await page.mouse.down();
    await page.mouse.move(rotationStart.center.x + radius * Math.cos(startAngle + 43 * Math.PI / 180),
      rotationStart.center.y + radius * Math.sin(startAngle + 43 * Math.PI / 180), { steps: 5 });
    await page.mouse.up();
    await page.waitForFunction(() => window.writes.length === 3);
    const rotationEnd = await page.evaluate(() => {
      const box = window.akari.interaction.fragmentBounds(document.querySelector('[data-overlay-id="rect"]'));
      return { center: { x: box.left + box.width / 2, y: box.top + box.height / 2 },
        transform: window.writes[2].patch.transform };
    });
    assert.ok(Math.abs(rotationEnd.transform.rotate - 45) < 0.1, JSON.stringify(rotationEnd));
    assert.ok(Math.hypot(rotationEnd.center.x - rotationStart.center.x,
      rotationEnd.center.y - rotationStart.center.y) < 1, JSON.stringify({ rotationStart, rotationEnd }));
    assert.equal(await page.evaluate(() => document.elementFromPoint(250, 180)?.tagName.toLowerCase()), 'line');
    await page.mouse.click(250, 180);
    assert.equal(await page.evaluate(() => window.akari.interaction.selectedId), 'line');
    assert.equal(await page.evaluate(() => document.querySelector('.akari-interaction-selection-frame')?.classList.contains('is-line')), true);
    const endpoints = await page.evaluate(() => {
      const center = selector => {
        const rect = document.querySelector(selector).getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      };
      return { start: center('.is-line-start'), end: center('.is-line-end') };
    });
    const length = Math.hypot(endpoints.end.x - endpoints.start.x,
      endpoints.end.y - endpoints.start.y);
    await page.mouse.move(endpoints.end.x, endpoints.end.y); await page.mouse.down();
    await page.mouse.move(endpoints.start.x + length * Math.cos(42 * Math.PI / 180),
      endpoints.start.y + length * Math.sin(42 * Math.PI / 180), { steps: 4 });
    assert.equal(await page.evaluate(() => [...document.querySelectorAll('.akari-interaction-snap-guide')]
      .filter(guide => !guide.hidden).length), 0);
    await page.mouse.up();
    await page.waitForFunction(() => window.writes.length === 4);
    assert.ok(Math.abs((await page.evaluate(() => window.writes[3].patch.transform.rotate)) - 45) < .1);
    await page.close();
  } finally { await browser.close(); }
});
