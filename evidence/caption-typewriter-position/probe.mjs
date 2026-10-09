#!/usr/bin/env node
// Launch the built shell on a disposable project copy, seek the output
// preview to given times, screenshot the preview stage and dump caption DOM geometry.
//   node probe.mjs --repo <checkout> --project <copy> --out <scratch-dir> --times 1,1.25,1.5 [--focus <caption-id>] [--replay <caption-id>:typewriter] [--port 9391]
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
for (const name of ['--repo', '--project', '--out']) {
  if (!opt(name)) throw new Error(`missing ${name}`);
}
const repo = path.resolve(opt('--repo'));
const project = path.resolve(opt('--project'));
const out = path.resolve(opt('--out'));
const label = opt('--label', 'run');
const times = opt('--times', '1,1.25,1.5').split(',').map(Number);
const replay = opt('--replay', null);
const focus = opt('--focus', '');
if (!times.length || times.some(time => !Number.isFinite(time) || time < 0)) throw new Error('invalid --times');
const port = Number(opt('--port', '9391'));
const require = createRequire(path.join(repo, 'package.json'));
const puppeteer = require('puppeteer-core');
const shell = path.join(repo, 'apps/shell');
const electron = path.join(repo, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
const editUri = pathToFileURL(path.join(project, 'edit.json')).href;

await mkdir(out, { recursive: true });
const scratch = await mkdtemp(path.join(os.tmpdir(), 'ctp-shell-'));
const env = { ...process.env, HOME: path.join(scratch, 'home'), AKARI_HOME: path.join(scratch, 'akari-home'),
  THEIA_CONFIG_DIR: path.join(scratch, 'theia') };
delete env.ELECTRON_RUN_AS_NODE;
for (const d of [env.HOME, env.AKARI_HOME, env.THEIA_CONFIG_DIR]) await mkdir(d, { recursive: true });
let log = '';
const child = spawn(electron, [shell, project, `--remote-debugging-port=${port}`, '--hostname=127.0.0.1',
  `--port=${port + 100}`, `--user-data-dir=${path.join(scratch, 'profile')}`, '--no-sandbox',
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'],
{ cwd: shell, env, stdio: ['ignore', 'pipe', 'pipe'] });
child.stdout.on('data', c => { log = (log + c).slice(-20000); });
child.stderr.on('data', c => { log = (log + c).slice(-20000); });
const result = { label, project: path.basename(project), times: [], error: null };
let browser;
try {
  let page;
  for (let i = 0; i < 240 && !page; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      if (list.some(t => t.type === 'page' && !t.url.startsWith('devtools:'))) {
        browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${port}`, defaultViewport: null });
        page = (await browser.pages()).find(p => !p.url().startsWith('devtools:'));
      }
    } catch {}
    if (!page) await sleep(500);
  }
  if (!page) throw new Error('no page');
  for (let i = 0; i < 300; i++) {
    const ok = await page.evaluate(() => Boolean(window.theia?.container) && !document.querySelector('.theia-preload')).catch(() => false);
    if (ok) break;
    await sleep(1000);
  }
  await page.setViewport({ width: 1600, height: 1000 }).catch(() => {});
  const command = (id, value) => page.evaluate(async (id, value) => {
    const d = window.theia.container._bindingDictionary;
    const keys = d?._map ? [...d._map.keys()] : [];
    const C = keys.find(k => typeof k === 'function' && k.prototype
      && typeof k.prototype.executeCommand === 'function' && typeof k.prototype.registerCommand === 'function');
    return window.theia.container.get(C).executeCommand(id, value);
  }, id, value);
  await command('akari.preview.ensureVisible', { editUri });
  const findFrame = async () => {
    for (let i = 0; i < 120; i++) {
      for (const f of page.frames()) {
        if (f.detached) continue;
        if (await f.evaluate(() => Boolean(window.__akariPreview && document.querySelector('#preview-stage'))).catch(() => false)) return f;
      }
      await sleep(1000);
    }
    throw new Error('preview frame not found');
  };
  await findFrame();
  await sleep(6000);
  let frame = await findFrame();
  await frame.evaluate(() => { window.__ctpErrors = []; window.addEventListener('error', e => window.__ctpErrors.push(String(e.message))); });
  const measure = async () => { frame = await findFrame(); return frame.evaluate((focus) => {
    const r = el => { if (!el) return null; const b = el.getBoundingClientRect();
      return { x: +b.x.toFixed(2), y: +b.y.toFixed(2), w: +b.width.toFixed(2), h: +b.height.toFixed(2) }; };
    const stage = document.querySelector('#preview-stage');
    const rows = [...document.querySelectorAll('#caption-plate .caption-row-plate')].map(row => {
      const plate = row.querySelector('.akari-caption__plate');
      const lines = [...row.querySelectorAll('.akari-caption__line')];
      // Painted glyph box: union of text client rects of each line.
      const glyph = (() => { let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (const line of lines) { const range = document.createRange(); range.selectNodeContents(line);
          for (const b of range.getClientRects()) { if (!b.width) continue; x0 = Math.min(x0, b.left); y0 = Math.min(y0, b.top); x1 = Math.max(x1, b.right); y1 = Math.max(y1, b.bottom); } }
        return x0 === Infinity ? null : { x: +x0.toFixed(2), y: +y0.toFixed(2), w: +(x1 - x0).toFixed(2), h: +(y1 - y0).toFixed(2) }; })();
      const chars = [...row.querySelectorAll('.akari-caption__type-char')].filter(c => !c.querySelector('.akari-caption__type-char'));
      const replayChars = [...row.querySelectorAll('.akari-caption__replay-char')];
      const cs = getComputedStyle(row);
      return { key: row.dataset.captionKey ?? null, display: cs.display, visibility: cs.visibility, opacity: cs.opacity,
        visible: row.checkVisibility?.({ opacityProperty: true, visibilityProperty: true }) ?? null,
        text: row.textContent?.trim().slice(0, 40), row: r(row), plate: r(plate), line: r(lines[0]), glyph,
        plateTransform: plate ? getComputedStyle(plate).transform : null,
        plateAnimation: plate ? getComputedStyle(plate).animationName : null,
        replay: lines.some(l => l.dataset.akariMotionReplay),
        replayVisible: replayChars.filter(c => getComputedStyle(c).visibility === 'visible').length,
        replayTotal: replayChars.length,
        chars: chars.map(c => { let o = 1; for (let e = c; e && e !== row; e = e.parentElement) o *= Number(getComputedStyle(e).opacity); return +o.toFixed(2); }) };
    });
    const summary = window.__akariPreview?.summary ?? {};
    const capList = (summary.captions ?? summary.captionItems ?? []);
    const cap = Array.isArray(capList) ? capList.find(c => (c.sourceCueId || c.id) === focus) : null;
    return { errors: (window.__ctpErrors || []).slice(-5), outputTime: window.__akariPreview?.outputTime ?? null, stage: r(stage), rows,
      summaryKeys: Object.keys(summary), captionCount: Array.isArray(capList) ? capList.length : null,
      focusCaption: cap ? JSON.parse(JSON.stringify(cap, (k, v) => k === 'words' ? undefined : v)) : null,
      focusRowHtml: [...document.querySelectorAll('#caption-plate .caption-row-plate')].find(r => (r.dataset.captionKey || '').includes(focus))?.outerHTML?.slice(0, 3000) ?? null };
  }, focus); };
  const stageShot = async name => {
    frame = await findFrame();
    const el = await frame.$('#preview-stage');
    await el.screenshot({ path: path.join(out, `${label}-${name}.png`) });
  };
  for (const t of times) {
    await command('akari.preview.seekOutput', { editUri, time: t, waitForReady: true });
    await sleep(1200);
    const m = await measure();
    await stageShot(`t${t.toFixed(2)}`);
    result.times.push({ t, ...m });
  }
  if (replay) {
    const [captionId, id] = replay.split(':');
    const t = times[times.length - 1];
    await command('akari.preview.seekOutput', { editUri, time: t, waitForReady: true });
    await sleep(800);
    frame = await findFrame();
    await frame.evaluate((captionId, id) => window.dispatchEvent(new MessageEvent('message',
      { data: { type: 'akari-preview-caption-motion-play', captionId, id, kind: 'motion', slot: 'in' } })), captionId, id);
    const samples = [];
    const t0 = Date.now();
    for (const ms of [300, 600, 900, 1200, 1500, 1800, 2400, 3200]) {
      await sleep(Math.max(0, t0 + ms - Date.now()));
      const m = await measure();
      await stageShot(`replay-${ms}ms`);
      samples.push({ ms, ...m });
    }
    result.replay = { captionId, id, atOutput: t, samples };
    const boxes = samples.map(sample => sample.rows.find(row => row.key === captionId)?.plate).filter(Boolean);
    if (boxes.length !== samples.length) throw new Error('replay caption plate missing');
    const first = boxes[0];
    const maxDeltaPx = Math.max(...boxes.map(box => Math.max(
      Math.abs(box.x - first.x), Math.abs(box.y - first.y),
      Math.abs(box.w - first.w), Math.abs(box.h - first.h))));
    result.replay.maxPlateDeltaPx = +maxDeltaPx.toFixed(2);
    if (maxDeltaPx > 1) throw new Error(`replay plate moved ${maxDeltaPx.toFixed(2)} px`);
  }
} catch (e) {
  result.error = String(e?.stack ?? e);
} finally {
  result.log = log.slice(-4000);
  await writeFile(path.join(out, `${label}.json`), JSON.stringify(result, null, 1));
  try { await browser?.disconnect(); } catch {}
  child.kill('SIGTERM'); await sleep(1500); try { child.kill('SIGKILL'); } catch {}
  await rm(scratch, { recursive: true, force: true });
}
console.log(JSON.stringify({ label, error: result.error?.slice(0, 300), n: result.times.length }));
