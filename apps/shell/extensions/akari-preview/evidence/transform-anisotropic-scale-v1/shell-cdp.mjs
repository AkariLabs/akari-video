#!/usr/bin/env node
// Open one fixture in the built shell first. No editor writes or shell configuration changes.
import { writeFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
const [endpoint, fixture = 'scale-x', frameArg = '0'] = process.argv.slice(2);
if (!endpoint) throw new Error('usage: node shell-cdp.mjs http://127.0.0.1:9222 [fixture]');
const require = createRequire(new URL('../../../../../../packages/render-cut/package.json', import.meta.url));
const puppeteer = require('puppeteer-core');
let browser;
const result = { fixture, endpoint, frames: [] };
try {
  browser = await puppeteer.connect({ browserURL: endpoint });
  let target;
  for (const page of await browser.pages()) for (const frame of page.frames()) {
    if (await frame.evaluate(() => !!document.querySelector('#overlay-stage [data-overlay-id="leaf"]')).catch(() => false)) target = frame;
  }
  if (!target) throw new Error('Open the specified fixture preview in the shell first');
  result.measurement = await target.evaluate(() => {
    const stage = document.getElementById('overlay-stage'), container = stage.querySelector('[data-overlay-id="leaf"]');
    const box = window.akari.interaction.fragmentBounds(container), rect = stage.getBoundingClientRect();
    const scale = rect.width / 640;
    return { width: box.width / scale, height: box.height / scale, time: window.akari.state?.currentTime,
      transform: container.style.transform, scaleX: container.style.getPropertyValue('--scale-x'), scaleY: container.style.getPropertyValue('--scale-y') };
  });
  const angle = fixture === 'rotated' ? Math.PI / 6 : 0;
  const axes = { 'scale-x': [2, 1], 'scale-y': [1, .5], rotated: [1.5, .75], 'group-leaf': [2.5, 1.25], legacy: [1.25, 1.25], keyframes: [1 + Number(frameArg) / 60, 1] }[fixture];
  if (!axes) throw new Error('Unknown fixture');
  result.expected = { width: (100 * Math.cos(angle) + 60 * Math.sin(angle)) * axes[0], height: (100 * Math.sin(angle) + 60 * Math.cos(angle)) * axes[1] };
  result.pass = ['width', 'height'].every(key => Math.abs(result.expected[key] - result.measurement[key]) <= 1);
} catch (error) { result.error = String(error.stack ?? error); result.pass = false; }
finally { await browser?.disconnect(); }
await mkdir(new URL('./results/', import.meta.url), { recursive: true });
await writeFile(new URL(`./results/shell-${fixture}.json`, import.meta.url), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result));
if (!result.pass) process.exitCode = 1;
