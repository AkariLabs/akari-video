#!/usr/bin/env node
// Supplemental production-runtime measurement in Chrome; not an Electron export claim.
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { launchBrowser } from '../../../../../../packages/overlay-runtime/test-harness/fixtures/browser.mjs';
import { readRenderEdit } from '../../../../../../packages/render-cut/src/internal-render.mjs';
import { renderOverlaySheet } from '../../../../../../packages/render-cut/src/rasterize.mjs';
import { fileURLToPath } from 'node:url';
const out = new URL('./results/runtime-dom/', import.meta.url);
await mkdir(out, { recursive: true });
const result = { description: 'Classic shell runtime versus export overlay sheet in Chrome (supplemental)', measurements: [] };
let browser;
try {
  browser = await launchBrowser();
  for (const name of ['scale-x', 'scale-y', 'rotated', 'group-leaf', 'keyframes', 'legacy']) {
    const root = new URL(`./fixtures/${name}/`, import.meta.url);
    const source = await readFile(new URL('edit.json', root), 'utf8');
    const { edit } = readRenderEdit(source, fileURLToPath(out), { projectRoot: fileURLToPath(root) });
    for (const overlay of edit.overlays) {
      if (!overlay.html.trimStart().startsWith('<')) overlay.html = await readFile(new URL(overlay.html, root), 'utf8');
    }
    const pages = {};
    for (const surface of ['classic', 'export-sheet']) {
      const page = await browser.newPage(); pages[surface] = page;
      await page.setViewport({ width: 640, height: 360 });
      if (surface === 'classic') {
        await page.setContent('<style>body{margin:0;background:#000}#overlay-stage{position:relative;width:640px;height:360px}</style><div id="overlay-stage"></div>');
        await page.evaluate(edit => { window.akari = { state: { summary: edit }, stageScale: () => 1 }; }, edit);
        await page.addScriptTag({ type: 'module', content: await readFile(new URL('../../../../../../packages/overlay-runtime/src/keyframes.mjs', import.meta.url), 'utf8') });
        for (const file of ['overlay-runtime.js', 'interaction.js']) await page.addScriptTag({ content: await readFile(new URL(`../../../../../../packages/overlay-runtime/src/${file}`, import.meta.url), 'utf8') });
        await page.evaluate(async () => { await window.akari.runtime.mount(window.akari.state.summary); });
      } else {
        await page.setContent(renderOverlaySheet({ edit, overlays: edit.overlays, duration: 2, projectRoot: fileURLToPath(root) }));
        await page.waitForFunction(() => typeof window.__akariSeek === 'function');
      }
    }
    for (const frame of [0, 15, 30, 45, 59]) {
      const measurement = { fixture: name, frame };
      for (const [surface, page] of Object.entries(pages)) {
        await page.evaluate(async ({ surface, frame }) => {
          if (surface === 'classic') window.akari.runtime.tick(frame / 30, true);
          else await window.__akariSeek(frame / 30);
        }, { surface, frame });
        measurement[surface] = await page.evaluate(surface => {
          const leaf = document.querySelector('[data-akari-part="rectangle"]');
          const container = leaf.closest('[data-overlay-id]');
          const r = surface === 'classic' ? window.akari.interaction.fragmentBounds(container) : leaf.getBoundingClientRect();
          return { width: r.width, height: r.height, left: r.left, top: r.top };
        }, surface);
        await page.screenshot({ path: fileURLToPath(new URL(`${name}-${surface}-${frame}.png`, out)) });
      }
      const angle = name === 'rotated' ? Math.PI / 6 : 0;
      const axes = name === 'scale-x' ? [2, 1] : name === 'scale-y' ? [1, .5] : name === 'rotated' ? [1.5, .75]
        : name === 'group-leaf' ? [2.5, 1.25] : name === 'keyframes' ? [1 + frame / 60, 1] : [1.25, 1.25];
      measurement.expected = { width: (100 * Math.cos(angle) + 60 * Math.sin(angle)) * axes[0], height: (100 * Math.sin(angle) + 60 * Math.cos(angle)) * axes[1] };
      measurement.pass = Object.keys(measurement.classic).every(key => Math.abs(measurement.classic[key] - measurement['export-sheet'][key]) <= 1)
        && ['width', 'height'].every(key => Math.abs(measurement.classic[key] - measurement.expected[key]) <= 1);
      result.measurements.push(measurement);
      result.pass = result.measurements.length === 30 && result.measurements.every(value => value.pass);
      await writeFile(new URL('results.json', out), JSON.stringify(result, null, 2) + '\n');
    }
    for (const page of Object.values(pages)) await page.close();
  }
} catch (error) { result.error = String(error.stack ?? error); }
finally { await browser?.close(); }
result.pass = !result.error && result.measurements.length === 30 && result.measurements.every(value => value.pass);
await writeFile(new URL('results.json', out), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ pass: result.pass, measurements: result.measurements.length, error: result.error }));
if (!result.pass) process.exitCode = 1;
