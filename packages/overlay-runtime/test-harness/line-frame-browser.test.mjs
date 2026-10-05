import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { launchBrowser } from './fixtures/browser.mjs';

const source = name => readFileSync(new URL('../src/' + name, import.meta.url), 'utf8');

test('line selection and hover frames follow the painted line at 0, 30 and 45 degrees', async () => {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 700, height: 420 });
    await page.setContent(`<style>body{margin:0}#overlay-stage{position:relative;width:700px;height:420px;pointer-events:none}${source('interaction.css')}</style><div id="overlay-stage"></div>`);
    await page.evaluate(() => {
      const overlays = [0, 30, 45].map((rotate, index) => ({
        id: `line-${rotate}`, role: 'shape-line', start: 0, duration: 10, track: index,
        html: '<svg width="160" height="40" viewBox="0 0 160 40"><line x1="0" y1="20" x2="160" y2="20" stroke="white" stroke-width="4"/></svg>',
        transform: { x: 240, y: 70 + index * 125, scale: 1, rotate },
      }));
      window.akari = { state: { editPath: 'fixture', summary: {
        output: { width: 700, height: 420 }, overlays } }, stageScale: () => 1 };
    });
    for (const name of ['handle-geometry.js', 'overlay-runtime.js', 'interaction.js']) {
      await page.addScriptTag({ content: source(name) });
    }
    await page.evaluate(async () => {
      await window.akari.runtime.mount(window.akari.state.summary);
      window.akari.runtime.tick(1, true);
    });
    for (const angle of [0, 30, 45]) {
      const id = `line-${angle}`;
      const geometry = await page.evaluate(id => {
        const line = document.querySelector(`[data-overlay-id="${id}"]`);
        return window.akari.interaction.lineFrameGeometry(line);
      }, id);
      const center = { x: (geometry.start.x + geometry.end.x) / 2,
        y: (geometry.start.y + geometry.end.y) / 2 };
      await page.mouse.move(center.x, center.y);
      await page.waitForFunction(id => !document.querySelector('[data-akari-ui="preview-hover-frame"]')?.hidden
        && document.querySelector('[data-akari-ui="preview-hover-frame"]')?.dataset.overlayId === id, {}, id);
      const hover = await page.evaluate(() => {
        const frame = document.querySelector('[data-akari-ui="preview-hover-frame"]');
        return { width: Number.parseFloat(frame.style.width), height: Number.parseFloat(frame.style.height),
          transform: frame.style.transform };
      });
      assert.ok(hover.height < 20 && hover.width > 160 && hover.width < 175, JSON.stringify(hover));
      assert.equal(hover.transform, angle ? `rotate(${angle}deg)` : 'rotate(0deg)');

      await page.mouse.click(center.x, center.y);
      const selected = await page.evaluate(() => {
        const frame = document.querySelector('[data-akari-interaction="selection-frame"]');
        const center = selector => {
          const rect = frame.querySelector(selector).getBoundingClientRect();
          return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
        };
        return { width: Number.parseFloat(frame.style.width), height: Number.parseFloat(frame.style.height),
          transform: frame.style.transform, start: center('.is-line-start'), end: center('.is-line-end'),
          visibleResize: [...frame.querySelectorAll('.akari-interaction-handle')].filter(node =>
            !node.classList.contains('akari-interaction-action')
            && !node.classList.contains('is-line-start') && !node.classList.contains('is-line-end')
            && getComputedStyle(node).display !== 'none').length,
          actions: frame.querySelectorAll('.akari-interaction-action').length,
          border: getComputedStyle(frame).borderTopColor };
      });
      assert.ok(Math.abs(selected.width - geometry.width) < 0.05,
        `width: ${selected.width} != ${geometry.width}`);
      assert.ok(Math.abs(selected.height - geometry.height) < 0.05,
        `height: ${selected.height} != ${geometry.height}`);
      assert.equal(selected.transform, `rotate(${angle}deg)`);
      assert.equal(selected.visibleResize, 0);
      assert.equal(selected.actions, 2);
      assert.notEqual(selected.border, 'transparent');
      for (const endpoint of ['start', 'end']) {
        assert.ok(Math.hypot(selected[endpoint].x - geometry[endpoint].x,
          selected[endpoint].y - geometry[endpoint].y) < 1, endpoint);
      }
      await page.mouse.click(680, 400);
    }
  } finally {
    await browser.close();
  }
});
