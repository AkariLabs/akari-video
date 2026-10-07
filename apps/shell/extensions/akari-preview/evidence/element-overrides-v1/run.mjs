#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import { CASES, FRAMES, createFixtures } from './fixtures.mjs';
import { geometryChecks } from './geometry.mjs';
import { recomputeComparisons } from './compare-results.mjs';
import { expandBagOverlays } from '../../../../../../packages/overlay-runtime/src/parts.mjs';
import { validateV2ObjectTreeFiles } from '../../../../../../packages/edit-lint/src/lint/edit-v2.mjs';
import { readRenderEdit } from '../../../../../../packages/render-cut/src/internal-render.mjs';
import { loadOverlays } from '../../../../../../packages/render-cut/src/render-cut.mjs';
import { evaluateGpuEligibility } from '../../../../../../packages/gpu-export/src/eligibility.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const repo = resolve(here, '../../../../../..');
const out = join(here, 'results');
const option = name => { const index = process.argv.indexOf(`--${name}`); return index < 0 ? null : process.argv[index + 1]; };
const selectedCases = option('case') ? CASES.filter(name => name === option('case')) : CASES;
const selectedSurfaces = option('surface') ? ['web', 'gpu', 'osr'].filter(name => name === option('surface')) : ['web', 'gpu', 'osr'];
if (!selectedCases.length || !selectedSurfaces.length) throw new Error('Unknown case or surface');
const checksOnly = process.argv.includes('--checks-only');
const report = { measuredAt: new Date().toISOString(), checks: [], surfaces: [], comparisons: [], launcher_tier: null };
const resultName = checksOnly ? 'results-checks.json' : option('surface') || option('case')
  ? `results-${option('surface') ?? 'all'}-${option('case') ?? 'all'}.json` : 'results.json';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const pause = ms => new Promise(done => setTimeout(done, ms));
const errorText = error => String(error?.stack ?? error);
const save = () => writeFile(join(out, resultName), JSON.stringify(report, null, 2) + '\n');
await mkdir(out, { recursive: true });
const projects = await createFixtures(join(out, 'fixtures'));
const { readEditV2 } = await import('../../../../../../packages/edit-store/lib/edit-v2.js');
const { serializeEdit } = await import('../../../../../../packages/edit-store/lib/canonical.js');
const schema = JSON.parse(await readFile(join(repo, 'packages/schemas/edit.schema.json'), 'utf8'));
const validateSource = new Ajv2020({ strict: false }).compile({ $defs: schema.$defs, $ref: '#/$defs/itemSourceHtmlV2' });
const hashes = {};
for (const name of CASES) {
  hashes[name] = {};
  for (const file of await readdir(projects[name])) hashes[name][file] = sha(await readFile(join(projects[name], file)));
}
const addCheck = (name, pass, details) => report.checks.push({ name, pass, ...(details ? { details } : {}) });
const doc = name => readFile(join(projects[name], 'edit.json'), 'utf8').then(JSON.parse);
const gpuEligibilityFor = async name => {
  const { edit } = readRenderEdit(await readFile(join(projects[name], 'edit.json'), 'utf8'),
    join(out, 'render-tmp'), { projectRoot: projects[name] });
  const loaded = await loadOverlays(projects[name], edit);
  return evaluateGpuEligibility({ edit: { ...edit, overlays: loaded }, captions: [], forceDegraded: true });
};
try {
  const legacy = await doc('legacy');
  const raw = await readFile(join(projects.legacy, 'edit.json'), 'utf8');
  const legacyBefore = JSON.stringify(legacy);
  readEditV2(legacy);
  addCheck('legacy-read-byte-invariant', JSON.stringify(legacy) === legacyBefore);
  addCheck('legacy-canonical-stable', serializeEdit(JSON.parse(serializeEdit(legacy))) === serializeEdit(legacy));
  const oldRecords = expandBagOverlays({ tracks: [{ items: [{ id: 'leaf', at: 0, duration: 2,
    source: { kind: 'html', html: 'fragment.html' }, declaration: { id: 'leaf' } }] }] });
  const emptyRecords = expandBagOverlays({ tracks: [{ items: [{ id: 'leaf', at: 0, duration: 2,
    source: { kind: 'html', html: 'fragment.html', elements: {} }, declaration: { id: 'leaf' } }] }] });
  addCheck('legacy-record-byte-invariant', JSON.stringify(oldRecords) === JSON.stringify(emptyRecords));
  addCheck('legacy-input-byte-invariant', raw === await readFile(join(projects.legacy, 'edit.json'), 'utf8'));
  for (const [name, root] of [
    ['object-tree-html-bag', join(repo, 'packages/render-cut/test/fixtures/object-tree-html-bag')],
    ['transform-anisotropic-legacy', join(repo, 'apps/shell/extensions/akari-preview/evidence/transform-anisotropic-scale-v1/fixtures/legacy')],
  ]) {
    const editRaw = await readFile(join(root, 'edit.json'), 'utf8');
    const expanded = JSON.parse(editRaw);
    const markEmpty = items => { for (const item of items ?? []) {
      if (item.source?.kind === 'html') item.source.elements = {};
      markEmpty(item.items);
    } };
    for (const track of expanded.tracks ?? []) markEmpty(track.items);
    const beforeRecords = readRenderEdit(editRaw, join(out, 'render-tmp'), { projectRoot: root }).edit.overlays;
    const afterRecords = readRenderEdit(JSON.stringify(expanded), join(out, 'render-tmp'), { projectRoot: root }).edit.overlays;
    addCheck(`existing-record-byte-invariant:${name}`, JSON.stringify(beforeRecords) === JSON.stringify(afterRecords));
  }
  for (const address of ['div', '.a b[0]', '.bar', '.bar[-1]', '.bar[01]']) {
    const invalid = await doc('bars');
    invalid.tracks[0].items[0].source.elements = { [address]: { style: { height: '1px' } } };
    let rejected = false;
    try { readEditV2(invalid); } catch { rejected = true; }
    addCheck(`invalid-address-${address}`, rejected && !validateSource(invalid.tracks[0].items[0].source));
  }
  const invalid = await doc('missing');
  const findings = [];
  await validateV2ObjectTreeFiles(invalid, findings, { projectRoot: projects.missing,
    captionsPath: join(projects.missing, 'captions.json') });
  addCheck('missing-address-warnings', findings.filter(value => value.check === 'v2.element-ref'
    && value.severity === 'warning').length === 2, findings.filter(value => value.check === 'v2.element-ref'));
  const missingRender = readRenderEdit(JSON.stringify(invalid), join(out, 'render-tmp'), { projectRoot: projects.missing });
  addCheck('missing-address-render-unchanged', missingRender.edit.overlays[0].html
    === await readFile(join(projects.missing, 'fragment.html'), 'utf8'));
  const pathsRender = readRenderEdit(JSON.stringify(await doc('paths')), join(out, 'render-tmp'), { projectRoot: projects.paths });
  const pathOverlay = pathsRender.edit.overlays[0];
  const pathProbe = { htmlPath: pathOverlay.htmlPath, inline: pathOverlay.html.trimStart().startsWith('<'),
    relativeImg: pathOverlay.html.includes('./x.png'), relativeCss: pathOverlay.html.includes('./y.png') };
  addCheck('inline-relative-path-probe', pathProbe.htmlPath === 'fragment.html'
    && pathProbe.inline && pathProbe.relativeImg && pathProbe.relativeCss, pathProbe);
  const { loadAndBuildOsrPage } = await import('../../../../../../packages/osr-export/src/page-builder.mjs');
  const { loadAndBuildGpuPage } = await import('../../../../../../packages/gpu-export/src/page-builder.mjs');
  const osrPage = await loadAndBuildOsrPage({ projectRoot: projects.paths, duration: 2 });
  const gpuPage = await loadAndBuildGpuPage({ projectRoot: projects.paths, duration: 2 });
  for (const [surface, rendered] of [
    ['osr', osrPage.overlaySheetHtml], ['gpu-sprite', gpuPage.spriteManifest.statics[0]?.html],
  ]) {
    const result = { dataUrls: (rendered?.match(/data:image\/png;base64,/gu) ?? []).length,
      relativeImg: rendered?.includes('./x.png'), relativeCss: rendered?.includes('./y.png') };
    addCheck(`inline-relative-assets-embedded:${surface}`, result.dataUrls >= 2
      && result.relativeImg === false && result.relativeCss === false, result);
  }
  for (const [left, right] of [['bars-base', 'bars'], ['card-base', 'card'],
    ['paths-base', 'paths'], ['bars-base', 'missing']]) {
    const before = await gpuEligibilityFor(left), after = await gpuEligibilityFor(right);
    const identity = value => value.entries.map(entry => ({ classification: entry.classification, reason: entry.reason }));
    addCheck(`gpu-eligibility-parity:${left}:${right}`,
      before.eligible === after.eligible && JSON.stringify(identity(before)) === JSON.stringify(identity(after)),
      { before: identity(before), after: identity(after) });
  }
} catch (error) { addCheck('contract-checks', false, errorText(error)); }
await save();

const require = createRequire(join(repo, 'packages/render-cut/package.json'));
const puppeteer = () => require('puppeteer-core');
async function webCapture(name, directory) {
  const port = 18000 + Math.floor(Math.random() * 10000), project = projects[name];
  let log = '';
  const server = spawn(process.execPath, [join(repo, 'packages/preview-server/src/server.mjs'), project,
    '--port', String(port), '--no-lint'], { cwd: repo, stdio: ['ignore', 'pipe', 'pipe'] });
  server.stdout.on('data', bytes => { log += bytes; });
  server.stderr.on('data', bytes => { log += bytes; });
  let browser;
  try {
    let ready = false;
    for (let i = 0; i < 200; i++) {
      if (server.exitCode !== null) throw new Error(`Preview server exited: ${log}`);
      try { ready = (await fetch(`http://127.0.0.1:${port}/`)).ok; } catch {}
      if (ready) break;
      await pause(100);
    }
    if (!ready) throw new Error(`Preview server timeout: ${log}`);
    browser = await puppeteer().launch({ executablePath: process.env.AKARI_CHROME_EXECUTABLE
      ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true,
    args: ['--no-sandbox'] });
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });
    await page.goto(`http://127.0.0.1:${port}/?frameEngine=0`, { waitUntil: 'networkidle0', timeout: 30000 });
    await page.waitForSelector('#overlay-stage [data-overlay-id]', { timeout: 30000 });
    const outputs = [];
    const cdp = await page.createCDPSession();
    for (const frame of FRAMES) {
      await page.evaluate(frame => {
        const seek = document.getElementById('seek');
        seek.step = 'any'; seek.value = String(frame / 30);
        seek.dispatchEvent(new Event('input', { bubbles: true }));
        seek.dispatchEvent(new Event('change', { bubbles: true }));
      }, frame);
      await page.waitForFunction(caseName => {
        const stage = document.getElementById('overlay-stage');
        if (!stage) return false;
        const target = caseName.startsWith('bars') || caseName === 'missing' || caseName === 'legacy' ? 'bar'
          : caseName.startsWith('card') ? 'heading' : caseName.startsWith('bag') ? 'free' : 'tile';
        const count = target === 'bar' ? 5 : caseName.startsWith('bag') && caseName !== 'bag-lazy' ? 2 : 1;
        const elements = [...stage.querySelectorAll(`.${target}`)];
        return elements.length >= count && elements.every(element => {
          const box = element.getBoundingClientRect(); return box.width > 0 && box.height > 0;
        }) && (!caseName.startsWith('paths') || [...stage.querySelectorAll('img')]
          .every(image => image.complete && image.naturalWidth > 0));
      }, { timeout: 15000 }, name);
      const measurement = await page.evaluate(() => {
        const stage = document.getElementById('overlay-stage'), rect = stage.getBoundingClientRect();
        const scale = rect.width / 640;
        const box = element => { const r = element.getBoundingClientRect();
          return { left: (r.left - rect.left) / scale, top: (r.top - rect.top) / scale,
            width: r.width / scale, height: r.height / scale,
            centerX: (r.left + r.width / 2 - rect.left) / scale,
            centerY: (r.top + r.height / 2 - rect.top) / scale }; };
        const classes = ['bg', 'chart', 'col', 'bar', 'val', 'card', 'heading', 'body',
          'part', 'a', 'b', 'free', 'tile', 'photo'];
        return { stage: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
          boxes: Object.fromEntries(classes.map(name => [name, [...stage.querySelectorAll(`.${name}`)].map(box)])),
          styles: { free: [...stage.querySelectorAll('.free')].map(element => element.getAttribute('style') ?? '') },
          imagesLoaded: [...stage.querySelectorAll('img')].every(image => image.complete && image.naturalWidth > 0) };
      });
      const capture = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true,
        clip: { ...measurement.stage, scale: 640 / measurement.stage.width } });
      const path = join(directory, `frame-${frame}.png`);
      await writeFile(path, Buffer.from(capture.data, 'base64'));
      outputs.push({ frameNumber: frame, path, measurement });
    }
    return { status: 'passed', outputs };
  } finally { await browser?.close(); server.kill(); await writeFile(join(directory, 'server.log'), log); }
}

if (!checksOnly) for (const name of selectedCases) for (const surface of selectedSurfaces) {
  const directory = join(out, name, surface);
  await mkdir(directory, { recursive: true });
  const entry = { fixture: name, surface, measuredAt: new Date().toISOString(), status: 'blocked' };
  report.surfaces.push(entry);
  try {
    if (surface === 'web') Object.assign(entry, await webCapture(name, directory));
    else {
      const api = await import(`../../../../../../packages/${surface}-export/src/index.mjs`);
      const capture = surface === 'gpu' ? api.captureFramesWithGpu : api.captureFramesWithOsr;
      const executable = resolve(option('electron') ?? join(repo, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'));
      process.env.AKARI_EXPORT_ALLOW_DESKTOP = '0';
      const extra = { launcher: { tier: 2, kind: 'npm-electron', executable } };
      if (surface === 'gpu') {
        const eligibility = await gpuEligibilityFor(name);
        const forced = eligibility.eligible !== true && eligibility.summary.unsupported === 0;
        extra.eligibility = eligibility;
        if (forced) extra.force = true;
        entry.gpuEligibility = { eligible: eligibility.eligible, forced,
          entries: eligibility.entries, summary: eligibility.summary };
      }
      const result = await capture({ projectRoot: projects[name], outputDirectory: directory,
        frameNumbers: FRAMES, fps: 30, width: 640, height: 360, duration: 2, frames: 60, ...extra });
      const launcherTier = result.receipt?.launcherTier ?? null;
      Object.assign(entry, { status: launcherTier === 2 ? 'passed' : 'failed',
        ...(launcherTier === 2 ? {} : { reason: `tier 2 launcher required; receipt.launcherTier=${String(launcherTier)}` }),
        outputs: result.run.outputs, receipt: result.receipt,
        launcher_tier: launcherTier, desktop_fallback: false });
    }
  } catch (error) { entry.error = errorText(error); }
  await save();
  console.log(`${name}/${surface}: ${entry.status}`);
}
report.checks.push(...geometryChecks(name => report.surfaces.find(value =>
  value.fixture === name && value.surface === 'web')?.outputs?.[0]?.measurement));
for (const name of CASES) for (const [file, before] of Object.entries(hashes[name])) {
  addCheck(`fragment-sha256-unchanged:${name}/${file}`, before === sha(await readFile(join(projects[name], file))), { before, after: sha(await readFile(join(projects[name], file)))});
}
await recomputeComparisons(report, out);
await save();
if (!report.pass && !checksOnly) process.exitCode = 1;
if (checksOnly && !report.checks.every(check => check.pass)) process.exitCode = 1;

// Both paths are canonicalized, so a symlink invocation runs the script too.
if (process.argv[1] && await realpath(process.argv[1]) !== await realpath(fileURLToPath(import.meta.url))) process.exitCode = 1;
