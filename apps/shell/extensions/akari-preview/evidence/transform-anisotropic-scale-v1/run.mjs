#!/usr/bin/env node
// Run with node run.mjs. Optional --surface web|gpu|osr and --case <fixture>.
// Actual exporter capture APIs are used; unavailable surfaces are never marked passed.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PARITY_FIXTURES, recomputeComparisons } from './compare-results.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const repo = resolve(here, '../../../../../..');
const option = name => { const i = process.argv.indexOf(`--${name}`); return i < 0 ? null : process.argv[i + 1]; };
const cases = option('case') ? [...PARITY_FIXTURES, 'legacy-keyframes'].filter(name => name === option('case')) : PARITY_FIXTURES;
const surfaces = ['web', 'gpu', 'osr'].filter(name => !option('surface') || option('surface') === name);
if (!cases.length || !surfaces.length) throw new Error('Unknown --case or --surface');
const frames = [0, 15, 30, 45, 59];
const results = { measuredAt: new Date().toISOString(), frames, checks: [], surfaces: [], comparisons: [] };
const out = join(here, 'results');
await mkdir(out, { recursive: true });
const moduleAt = path => import(pathToFileURL(join(repo, path)));
const errorText = error => String(error?.stack ?? error);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const expected = (name, frame) => {
  const axes = name === 'scale-x' ? [2, 1] : name === 'scale-y' ? [1, .5] : name === 'rotated' ? [1.5, .75]
    : name === 'group-leaf' ? [2.5, 1.25] : name === 'keyframes' ? [1 + frame / 60, 1] : name === 'legacy-keyframes' ? [1 + frame / 60, 1 + frame / 60] : [1.25, 1.25];
  const a = name === 'rotated' ? Math.PI / 6 : 0;
  return { width: (100 * Math.cos(a) + 60 * Math.sin(a)) * axes[0],
    height: (100 * Math.sin(a) + 60 * Math.cos(a)) * axes[1] };
};
const resultName = option('surface') || option('case') ? `results-${option('surface') ?? 'all'}-${option('case') ?? 'all'}.json` : 'results.json';
async function save() { await writeFile(join(out, resultName), JSON.stringify(results, null, 2) + '\n'); }

try {
  const { readEditV2 } = await moduleAt('packages/edit-store/lib/edit-v2.js');
  const { serializeEdit } = await moduleAt('packages/edit-store/lib/canonical.js');
  const raw = await readFile(join(here, 'fixtures/legacy/edit.json'), 'utf8');
  const value = JSON.parse(raw);
  readEditV2(value);
  results.checks.push({ name: 'legacy-read-byte-invariant', pass: JSON.stringify(value) === JSON.stringify(JSON.parse(raw)) });
  const canonical = serializeEdit(value);
  results.checks.push({ name: 'legacy-canonical-byte-invariant', pass: serializeEdit(JSON.parse(canonical)) === canonical });
  value.tracks[0].items[0].source = { kind: 'group' };
  value.tracks[0].items[0].transform = { scaleX: 2 };
  let rejected = false;
  try { readEditV2(value); } catch { rejected = true; }
  results.checks.push({ name: 'group-axis-rejected', pass: rejected });
} catch (error) { results.checks.push({ name: 'contract-checks', status: 'blocked', error: errorText(error) }); }
await save();

async function loadPuppeteer() {
  const roots = [join(repo, 'packages/render-cut/package.json')];
  const git = await readFile(join(repo, '.git'), 'utf8').catch(() => '');
  const common = git.trim().replace(/^gitdir:\s*/, '').split('/.git/worktrees/')[0];
  if (common) roots.push(join(common, 'packages/render-cut/package.json'));
  for (const root of roots) { try { return createRequire(root)('puppeteer-core'); } catch {} }
  throw new Error('puppeteer-core unavailable');
}
async function chromeExecutable() {
  if (process.env.AKARI_CHROME_EXECUTABLE) return process.env.AKARI_CHROME_EXECUTABLE;
  return '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
}
async function waitForServer(child, port, logs) {
  for (let i = 0; i < 200; i++) {
    if (child.exitCode !== null) throw new Error(`preview-server exited ${child.exitCode}: ${logs.text}`);
    try { const response = await fetch(`http://127.0.0.1:${port}/`); if (response.ok) return; } catch {}
    await pause(100);
  }
  throw new Error(`preview-server startup timed out: ${logs.text}`);
}
async function seek(page, port, frame) {
  const sequence = await page.evaluate(() => window.__axisSeek.sequence);
  const socket = new WebSocket(`ws://127.0.0.1:${port}`);
  try {
    await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
    socket.send(JSON.stringify({ type: 'seek', time: frame / 30 }));
    await page.waitForFunction(({ sequence, frame }) => window.__axisSeek.sequence > sequence
      && Math.round(window.__axisSeek.time * 30) === frame, { timeout: 15000 }, { sequence, frame });
  } catch (error) {
    const observed = await page.evaluate(() => ({ ...window.__axisSeek,
      seek: document.getElementById('seek')?.value, max: document.getElementById('seek')?.max }));
    throw new Error(`WebSocket seek frame ${frame} did not render: ${JSON.stringify(observed)}; ${error.message}`);
  } finally { socket.close(); }
}
async function webCapture(name, directory) {
  const puppeteer = await loadPuppeteer();
  const port = 18000 + Math.floor(Math.random() * 10000);
  const project = join(here, 'fixtures', name);
  const logs = { text: '' };
  const child = spawn(process.execPath, [join(repo, 'packages/preview-server/src/server.mjs'), project, '--port', String(port), '--no-lint'], { cwd: repo, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', data => { logs.text += data; });
  child.stderr.on('data', data => { logs.text += data; });
  let browser;
  const outputs = [];
  try {
    await waitForServer(child, port, logs);
    browser = await puppeteer.launch({ executablePath: await chromeExecutable(), headless: true,
      args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });
    await page.goto(`http://127.0.0.1:${port}/?frameEngine=0`, { waitUntil: 'networkidle0', timeout: 30000 });
    await page.waitForSelector('[data-overlay-id="leaf"] [data-akari-part="rectangle"]');
    await page.evaluate(() => {
      const original = window.akari.runtime.tick;
      const clock = window.__axisSeek = { sequence: 0, time: null };
      window.akari.runtime.tick = function(...args) {
        const result = Reflect.apply(original, this, args);
        clock.time = args[0]; clock.sequence++; return result;
      };
    });
    const cdp = await page.createCDPSession();
    for (const frame of frames) {
      await seek(page, port, frame);
      await page.waitForFunction(frame => {
        const el = document.querySelector('[data-overlay-id="leaf"]');
        return el && getComputedStyle(el).visibility === 'visible';
      }, {}, frame);
      const measured = await page.evaluate(() => {
        const container = document.querySelector('[data-overlay-id="leaf"]');
        const stage = container.parentElement;
        const stageRect = stage.getBoundingClientRect();
        const box = window.akari?.interaction?.fragmentBounds(container) ?? container.querySelector('[data-akari-part]').getBoundingClientRect();
        const scale = stageRect.width / 640;
        return { width: box.width / scale, height: box.height / scale,
          renderedTime: window.__axisSeek.time, renderedFrame: Math.round(window.__axisSeek.time * 30),
          seekMax: Number(document.getElementById('seek').max),
          stage: { x: stageRect.x, y: stageRect.y, width: stageRect.width, height: stageRect.height },
          usedFragmentBounds: !!window.akari?.interaction?.fragmentBounds };
      });
      const target = expected(name, frame);
      const pass = Math.abs(measured.width - target.width) <= 1 && Math.abs(measured.height - target.height) <= 1;
      const capture = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true,
        clip: { ...measured.stage, scale: 640 / measured.stage.width } });
      const path = join(directory, `frame-${frame}.png`);
      await writeFile(path, Buffer.from(capture.data, 'base64'));
      outputs.push({ frameNumber: frame, path, measured, expected: target, pass });
    }
    return { status: outputs.every(value => value.pass) ? 'passed' : 'failed', outputs };
  } finally {
    await browser?.close(); child.kill();
    await writeFile(join(directory, 'server.log'), logs.text);
  }
}

for (const name of cases) for (const surface of surfaces) {
  const directory = join(out, name, surface);
  await mkdir(directory, { recursive: true });
  const entry = { fixture: name, surface, measuredAt: new Date().toISOString() };
  results.surfaces.push(entry);
  try {
    if (surface === 'web') Object.assign(entry, await webCapture(name, directory));
    else {
      const api = await moduleAt(`packages/${surface}-export/src/index.mjs`);
      const projectRoot = join(here, 'fixtures', name);
      const extra = option('electron') ? { launcher: { tier: 2, kind: 'npm-electron', executable: resolve(option('electron')) } } : {};
      if (surface === 'gpu') {
        const { readRenderEdit } = await moduleAt('packages/render-cut/src/internal-render.mjs');
        const { evaluateGpuEligibility } = await moduleAt('packages/gpu-export/src/eligibility.mjs');
        const { edit } = readRenderEdit(await readFile(join(projectRoot, 'edit.json'), 'utf8'), directory, { projectRoot });
        extra.eligibility = evaluateGpuEligibility({ edit, captions: [] });
      }
      const capture = surface === 'gpu' ? api.captureFramesWithGpu : api.captureFramesWithOsr;
      const captured = await capture({ projectRoot, outputDirectory: directory, frameNumbers: frames,
        fps: 30, width: 640, height: 360, duration: 2, frames: 60, ...extra });
      Object.assign(entry, { status: 'passed', outputs: captured.run.outputs, receipt: captured.receipt });
    }
  } catch (error) { Object.assign(entry, { status: 'blocked', error: errorText(error) }); }
  await save();
  console.log(`${name} ${surface}: ${entry.status}`);
}

await recomputeComparisons(results, out);
results.shell = { status: 'not-run', reason: 'Tier 2: open a fixture in the built shell and run shell-cdp.mjs against its CDP endpoint.' };
await save();
if (!results.pass) process.exitCode = 1;
