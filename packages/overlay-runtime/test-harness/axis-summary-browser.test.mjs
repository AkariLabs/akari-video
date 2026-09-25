import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { launchBrowser } from './fixtures/browser.mjs';

test('incremental axis summaries update CSS and keyframe caches without remounting or touching legacy records', { timeout: 60000 }, async () => {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.setContent('<style>body{margin:0}#overlay-stage{position:relative;width:640px;height:360px}</style><div id="overlay-stage"></div>');
    await page.addScriptTag({ type: 'module', content: await readFile(new URL('../src/keyframes.mjs', import.meta.url), 'utf8') });
    await page.addScriptTag({ content: await readFile(new URL('../src/item-motion.js', import.meta.url), 'utf8') });
    await page.addScriptTag({ content: await readFile(new URL('../src/overlay-runtime.js', import.meta.url), 'utf8') });
    const observed = await page.evaluate(async () => {
      const html = '<div class="rect" style="width:100px;height:60px;background:green"></div>';
      const leaf = { id: 'leaf', start: 0, duration: 2, html, transform: { scale: 1 } };
      const legacy = { id: 'legacy', start: 0, duration: 2, html, transform: { scale: 2 } };
      const summary = { output: { width: 640, height: 360, fps: 30 }, overlays: [leaf, legacy] };
      await window.akari.runtime.mount(summary);
      window.akari.runtime.tick(0.5, false);
      const node = document.querySelector('[data-overlay-id="leaf"]');
      const legacyNode = document.querySelector('[data-overlay-id="legacy"]');
      const originalLegacyStyle = legacyNode.style.cssText;
      const apply = value => {
        window.akari.runtime.applyAxisSummary({ ...summary, overlays: [{ ...leaf, ...value }, { ...legacy, transform: { scale: 3 } }] });
        window.akari.runtime.tick(value.start === 1 ? 1.5 : 0.5, false);
        const box = node.querySelector('.rect').getBoundingClientRect();
        return { width: box.width, height: box.height, sameNode: node === document.querySelector('[data-overlay-id="leaf"]') };
      };
      const staticAxes = apply({ transform: { scaleX: 2, scaleY: 0.5 } });
      const keyframes = apply({ start: 1, transform: { scaleY: 0.75 }, keyframes: [
        { t: 0, transform: { scaleX: 3 } }, { t: 30, transform: { scaleX: 5 } },
      ] });
      const removed = apply({ transform: { scale: 1.25 } });
      return { staticAxes, keyframes, removed, legacyUntouched: legacyNode.style.cssText === originalLegacyStyle,
        axisRemoved: node.style.getPropertyValue('--scale-x') === '' && node.style.getPropertyValue('--scale-y') === '' };
    });
    assert.deepEqual(observed.staticAxes, { width: 200, height: 30, sameNode: true });
    assert.deepEqual(observed.keyframes, { width: 400, height: 45, sameNode: true });
    assert.deepEqual(observed.removed, { width: 125, height: 75, sameNode: true });
    assert.equal(observed.legacyUntouched, true);
    assert.equal(observed.axisRemoved, true);
  } finally { await browser.close(); }
});
