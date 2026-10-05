import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { launchBrowser } from './fixtures/browser.mjs';

const source = name => readFileSync(new URL('../src/' + name, import.meta.url), 'utf8');

test('shape-line hit proxy covers six screen pixels without entering saved HTML', async () => {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 640, height: 360 });
    await page.setContent(`<style>body{margin:0}#overlay-stage{position:relative;width:640px;height:360px;pointer-events:none}${source('interaction.css')}</style><div id="overlay-stage"></div>`);
    await page.evaluate(() => {
      window.akari = { state: { editPath: 'fixture', summary: {
        output: { width: 640, height: 360 }, overlays: [
          { id: 'under', role: 'shape', start: 0, duration: 10, track: 0,
            html: '<svg width="440" height="230"><rect width="440" height="230" fill="red"/></svg>',
            transform: { x: 100, y: 100, scale: 1, rotate: 0 } },
          { id: 'thin', role: 'shape-line', start: 0, duration: 10, track: 1,
            html: '<svg width="100" height="40"><line x1="0" y1="20" x2="100" y2="20" stroke="white" stroke-width="2" stroke-dasharray="3 4"/><path d="M95 15 L100 20 L95 25" fill="none" stroke="white" stroke-width="2"/></svg>',
            transform: { x: 200, y: 160, scale: 1, rotate: 0 } },
          { id: 'thick', role: 'shape-line', start: 0, duration: 10, track: 2,
            html: '<svg width="100" height="40"><line x1="0" y1="20" x2="100" y2="20" stroke="white" stroke-width="20"/></svg>',
            transform: { x: 200, y: 260, scale: 1, rotate: 0 } },
        ] } }, stageScale: () => 1 };
    });
    for (const name of ['handle-geometry.js', 'overlay-runtime.js']) {
      await page.addScriptTag({ content: source(name) });
    }
    // Keep the production serializer private; expose it only in this page's test script.
    const interaction = source('interaction.js').replace(
      '    applyOverlayHitPolicy,', '    serializeFragment,\n    applyOverlayHitPolicy,');
    assert.notEqual(interaction, source('interaction.js'));
    await page.addScriptTag({ content: interaction });
    await page.evaluate(async () => {
      await window.akari.runtime.mount(window.akari.state.summary);
      window.akari.runtime.tick(1, true);
    });

    const initial = await page.evaluate(() => {
      const thin = document.querySelector('[data-overlay-id="thin"]');
      const proxy = thin.querySelector('[data-akari-hit-proxy="1"]');
      return {
        five: document.elementFromPoint(250, 185)?.getAttribute('data-akari-hit-proxy'),
        nine: document.elementFromPoint(250, 189)?.closest('[data-overlay-id]')?.dataset.overlayId,
        proxyCount: thin.querySelectorAll('[data-akari-hit-proxy="1"]').length,
        proxyWidth: proxy?.getAttribute('stroke-width'),
        proxyDash: proxy?.getAttribute('stroke-dasharray'),
        originalPointer: getComputedStyle(thin.querySelector('line:not([data-akari-hit-proxy])')).pointerEvents,
        html: window.akari.interaction.serializeFragment(thin),
        thickNine: document.elementFromPoint(250, 289)?.closest('[data-overlay-id]')?.dataset.overlayId,
      };
    });
    assert.equal(initial.five, '1'); // Fails before the hit proxy exists.
    assert.equal(initial.nine, 'under');
    assert.equal(initial.proxyCount, 2); // Body and arrowhead path.
    assert.equal(initial.proxyWidth, '13');
    assert.equal(initial.proxyDash, null);
    assert.equal(initial.originalPointer.toLowerCase(), 'visiblepainted');
    assert.doesNotMatch(initial.html, /data-akari-hit-proxy/);
    assert.equal(initial.thickNine, 'thick');

    const lineHitPoints = () => page.evaluate(() => {
      const line = document.querySelector('[data-overlay-id="thin"] line:not([data-akari-hit-proxy])');
      const matrix = line.getScreenCTM();
      const x1 = Number(line.getAttribute('x1')), y1 = Number(line.getAttribute('y1'));
      const x2 = Number(line.getAttribute('x2')), y2 = Number(line.getAttribute('y2'));
      const centerX = matrix.a * (x1 + x2) / 2 + matrix.c * (y1 + y2) / 2 + matrix.e;
      const centerY = matrix.b * (x1 + x2) / 2 + matrix.d * (y1 + y2) / 2 + matrix.f;
      const tangentX = matrix.a * (x2 - x1) + matrix.c * (y2 - y1);
      const tangentY = matrix.b * (x2 - x1) + matrix.d * (y2 - y1);
      const length = Math.hypot(tangentX, tangentY);
      const normalX = -tangentY / length, normalY = tangentX / length;
      const at = distance => ({ x: centerX + normalX * distance,
        y: centerY + normalY * distance });
      return { center: { x: centerX, y: centerY }, five: at(5), nine: at(9) };
    });

    for (const scale of [0.327, 0.654]) {
      await page.evaluate(value => {
        document.querySelector('[data-overlay-id="thin"]')
          .style.setProperty('--scale', String(value));
      }, scale);
      const points = await lineHitPoints();
      await page.mouse.move(points.center.x, points.center.y);
      await page.mouse.move(points.five.x, points.five.y);
      const scaled = await page.evaluate(({ five, nine }) => {
        const thin = document.querySelector('[data-overlay-id="thin"]');
        const proxy = thin.querySelector('line[data-akari-hit-proxy="1"]');
        const arrowProxy = thin.querySelector('path[data-akari-hit-proxy="1"]');
        return {
          five: document.elementFromPoint(five.x, five.y)?.closest('[data-overlay-id]')?.dataset.overlayId,
          nine: document.elementFromPoint(nine.x, nine.y)?.closest('[data-overlay-id]')?.dataset.overlayId,
          width: Number(proxy.getAttribute('stroke-width')),
          inlineWidth: Number(proxy.style.getPropertyValue('stroke-width')),
          arrowWidth: Number(arrowProxy.getAttribute('stroke-width')),
          widthPriority: proxy.style.getPropertyPriority('stroke-width'),
          vectorEffect: proxy.getAttribute('vector-effect'),
        };
      }, points);
      assert.equal(scaled.five, 'thin');
      assert.notEqual(scaled.nine, 'thin');
      assert.ok(Math.abs(scaled.width * scale - 13) < 0.1, JSON.stringify(scaled));
      assert.ok(Math.abs(scaled.arrowWidth * scale - 13) < 0.1, JSON.stringify(scaled));
      assert.ok(Math.abs(scaled.inlineWidth - scaled.width) < 0.001, JSON.stringify(scaled));
      assert.equal(scaled.widthPriority, 'important');
      assert.equal(scaled.vectorEffect, null);
      await page.mouse.click(620, 20);
      await page.mouse.click(points.nine.x, points.nine.y);
      assert.notEqual(await page.evaluate(() => window.akari.interaction.selectedId), 'thin');
      await page.mouse.click(620, 20);
      await page.mouse.click(points.five.x, points.five.y);
      assert.equal(await page.evaluate(() => window.akari.interaction.selectedId), 'thin');
    }
    await page.evaluate(() => document.querySelector('[data-overlay-id="thin"]')
      .style.setProperty('--scale', '1'));
    const restoredPoints = await lineHitPoints();
    await page.mouse.move(restoredPoints.five.x, restoredPoints.five.y);

    await page.evaluate(() => {
      const thin = document.querySelector('[data-overlay-id="thin"]');
      thin.style.setProperty('--scale-x', '1.2');
      thin.style.setProperty('--scale-y', '0.327');
      document.dispatchEvent(new PointerEvent('pointermove', { bubbles: true }));
    });
    const anisotropicPoints = await lineHitPoints();
    for (const point of [anisotropicPoints.five, anisotropicPoints.nine]) {
      assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y)
        && point.x >= 0 && point.x <= 640 && point.y >= 0 && point.y <= 360,
      JSON.stringify(anisotropicPoints));
    }
    const anisotropic = await page.evaluate(({ five, nine }) => {
      const thin = document.querySelector('[data-overlay-id="thin"]');
      const proxy = thin.querySelector('line[data-akari-hit-proxy="1"]');
      return {
        width: Number(proxy.getAttribute('stroke-width')),
        five: document.elementFromPoint(five.x, five.y)?.closest('[data-overlay-id]')?.dataset.overlayId,
        nine: document.elementFromPoint(nine.x, nine.y)?.closest('[data-overlay-id]')?.dataset.overlayId,
      };
    }, anisotropicPoints);
    await page.evaluate(() => {
      const thin = document.querySelector('[data-overlay-id="thin"]');
      thin.style.removeProperty('--scale-x');
      thin.style.removeProperty('--scale-y');
      document.dispatchEvent(new PointerEvent('pointermove', { bubbles: true }));
    });
    assert.ok(Math.abs(anisotropic.width * 0.327 - 13) < 0.1, JSON.stringify(anisotropic));
    assert.equal(anisotropic.five, 'thin');
    assert.notEqual(anisotropic.nine, 'thin');

    const resized = await page.evaluate(() => {
      const thin = document.querySelector('[data-overlay-id="thin"]');
      thin.style.setProperty('--scale', '0.5');
      window.dispatchEvent(new Event('resize'));
      const proxy = thin.querySelector('line[data-akari-hit-proxy="1"]');
      const width = Number(proxy.getAttribute('stroke-width'));
      thin.style.setProperty('--scale', '1');
      window.dispatchEvent(new Event('resize'));
      return width;
    });
    assert.ok(Math.abs(resized * 0.5 - 13) < 0.1);

    await page.mouse.click(620, 20);
    const finalPoints = await lineHitPoints();
    await page.mouse.click(finalPoints.nine.x, finalPoints.nine.y);
    assert.notEqual(await page.evaluate(() => window.akari.interaction.selectedId), 'thin');
    await page.mouse.click(620, 20);
    await page.mouse.click(finalPoints.five.x, finalPoints.five.y);
    assert.equal(await page.evaluate(() => window.akari.interaction.selectedId), 'thin');
    await page.evaluate(() => {
      const thin = document.querySelector('[data-overlay-id="thin"]');
      window.akari.interaction.invalidateOverlayHitPolicy(thin);
      window.akari.interaction.applyOverlayHitPolicy(thin);
    });
    assert.equal(await page.evaluate(() => document.querySelectorAll(
      '[data-overlay-id="thin"] [data-akari-hit-proxy="1"]').length), 2);
    await page.close();
  } finally {
    await browser.close();
  }
});
