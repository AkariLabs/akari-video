#!/usr/bin/env node
// Supplemental production-runtime measurement in Chrome; not an Electron export claim.
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { launchBrowser } from '../../../../../../packages/overlay-runtime/test-harness/fixtures/browser.mjs';
import { readRenderEdit } from '../../../../../../packages/render-cut/src/internal-render.mjs';
import { renderOverlaySheet } from '../../../../../../packages/render-cut/src/rasterize.mjs';
import { fileURLToPath } from 'node:url';
const out = new URL('./results/runtime-dom/', import.meta.url);
await mkdir(out, { recursive: true });
const result = { description: 'Classic shell runtime versus export overlay sheet in Chrome (supplemental)', measurements: [], cornerChecks: [], pixelChecks: [] };
let browser;
try {
  browser = await launchBrowser();
  for (const name of ['scale-x', 'scale-y', 'rotated', 'group-leaf', 'uniform-rotated', 'keyframes', 'legacy']) {
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
        if (['rotated', 'group-leaf', 'uniform-rotated'].includes(name)) {
          const corners = await page.evaluate(() => ['nw', 'ne', 'se', 'sw'].map(name => {
            const r = document.querySelector(`[data-corner="${name}"]`).getBoundingClientRect();
            return { x: r.x, y: r.y };
          }));
          const edge = (a, b) => ({ x: b.x - a.x, y: b.y - a.y });
          const dot = (a, b) => a.x * b.x + a.y * b.y;
          const cross = (a, b) => a.x * b.y - a.y * b.x;
          const top = edge(corners[0], corners[1]), right = edge(corners[1], corners[2]);
          const bottom = edge(corners[3], corners[2]), left = edge(corners[0], corners[3]);
          const angleErrorDeg = Math.abs(Math.atan2(dot(top, right), cross(top, right)) * 180 / Math.PI);
          result.cornerChecks.push({ fixture: name, frame, surface, corners, angleErrorDeg,
            pass: angleErrorDeg <= .5 && Math.abs(cross(top, bottom)) < .1 && Math.abs(cross(left, right)) < .1 });
        }
        const screenshot = await page.screenshot({ path: fileURLToPath(new URL(`${name}-${surface}-${frame}.png`, out)) });
        if (name === 'legacy') {
          const previous = await readFile(new URL(`../transform-anisotropic-scale-v1/results/runtime-dom/${name}-${surface}-${frame}.png`, import.meta.url));
          result.pixelChecks.push({ fixture: name, frame, surface, mode: 'P3b-1 baseline', pass: Buffer.from(screenshot).equals(previous) });
        }
        if (name === 'uniform-rotated') {
          const original = await page.evaluate(() => {
            const container = document.querySelector('[data-overlay-id="leaf"]');
            const original = container.style.transform;
            container.style.transform = 'translate(var(--x,0px), var(--y,0px)) scale(var(--scale-x,var(--scale,1)),var(--scale-y,var(--scale,1))) rotate(var(--rotate,0deg))';
            return original;
          });
          const oldOrder = await page.screenshot();
          await page.evaluate(value => { document.querySelector('[data-overlay-id="leaf"]').style.transform = value; }, original);
          result.pixelChecks.push({ fixture: name, frame, surface, mode: 'old CSS order', pass: Buffer.from(screenshot).equals(Buffer.from(oldOrder)) });
        }
      }
      const angle = ['rotated', 'group-leaf', 'uniform-rotated'].includes(name) ? Math.PI / 6 : 0;
      const axes = name === 'scale-x' ? [2, 1] : name === 'scale-y' ? [1, .5] : name === 'rotated' ? [1.5, .75]
        : name === 'group-leaf' ? [2.5, 1.25] : name === 'uniform-rotated' ? [1.25, 1.25] : name === 'keyframes' ? [1 + frame / 60, 1] : [1.25, 1.25];
      measurement.expected = { width: 100 * axes[0] * Math.cos(angle) + 60 * axes[1] * Math.sin(angle), height: 100 * axes[0] * Math.sin(angle) + 60 * axes[1] * Math.cos(angle) };
      measurement.pass = Object.keys(measurement.classic).every(key => Math.abs(measurement.classic[key] - measurement['export-sheet'][key]) <= 1)
        && ['width', 'height'].every(key => Math.abs(measurement.classic[key] - measurement.expected[key]) <= 1);
      result.measurements.push(measurement);
      result.pass = result.measurements.length === 35 && result.measurements.every(value => value.pass)
        && result.cornerChecks.every(value => value.pass) && result.pixelChecks.every(value => value.pass);
      await writeFile(new URL('results.json', out), JSON.stringify(result, null, 2) + '\n');
    }
    for (const page of Object.values(pages)) await page.close();
  }
} catch (error) { result.error = String(error.stack ?? error); }
finally { await browser?.close(); }
result.pass = !result.error && result.measurements.length === 35 && result.measurements.every(value => value.pass)
  && result.cornerChecks.length === 30 && result.cornerChecks.every(value => value.pass)
  && result.pixelChecks.length === 20 && result.pixelChecks.every(value => value.pass);
await writeFile(new URL('results.json', out), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ pass: result.pass, measurements: result.measurements.length, error: result.error }));
if (!result.pass) process.exitCode = 1;
