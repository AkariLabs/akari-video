#!/usr/bin/env node
// Usage: node evidence/c0a-group-media-render/run.mjs before|after
// Heavy slot must be held by the caller. All scratch paths are task-specific.
import { spawn, spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { chromium } from 'playwright-core';
import { CDP, PreviewFinder, evaluate } from './cdp-preview.mjs';

const phase = process.argv[2];
if (!['before', 'after'].includes(phase)) throw new Error('expected before or after');
const previewOnly = process.argv.includes('--preview-only');
const evidence = dirname(fileURLToPath(import.meta.url));
const repo = resolve(evidence, '../..');
const shell = join(repo, 'apps/shell');
const electronBinary = join(shell, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
const output = join(evidence, phase);
const scratch = await realpath(await mkdtemp('/tmp/libcanvas-c0a-'));
const workspace = join(scratch, 'workspace');
const port = 9547;
const times = [0.5, 2, 3.5];
const result = { phase, times, preview: {}, export: {}, comparisons: {}, errors: [] };
const clean = value => String(value).replaceAll(repo, '<repo>').replaceAll(scratch, '<scratch>')
  .replace(/\/Users\/[^\s"']+/g, '<local>');
const run = (command, args, cwd = repo) => {
  const proc = spawnSync(command, args, { cwd, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, AKARI_HOME: join(scratch, 'akari-home') } });
  return { code: proc.status, signal: proc.signal,
    error: clean(proc.error?.message ?? ''), stderr: clean(proc.stderr ?? '').slice(-3000) };
};
const ffmpeg = process.env.AKARI_FFMPEG || 'ffmpeg';
const extract = (mp4, second, png) => run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-ss', String(second), '-i', mp4,
  '-frames:v', '1', '-vf', 'scale=640:360', png]);
const rawRgb = png => spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-i', png,
  '-vf', 'scale=640:360', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 640 * 360 * 4 }).stdout;
const compare = (left, right) => {
  const a = rawRgb(left), b = rawRgb(right);
  if (!a || !b || a.length !== b.length) return { error: 'decode or size mismatch' };
  let max = 0, sum = 0;
  for (let i = 0; i < a.length; i++) { const diff = Math.abs(a[i] - b[i]); max = Math.max(max, diff); sum += diff; }
  return { max, mean: sum / a.length };
};
let electron, browser, cdp;
let electronStderr = '';
try {
  await mkdir(output, { recursive: true });
  result.electronPreflight = run(electronBinary, ['--version'], shell);
  if (result.electronPreflight.code !== 0) {
    throw new Error(`Electron preflight failed: ${result.electronPreflight.signal ?? result.electronPreflight.code}`);
  }
  await cp(join(evidence, 'fixture'), workspace, { recursive: true });
  await mkdir(join(workspace, '.akari'), { recursive: true });
  const { readRenderEdit } = await import('../../packages/render-cut/src/internal-render.mjs');
  const projected = readRenderEdit(await readFile(join(workspace, 'edit.json'), 'utf8'),
    join(workspace, '.akari', 'render-tmp'), { projectRoot: workspace });
  result.captionC0001RenderRecords = projected.edit.overlays
    .filter(overlay => overlay.captionId === 'c-0001').length;
  const editUri = pathToFileURL(join(workspace, 'edit.json')).href;
  electron = spawn(electronBinary, [shell, workspace, `--remote-debugging-port=${port}`,
    '--hostname=127.0.0.1', '--port=48841',
    `--user-data-dir=${join(scratch, 'profile')}`, '--no-sandbox'], { cwd: shell,
    stdio: ['ignore', 'ignore', 'pipe'],
    env: { ...process.env, AKARI_HOME: join(scratch, 'akari-home'), THEIA_CONFIG_DIR: join(scratch, 'config') } });
  electron.stderr?.on('data', chunk => { electronStderr = (electronStderr + String(chunk)).slice(-6000); });
  electron.on('error', error => { electronStderr = (electronStderr + String(error)).slice(-6000); });
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    if (electron.exitCode !== null || electron.signalCode !== null) {
      throw new Error(`Electron exited ${electron.exitCode ?? electron.signalCode}: ${clean(electronStderr)}`);
    }
    try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`); break; } catch { await sleep(500); }
  }
  if (!browser) throw new Error('CDP did not start');
  const page = browser.contexts()[0]?.pages()[0];
  if (!page) throw new Error('Theia page missing');
  await page.setViewportSize({ width: 1953, height: 1250 });
  const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
  cdp = new CDP(version.webSocketDebuggerUrl); await cdp.connect();
  const runtimeMessages = [];
  cdp.on('Runtime.consoleAPICalled', event => {
    if (['error', 'warning'].includes(event.type)) runtimeMessages.push(clean(
      (event.args ?? []).map(arg => arg.value ?? arg.description ?? '').join(' ')).slice(0, 500));
  });
  cdp.on('Runtime.exceptionThrown', event => runtimeMessages.push(clean(
    event.exceptionDetails?.exception?.description ?? event.exceptionDetails?.text ?? '').slice(0, 500)));
  const finder = new PreviewFinder(cdp); await finder.initialize();
  const command = async () => page.evaluate(async uri => {
    const dictionary = window.theia?.container?._bindingDictionary;
    const keys = dictionary?._map ? [...dictionary._map.keys()] : [];
    const key = keys.find(k => typeof k === 'function' && k.prototype
      && typeof k.prototype.executeCommand === 'function' && typeof k.prototype.registerCommand === 'function');
    if (!key) return 'not ready';
    try { return await window.theia.container.get(key).executeCommand('akari.preview.ensureVisible', { editUri: uri }); }
    catch (error) { return String(error); }
  }, editUri);
  let opened = false;
  for (let i = 0; i < 100; i++) {
    await page.getByRole('button', { name: '開くだけ' }).click({ timeout: 100 }).catch(() => {});
    const state = await command().catch(() => undefined);
    if (state === 'opened' || state === 'revealed') { opened = true; break; }
    await sleep(700);
  }
  result.previewOpened = opened;
  if (!opened) throw new Error('preview command unavailable');
  const preview = await finder.find(60000);
  for (let i = 0; i < 40; i++) {
    const ready = await evaluate(cdp, `(() => {
      const seek = document.getElementById('seek');
      return Number(seek?.max || 0) >= 3.5 && document.getElementById('preview-stage')?.getBoundingClientRect().width > 0;
    })()`, preview.contextId, preview.sessionId);
    if (ready) break;
    await sleep(250);
  }
  for (const second of times) {
    for (let attempt = 0; attempt < 3; attempt++) {
      await evaluate(cdp, `(() => { const seek = document.getElementById('seek'); seek.value = ${second};
        seek.dispatchEvent(new Event('input', { bubbles: true }));
        seek.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`, preview.contextId, preview.sessionId);
      await sleep(900);
      const actual = await evaluate(cdp, `Number(document.getElementById('seek')?.value)`, preview.contextId, preview.sessionId);
      if (Math.abs(actual - second) < 0.04) break;
    }
    const key = String(second).replace('.', '_');
    const shot = join(output, `preview-${key}.png`);
    result.preview[key] = await evaluate(cdp, `(() => ({
      seek: Number(document.querySelector('#seek')?.value),
      layerIds: [...document.querySelectorAll('[data-akari-layer-id]')].map(x => x.getAttribute('data-akari-layer-id')),
      overlayIds: [...document.querySelectorAll('[data-overlay-id]')].map(x => x.getAttribute('data-overlay-id')),
      captionText: document.querySelector('.caption-row-plate .akari-caption__line')?.textContent?.trim() ?? '',
      captionTransform: getComputedStyle(document.querySelector('#caption-plate')).transform,
      captionRows: document.querySelectorAll('.caption-row-plate').length,
      captionC0001DrawCount: document.querySelectorAll('.caption-row-plate[data-caption-key="caption-line"]').length,
      captionRowTransform: document.querySelector('.caption-row-plate')
        ? getComputedStyle(document.querySelector('.caption-row-plate')).transform : null,
      captionRowOpacity: document.querySelector('.caption-row-plate')
        ? getComputedStyle(document.querySelector('.caption-row-plate')).opacity : null,
      captionGeometry: (() => {
        const box = element => { if (!element) return null; const r = element.getBoundingClientRect();
          return { x: r.x, y: r.y, width: r.width, height: r.height,
            cx: r.x + r.width / 2, cy: r.y + r.height / 2 }; };
        const row = document.querySelector('.caption-row-plate');
        const line = row?.querySelector('.akari-caption__line');
        return { row: box(row), line: box(line),
          rowOrigin: row ? getComputedStyle(row).transformOrigin : null,
          lineFont: line ? getComputedStyle(line).fontFamily : null };
      })(),
      htmlOpacity: (() => { const el = document.querySelector('[data-overlay-id="html-card"]');
        return el ? getComputedStyle(el).opacity : null; })(),
      frameEngineReady: document.getElementById('frame-engine-preview')?.dataset.frameEngineReady ?? null,
      seekMax: Number(document.querySelector('#seek')?.max ?? 0),
      summaryLayers: window.akari?.state?.summary?.layers?.map(x => ({
        id: x.id, t: x.t, duration: x.duration, transform: x.transform, opacity: x.opacity
      })) ?? [],
      stage: (() => { const r = document.querySelector('#preview-stage')?.getBoundingClientRect(); return r ? { width: r.width, height: r.height } : null; })()
    }))()`, preview.contextId, preview.sessionId);
    const clip = await evaluate(cdp, `(() => { const r = document.getElementById('preview-stage').getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height, scale: 1 }; })()`, preview.contextId, preview.sessionId);
    const host = await page.locator('iframe[src*="akari-output-preview"]').first().boundingBox().catch(() => null);
    const pageClip = host ? {
      x: Math.max(0, host.x + clip.x), y: Math.max(0, host.y + clip.y),
      width: clip.width, height: clip.height
    } : null;
    result.preview[key].captureClip = pageClip;
    let shotBytes;
    if (pageClip && pageClip.width > 0 && pageClip.height > 0) {
      try {
        shotBytes = await page.screenshot({ clip: pageClip });
        result.preview[key].captureMethod = 'playwright-stage-clip';
      } catch (error) {
        result.preview[key].captureFallback = clean(error.message);
        shotBytes = await page.screenshot();
      }
    } else {
      shotBytes = await page.screenshot();
    }
    await writeFile(shot, shotBytes);
    result.preview[key].capturePixels = {
      width: shotBytes.readUInt32BE(16), height: shotBytes.readUInt32BE(20)
    };
    const size = (await stat(shot)).size;
    if (size > 500000) {
      const reduced = join(output, `preview-${key}-reduced.png`);
      run(ffmpeg, ['-hide_banner','-loglevel','error','-y','-i',shot,'-vf','scale=640:360',reduced]);
      await rm(shot); await cp(reduced, shot); await rm(reduced);
    }
  }
  await browser.close(); browser = null;
  result.runtimeMessages = runtimeMessages.slice(-30);
  cdp.close(); cdp = null;
  if (electron?.pid) { electron.kill('SIGTERM'); await sleep(1500); electron.kill('SIGKILL'); electron = null; }
  for (const engine of previewOnly ? [] : ['gpu', 'osr']) {
    const mp4 = join(scratch, `${engine}.mp4`);
    const cli = join(repo, `packages/${engine}-export/bin/akari-${engine}-export.mjs`);
    const invocation = run(process.execPath, [cli, workspace, '--out', mp4, '--duration', '4', '--frames', '106',
      '--width', '640', '--height', '360', '--fps', '30', '--soft']);
    result.export[engine] = invocation;
    if (invocation.code !== 0) continue;
    for (const second of times) {
      const key = String(second).replace('.', '_');
      const png = join(output, `${engine}-${key}.png`);
      result.export[`${engine}-${key}`] = extract(mp4, second, png);
      if (result.export[`${engine}-${key}`].code === 0) result.comparisons[`${engine}-preview-${key}`] = compare(png, join(output, `preview-${key}.png`));
    }
  }
  for (const second of previewOnly ? [] : times) {
    const key = String(second).replace('.', '_');
    const a = join(output, `gpu-${key}.png`), b = join(output, `osr-${key}.png`);
    if (await stat(a).catch(() => false) && await stat(b).catch(() => false)) result.comparisons[`gpu-osr-${key}`] = compare(a, b);
  }
} catch (error) { result.errors.push(clean(error?.stack ?? error)); }
finally {
  result.electronStderr = clean(electronStderr).slice(-1200);
  await browser?.close().catch(() => {});
  cdp?.close();
  if (electron?.pid) { electron.kill('SIGTERM'); await sleep(1500); electron.kill('SIGKILL'); }
  const name = result.errors.length
    ? `${phase}${previewOnly ? '-preview-probe' : ''}-attempt.json`
    : `${phase}${previewOnly ? '-preview-probe' : ''}.json`;
  await writeFile(join(evidence, name), JSON.stringify(result, null, 2) + '\n');
  await rm(scratch, { recursive: true, force: true });
}
if (result.errors.length) process.exitCode = 1;
