#!/usr/bin/env node
// R-1 L1: six motion strokes (photo, text, HTML; top level and inside a transformed canvas),
// normal drag / resize / rotate / marquee / selection, and preview versus OSR comparison.
// Use --label before|after|before-noguard and --only draw:top-text,draw:nested-text|regression|selection|marquee.
// Use --export with a completed label to compare rendered frames. The caller owns the heavy slot.
// CDP 9575, HTTP 49001; scratch and app profiles use the task-specific /tmp prefix.
import { spawn, spawnSync } from 'node:child_process';
import { closeSync, openSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : fallback; };
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url);
const { evaluatedItemTransform } = require(path.join(repo, 'packages/edit-store/lib/index.js'));
const shellDir = path.join(repo, 'apps/shell');
const outDir = path.join(repo, 'evidence/r1-motion-draw-root');
const label = arg('label', 'before');
const only = (arg('only', '') || '').split(',').map(token => token.trim()).filter(Boolean);
const onlyHas = token => only.length === 0 || only.includes(token);
const port = 9575;
const httpPort = 49001;
const electron = path.join(shellDir, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
const ffmpeg = process.env.FFMPEG ?? 'ffmpeg';
const W = 640, H = 360, FPS = 30;

const scratch = await realpath(await mkdtemp('/tmp/2026-09-26-libcanvas-r1-motion-draw-root-'));
const project = path.join(scratch, 'project');
const editPath = path.join(project, 'edit.json');
const editUri = pathToFileURL(editPath).href;
const clean = v => String(v).replaceAll(repo, '<repo>').replaceAll(scratch, '<scratch>').replace(/\/Users\/[^\s"')]+/g, '<local>')
  .replace(/\/(private\/)?(tmp|var)\/[^\s"')]+/g, '<tmp>');
const readEditText = () => readFile(editPath, 'utf8');
const readEdit = async () => JSON.parse(await readEditText());
const findItem = (edit, id) => {
  const visit = items => { for (const item of items ?? []) { if (item.id === id) return item; const nested = visit(item.items); if (nested) return nested; } };
  for (const track of edit.tracks ?? []) { const found = visit(track.items); if (found) return found; }
};
const round2 = v => Math.round(v * 100) / 100;

// Each item occupies a distinct five-second span. Nested items live at t=0 inside a transformed parent.
const DRAW = [
  { id: 'top-photo', kind: 'photo', color: 'red', nested: false },
  { id: 'top-text', kind: 'text', color: 'green', nested: false },
  { id: 'top-html', kind: 'html', color: 'blue', nested: false },
  { id: 'nested-photo', kind: 'photo', color: 'red', nested: true },
  { id: 'nested-text', kind: 'text', color: 'green', nested: true },
  { id: 'nested-html', kind: 'html', color: 'blue', nested: true }
];
const REGRESSION = [
  { id: 'reg-text', kind: 'text', color: 'green' },
  { id: 'reg-html', kind: 'html', color: 'blue' },
  { id: 'reg-photo', kind: 'photo', color: 'red' },
  { id: 'reg-nested-photo', kind: 'photo', color: 'red', nested: true },
  { id: 'reg-marquee', kind: 'html', color: 'blue' }
];
const COMPARE = DRAW;
const COMPARE_IDS = DRAW.map(entry => entry.id);
const ORDER = [...DRAW.map(entry => entry.id), ...REGRESSION.map(entry => entry.id)];
const atOf = id => ORDER.indexOf(id) * 150;
const frameTime = (id, frame) => (atOf(id) + frame) / FPS;
const itemAt = id => atOf(id);
const TEXT_HTML = '<div style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);color:#00ff00;font:900 200px/1 sans-serif;white-space:nowrap">動き</div>';
const BOX_HTML = '<div style="position:absolute;left:50%;top:50%;width:480px;height:320px;transform:translate(-50%,-50%);background:#0000ff"></div>';
const PARENT = { x: 180, y: -80, scale: 0.8, rotate: 15 };
const itemOf = (entry, nested) => ({ id: entry.id, at: nested ? 0 : itemAt(entry.id), duration: 150,
  source: entry.kind === 'photo' ? { kind: 'media', src: 'photo-src', in: 0, out: 5 }
    : { kind: 'html', path: entry.kind === 'text' ? 'overlays/text.html' : 'overlays/box.html' },
  transform: { x: nested ? -80 : 0, y: nested ? 30 : 0,
    scale: entry.kind === 'photo' ? 0.3 : entry.kind === 'text' ? 0.8 : 0.6, rotate: 0 } });
const fixtureEntry = (entry, index) => ({ id: `v${index}`, lane: 'visual', name: entry.id,
  items: entry.nested ? [{ id: `parent-${entry.id}`, at: itemAt(entry.id), duration: 150,
    source: { kind: 'group' }, transform: PARENT, items: [itemOf(entry, true)] }]
    : [itemOf(entry, false)] });
async function makeFixture() {
  await mkdir(path.join(project, '.akari'), { recursive: true });
  await mkdir(path.join(project, 'assets'), { recursive: true });
  await mkdir(path.join(project, 'overlays'), { recursive: true });
  writeFileSyncChecked(spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi',
    '-i', 'color=c=0xFF0000:s=480x320', '-frames:v', '1', path.join(project, 'assets', 'photo.png')]));
  await writeFile(path.join(project, 'overlays', 'text.html'), TEXT_HTML);
  await writeFile(path.join(project, 'overlays', 'box.html'), BOX_HTML);
  await writeFile(path.join(project, 'captions.json'), '{\n  "captions": []\n}\n');
  await writeFile(path.join(project, '.akari', 'lint.json'), '{"version":1,"verdict":"pass"}\n');
  const edit = { version: 2, output: { width: 1920, height: 1080, fps: FPS },
    sources: [{ id: 'photo-src', path: 'assets/photo.png', proxy: null }],
    tracks: [...DRAW, ...REGRESSION].map(fixtureEntry) };
  await writeFile(editPath, `${JSON.stringify(edit, null, 2)}\n`);
}
function writeFileSyncChecked(result) {
  if (result.status !== 0) throw new Error(`ffmpeg failed: ${result.stderr?.toString().slice(0, 400)}`);
}

// 合成プロジェクトの事前検証（アプリを起動しない。schema と edit-lint だけ通す）
if (process.argv.includes('--fixture-only')) {
  await makeFixture();
  const schema = spawnSync(process.execPath, [path.join(repo, 'packages/schemas/bin/validate-edit.mjs'), editPath],
    { encoding: 'utf8', maxBuffer: 20_000_000, timeout: 120000 });
  const lint = spawnSync(process.execPath, [path.join(repo, 'packages/edit-lint/bin/edit-lint.mjs'), project, '--no-reports', '--json'],
    { encoding: 'utf8', maxBuffer: 20_000_000, timeout: 300000 });
  console.log(JSON.stringify({ schemaExit: schema.status, schema: clean(schema.stdout ?? '').slice(-2000),
    lintExit: lint.status, lint: clean(lint.stdout ?? '').slice(-4000), lintErr: clean(lint.stderr ?? '').slice(-2000) }, null, 2));
  if (!process.argv.includes('--keep')) await rm(scratch, { recursive: true, force: true });
  process.exit(schema.status === 0 && lint.status === 0 ? 0 : 1);
}

// 点の読み出し（keyframes は配列 or motion 袋 {path,count}）
async function pointsOfItem(item) {
  if (!item?.keyframes) return [];
  if (Array.isArray(item.keyframes)) return item.keyframes;
  try {
    const bag = JSON.parse(await readFile(path.join(project, item.keyframes.path), 'utf8'));
    return Array.isArray(bag?.items?.[item.id]) ? bag.items[item.id] : [];
  } catch { return []; }
}
const realPoints = points => points.filter(point => point.transform || point.opacity !== undefined
  || point.crop || point.perspective || point.animator || point.gain_db !== undefined);
const nearestPoint = (points, frame) => {
  const real = points.filter(point => point.transform || point.opacity !== undefined);
  return real.find(point => point.t === frame) ?? real.find(point => Math.abs(point.t - frame) <= 1) ?? null;
};

// ---- export mode（目的 4） -----------------------------------------------------------------
const rgb = (file, seconds, extraInput = []) => {
  const input = seconds === undefined ? ['-i', file] : ['-ss', String(seconds), '-i', file, '-frames:v', '1'];
  const decoded = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', ...extraInput, ...input,
    '-vf', 'scale=640:360:flags=area', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 640 * 360 * 4 });
  if (decoded.status !== 0 || decoded.stdout.length !== 640 * 360 * 3) throw new Error(`frame decode failed: ${file}`);
  return decoded.stdout;
};
// 不透明度が低い画素も拾える色判定。プレビューのスクショは色管理で純色からずれる
// （緑 #00ff00 → 実測 (116,251,76) / 赤 #ff0000 → 実測 (139,30,21)）ため、色相の差で見る。
// 選択枠のオレンジ (255,139,44) とつまみのシアン (53,184,231) は除外する。
const colorMatch = color => color === 'red'
  ? (r, g, b) => r > 40 && r - g > 15 && r - b > 15 && g < r * 0.5
  : color === 'green'
    ? (r, g, b) => g > 40 && g - r > 15 && g - b > 15 && r < g * 0.7
    : (r, g, b) => b > 40 && b - r > 15 && b - g > 15 && g < b * 0.5;
const colorBounds = (buffer, color) => {
  const match = colorMatch(color);
  let minX = W, minY = H, maxX = -1, maxY = -1, count = 0, sum = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const index = (y * W + x) * 3;
    const r = buffer[index], g = buffer[index + 1], b = buffer[index + 2];
    if (!match(r, g, b)) continue;
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y); count++;
    sum += color === 'red' ? r : color === 'green' ? g : b;
  }
  return maxX < 0 ? null : { x: (minX + maxX) / 2, y: (minY + maxY) / 2, count, mean: round2(sum / count),
    box: { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 } };
};
const decodePngBuffer = buffer => {
  const decoded = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-i', 'pipe:0',
    '-vf', 'scale=640:360:flags=area', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { input: buffer, maxBuffer: 640 * 360 * 4 });
  if (decoded.status !== 0 || decoded.stdout.length !== 640 * 360 * 3) throw new Error('stage png decode failed');
  return decoded.stdout;
};
if (process.argv.includes('--export')) {
  await mkdir(outDir, { recursive: true });
  let mainReport;
  try { mainReport = JSON.parse(await readFile(path.join(outDir, `${label}.json`), 'utf8')); } catch {
    console.error(`先に --label ${label} でアプリを回して ${label}.json を作ってください。`);
    await rm(scratch, { recursive: true, force: true });
    process.exit(2);
  }
  const framesByItem = mainReport?.results?.compare ?? {};
  const bagFile = path.join(outDir, `${label}-final-motion-bags.json`);
  let bags = {};
  try { bags = JSON.parse(await readFile(bagFile, 'utf8')); } catch { bags = {}; }
  await makeFixture();
  const saved = JSON.parse(await readFile(path.join(outDir, `${label}-final-edit.json`), 'utf8'));
  saved.tracks = (saved.tracks ?? []).filter(track => (track.items ?? []).some(item => COMPARE_IDS.includes(item.id) || item.items?.some(child => COMPARE_IDS.includes(child.id))));
  await writeFile(editPath, `${JSON.stringify(saved, null, 2)}\n`);
  for (const [relative, content] of Object.entries(bags)) {
    const target = path.join(project, relative);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content);
  }
  const home = path.join(scratch, 'akari-home');
  await mkdir(home, { recursive: true });
  await mkdir(path.join(project, 'exports'), { recursive: true });
  const mp4 = path.join(project, 'exports', 'r1-osr.mp4');
  const command = spawnSync(process.execPath, [path.join(repo, 'packages/render-cut/bin/render-cut.mjs'), project,
    '--out', mp4, '--engine', 'osr', '--scale-to', '640x360', '--preview', 'off', '--no-verify-blank', '--force'],
  { cwd: repo, env: { ...process.env, AKARI_HOME: home, AKARI_OSR_ELECTRON: '',
    THEIA_CONFIG_DIR: path.join(scratch, 'config') }, encoding: 'utf8', maxBuffer: 20_000_000, timeout: 1_800_000 });
  const report = { label, commandExit: command.status, stdout: clean(command.stdout ?? '').slice(-5000),
    stderr: clean(command.stderr ?? '').slice(-5000), items: [] };
  if (command.status === 0) for (const { id, color } of COMPARE) {
    const frames = framesByItem[id];
    if (!Array.isArray(frames) || !frames.length) continue;
    const rows = [];
    for (const frame of frames) {
      const outputFrame = atOf(id) + frame;
      const previewName = `${label}-preview-${id}-${frame}.png`;
      try {
        const preview = colorBounds(rgb(path.join(outDir, previewName)), color);
        const rendered = colorBounds(rgb(mp4, outputFrame / FPS), color);
        rows.push({ frame, outputFrame, preview, rendered,
          delta: preview && rendered ? { x: round2(rendered.x - preview.x), y: round2(rendered.y - preview.y) } : null });
        spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-ss', String(outputFrame / FPS),
          '-i', mp4, '-frames:v', '1', path.join(outDir, `${label}-osr-${id}-${frame}.png`)]);
      } catch (error) { rows.push({ frame, outputFrame, error: clean(error?.message ?? error) }); }
    }
    report.items.push({ id, color, frames: rows });
  }
  const deltas = report.items.flatMap(item => item.frames.map(row => row.delta)).filter(Boolean);
  report.maxAbsDeltaPx = deltas.length ? Math.max(...deltas.flatMap(delta => [Math.abs(delta.x), Math.abs(delta.y)])) : null;
  await writeFile(path.join(outDir, `${label}-export.json`), `${JSON.stringify(report, null, 2)}\n`);
  mainReport.export = { commandExit: command.status, maxAbsDeltaPx: report.maxAbsDeltaPx,
    within2px: command.status === 0 && report.maxAbsDeltaPx !== null && report.maxAbsDeltaPx <= 2,
    items: report.items.map(item => ({ id: item.id, comparedFrames: item.frames.filter(row => row.delta).length,
      maxAbsDeltaPx: Math.max(0, ...item.frames.flatMap(row => row.delta
        ? [Math.abs(row.delta.x), Math.abs(row.delta.y)] : [])) })) };
  await writeFile(path.join(outDir, `${label}.json`), `${JSON.stringify(mainReport, null, 2)}\n`);
  await rm(scratch, { recursive: true, force: true });
  console.log(JSON.stringify({ label, exportExit: command.status, maxAbsDeltaPx: report.maxAbsDeltaPx,
    items: report.items.length }));
  process.exit(command.status === 0 ? 0 : 1);
}

// ---- CDP ----------------------------------------------------------------------------------
class CDP {
  constructor(url) { this.url = url; this.id = 0; this.pending = new Map(); this.listeners = new Map(); }
  async connect() {
    this.socket = new WebSocket(this.url);
    await new Promise((res, rej) => { this.socket.addEventListener('open', res, { once: true }); this.socket.addEventListener('error', rej, { once: true }); });
    this.socket.addEventListener('message', event => {
      const m = JSON.parse(event.data);
      if (m.id && this.pending.has(m.id)) { const p = this.pending.get(m.id); this.pending.delete(m.id); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result); }
      else if (m.method) for (const l of this.listeners.get(m.method) ?? []) l(m.params, m.sessionId);
    });
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { if (this.pending.delete(id)) reject(new Error(`CDP ${method} timed out`)); }, 60000);
      this.pending.set(id, { resolve: v => { clearTimeout(timer); resolve(v); }, reject: e => { clearTimeout(timer); reject(e); } });
      this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }
  on(method, fn) { this.listeners.set(method, [...(this.listeners.get(method) ?? []), fn]); }
  close() { this.socket?.close(); }
}
async function evaluate(cdp, expression, contextId, sessionId) {
  const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, ...(contextId === undefined ? {} : { contextId }) }, sessionId);
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 800));
  return r.result.value;
}
async function waitForJson(url, pred, ms = 120000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { try { const v = await (await fetch(url)).json(); if (pred(v)) return v; } catch {} await sleep(300); }
  throw new Error(`timeout ${url}`);
}
const contexts = new Map();
const consoleErrors = [];
// プレビューの実行コンテキストが消えた事実（回数・直前の操作）と、webview ターゲットの増減
const contextLosses = [];
const targetEvents = [];
let currentStep = 'startup';
// webview は書き込みのたびに setHTML で作り直される。新しい文書にもフックを仕込む。
const WRITE_ERROR_HOOK = `(() => {
    if (window.__r1WriteErrors) return true;
    window.__r1WriteErrors = [];
    const record = text => {
      window.__r1WriteErrors.push(text);
      try { sessionStorage.setItem('r1WriteErrors', JSON.stringify(window.__r1WriteErrors.slice(-20))); } catch {}
    };
    window.addEventListener('message', event => {
      const m = event.data;
      if (m && typeof m.type === 'string' && /-write(-batch)?-response$/.test(m.type) && m.ok === false) {
        record(m.type + ': ' + String(m.error));
      }
    }, true);
    const originalError = console.error.bind(console);
    console.error = (...args) => {
      record(args.map(a => {
        if (typeof a === 'string') return a;
        try { return JSON.stringify(a, Object.getOwnPropertyNames(a ?? {})) ?? String(a); } catch { return String(a); }
      }).join(' '));
      originalError(...args);
    };
    return true; })();`;
function track(cdp) {
  cdp.on('Runtime.executionContextCreated', (p, s) => { if (!p?.context?.auxData?.isDefault) return; contexts.set(s, [...(contexts.get(s) ?? []), p.context.id]); });
  cdp.on('Runtime.executionContextsCleared', (_p, s) => contexts.delete(s));
  cdp.on('Runtime.exceptionThrown', p => consoleErrors.push(String(p.exceptionDetails?.exception?.description ?? p.exceptionDetails?.text ?? '').slice(0, 400)));
  cdp.on('Runtime.consoleAPICalled', p => { if (p.type === 'error') consoleErrors.push(p.args.map(a => {
    if (a.value !== undefined) return typeof a.value === 'string' ? a.value : JSON.stringify(a.value).slice(0, 300);
    if (a.preview) return JSON.stringify(a.preview).slice(0, 300);
    return a.description ?? a.unserializableValue ?? '';
  }).join(' ').slice(0, 700)); });
}
let main, browser, view, child;
let electronLogFd;
let electronLog;
const targetUrls = new Map();
const HEALTH_EXPR = `(() => { const banner = document.getElementById('reload-error-card');
    const write = document.getElementById('write-error-banner');
    const composite = document.getElementById('composite-error-banner');
    return { reloadError: banner && !banner.hidden ? String(banner.innerText).slice(0, 200) : null,
      writeError: write && !write.hidden ? String(write.innerText).slice(0, 200) : null,
      compositeError: composite && !composite.hidden ? String(composite.innerText).slice(0, 200) : null,
      hasSummary: Boolean(window.akari?.state?.summary), ready: document.readyState }; })()`;
function trackTargets(cdp) {
  const stamp = () => new Date().toISOString();
  const urlOf = p => String(p?.targetInfo?.url ?? '');
  cdp.on('Target.targetCreated', p => {
    const url = urlOf(p);
    if (p?.targetInfo?.targetId) targetUrls.set(p.targetInfo.targetId, url);
    if (url.includes('webview')) targetEvents.push({ event: 'created', url: url.slice(0, 80), targetId: p?.targetInfo?.targetId, at: stamp() });
  });
  cdp.on('Target.targetDestroyed', p => targetEvents.push({ event: 'destroyed', targetId: p?.targetId,
    url: String(targetUrls.get(p?.targetId) ?? '').slice(0, 80), at: stamp() }));
  cdp.on('Target.targetInfoChanged', p => {
    const url = urlOf(p);
    if (p?.targetInfo?.targetId) targetUrls.set(p.targetInfo.targetId, url);
    if (url.includes('webview')) targetEvents.push({ event: 'changed', targetId: p?.targetInfo?.targetId, url: url.slice(0, 80), at: stamp() });
  });
  cdp.on('Inspector.targetCrashed', p => targetEvents.push({ event: 'crashed', targetId: p?.targetId, at: stamp() }));
}
async function findPreview(ms = 20000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const all = await browser.send('Target.getTargets').catch(() => undefined);
    for (const info of all?.targetInfos ?? []) {
      if (!['iframe', 'page', 'webview'].includes(info.type) || !String(info.url ?? '').includes('webview')) continue;
      try {
        const { sessionId } = await browser.send('Target.attachToTarget', { targetId: info.targetId, flatten: true });
        contexts.delete(sessionId);
        await browser.send('Page.enable', {}, sessionId).catch(() => {}); await browser.send('Runtime.enable', {}, sessionId).catch(() => {});
        await browser.send('Inspector.enable', {}, sessionId).catch(() => {});
        await browser.send('Page.addScriptToEvaluateOnNewDocument', { source: WRITE_ERROR_HOOK }, sessionId).catch(() => {});
        await sleep(300);
        for (const contextId of contexts.get(sessionId) ?? []) {
          try { if (await evaluate(browser, `Boolean(document.getElementById('preview-stage') && document.getElementById('seek'))`, contextId, sessionId)) return { sessionId, contextId }; } catch {}
        }
      } catch {}
    }
    await sleep(500);
  }
  return undefined;
}
// プレビューが作り直されて実行コンテキストが消えたら、見つけ直して 1 回だけやり直す。
// 消えた事実は contextLosses に残す（製品の回帰を隠さない）。
const pv = async expr => {
  let last;
  for (let attempt = 0; attempt < 4; attempt++) {
    try { return await evaluate(browser, expr, view.contextId, view.sessionId); }
    catch (error) {
      last = error;
      const message = String(error?.message ?? error);
      if (!/Cannot find context|Session with given id not found/i.test(message)) throw error;
      contextLosses.push({ at: new Date().toISOString(), step: currentStep, message: message.slice(0, 200) });
      const found = await findPreview(20000).catch(() => undefined);
      if (!found) continue;
      view = found;
      contextLosses.at(-1).health = await evaluate(browser, HEALTH_EXPR,
        found.contextId, found.sessionId).catch(() => null);
    }
  }
  throw last;
};
async function command(id, value) {
  return evaluate(main, `(async () => { try {
    const d = window.theia?.container?._bindingDictionary; const keys = d?._map ? [...d._map.keys()] : [];
    const C = keys.find(k => typeof k === 'function' && k.prototype && typeof k.prototype.executeCommand === 'function' && typeof k.prototype.registerCommand === 'function');
    if (!C) return { ok: false, error: 'no registry' };
    const v = await window.theia.container.get(C).executeCommand(${JSON.stringify(id)}, ${JSON.stringify(value)});
    let plain = null; try { plain = v === undefined ? null : JSON.parse(JSON.stringify(v)); } catch { plain = typeof v; }
    return { ok: true, value: plain };
  } catch (e) { return { ok: false, error: e?.message ?? String(e) }; } })()`);
}
async function seek(seconds) {
  for (let i = 0; i < 4; i++) {
    await command('akari.preview.seekOutput', { editUri, time: seconds });
    await sleep(900);
    const actual = await pv(`Number(document.getElementById('seek')?.value)`).catch(() => NaN);
    if (Math.abs(actual - seconds) < 0.04) { await sleep(600); return actual; }
  }
  return pv(`Number(document.getElementById('seek')?.value)`);
}
const seekItem = async (id, frame) => {
  const actual = await seek(frameTime(id, frame));
  return { actual, actualFrame: Number.isFinite(actual) ? Math.round(actual * FPS) - atOf(id) : null };
};
async function stageRect() {
  const inner = await pv(`(() => { const r = document.getElementById('preview-stage').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`);
  const host = await evaluate(main, `(() => { const f = [...document.querySelectorAll('iframe')].filter(f => /webview/.test(f.src || '')).map(f => f.getBoundingClientRect()).filter(r => r.width > 100 && r.height > 100).sort((a, b) => b.width * b.height - a.width * a.height)[0]; return f ? { x: f.x, y: f.y, w: f.width, h: f.height } : null; })()`);
  return { x: host.x + inner.x, y: host.y + inner.y, w: inner.w, h: inner.h, hostX: host.x, hostY: host.y };
}
async function stagePng() {
  const rect = await stageRect();
  const dpr = await evaluate(main, 'window.devicePixelRatio');
  const { data } = await main.send('Page.captureScreenshot', { format: 'png', clip: { x: rect.x, y: rect.y, width: rect.w, height: rect.h, scale: W / rect.w / dpr } });
  return { buffer: Buffer.from(data, 'base64'), rect };
}
async function stageShot(name) {
  const { buffer } = await stagePng();
  const file = path.join(outDir, `${label}-${name}.png`);
  await writeFile(file, buffer);
  return file;
}
// 色（赤 = 写真 / 緑 = テキスト / 青 = HTML）の外接箱で見えている位置・大きさを測る。
// DOM の箱は overlay の全画面の器を測ってしまうため使わない（BEFORE の実測で 1920x1080 になった）。
async function colorVisible(id, color) {
  if (!color) return null;
  const { buffer, rect } = await stagePng();
  const bounds = colorBounds(decodePngBuffer(buffer), color);
  if (!bounds) return null;
  return { output: { x: round2(bounds.x * 3 - 960), y: round2(bounds.y * 3 - 540) },
    size: { w: round2(bounds.box.w * 3), h: round2(bounds.box.h * 3) },
    page: { x: rect.x + bounds.x * rect.w / W, y: rect.y + bounds.y * rect.h / H },
    count: bounds.count, mean: bounds.mean };
}
const itemColor = id => [...DRAW, ...REGRESSION].find(entry => entry.id === id)?.color;
// プレビューが書き込み後に作り直されている間は色が消えるので、出るまで待つ
async function waitColorBox(id, color, ms = 15000) {
  const end = Date.now() + ms;
  let last = null;
  while (Date.now() < end) {
    try { last = await colorVisible(id, color); } catch { last = null; }
    if (last && last.count > 30) return last;
    await sleep(400);
  }
  try { await stageShot(`missing-${id}`); } catch { /* keep going */ }
  return last;
}
// プレビューは書き込みごとに作り直されるので、書き込みの直前にもフックを張り直す
async function installWriteHook() {
  return pv(`(() => {
    const record = text => {
      (window.__r1WriteErrors ??= []).push(text);
      try { sessionStorage.setItem('r1WriteErrors', JSON.stringify(window.__r1WriteErrors.slice(-20))); } catch {}
    };
    if (!window.__r1ConsoleWrapped) {
      window.__r1ConsoleWrapped = true;
      const originalError = console.error.bind(console);
      console.error = (...args) => {
        record('console.error: ' + args.map(a => {
          if (typeof a === 'string') return a;
          try { return JSON.stringify(a, Object.getOwnPropertyNames(a ?? {})) ?? String(a); } catch { return String(a); }
        }).join(' '));
        originalError(...args);
      };
    }
    const engine = window.akari?.engine;
    if (!engine || engine.__r1Wrapped) return false;
    engine.__r1Wrapped = true;
    for (const name of ['overlayWrite', 'layerWrite', 'cutWrite']) {
      const original = engine[name]?.bind(engine);
      if (!original) continue;
      engine[name] = (...args) => original(...args).catch(error => {
        let detail = '';
        try { detail = JSON.stringify(error, Object.getOwnPropertyNames(error ?? {})); } catch { detail = String(error); }
        record(name + ': ' + String(error?.message ?? error) + ' | ' + detail);
        throw error;
      });
    }
    return true; })()`).catch(() => false);
}
async function previewDiagnostic(id) {
  try {
    const dom = await pv(`(() => {
      const el = document.querySelector('[data-akari-layer-id="${id}"], [data-overlay-id="${id}"]');
      const stage = document.getElementById('preview-stage');
      const r = el ? el.getBoundingClientRect() : null;
      const cs = el ? getComputedStyle(el) : null;
      const frame = document.querySelector('[data-akari-interaction="selection-frame"]');
      return { seek: Number(document.getElementById('seek')?.value || 0), engine: stage?.dataset.frameEngineActive ?? null,
        el: el ? { tag: el.tagName, cls: String(el.className).slice(0, 60), rect: r ? { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } : null,
          display: cs.display, visibility: cs.visibility, opacity: cs.opacity } : null,
        frame: frame ? { hidden: frame.hidden, w: Math.round(frame.getBoundingClientRect().width) } : null,
        overlays: [...document.querySelectorAll('[data-overlay-id]')].map(o => o.getAttribute('data-overlay-id')).slice(0, 20),
        layers: [...document.querySelectorAll('[data-akari-layer-id]')].map(o => o.getAttribute('data-akari-layer-id')).slice(0, 20) }; })()`);
    const rect = await stageRect();
    return { ...dom, rect };
  } catch (error) { return { error: clean(error?.message ?? error) }; }
}
async function mouse(type, pt, buttons = 0, modifiers = 0) {
  await main.send('Input.dispatchMouseEvent', { type, x: pt.x, y: pt.y, button: type === 'mouseMoved' && !buttons ? 'none' : 'left', buttons,
    modifiers, clickCount: type === 'mouseMoved' ? 0 : 1 });
}
async function key(keyName, code, vk, modifiers = 0, commands) {
  await main.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: keyName, code, windowsVirtualKeyCode: vk, modifiers, ...(commands ? { commands } : {}) });
  await main.send('Input.dispatchKeyEvent', { type: 'keyUp', key: keyName, code, windowsVirtualKeyCode: vk, modifiers });
}
// 見えている位置（出力の中心原点の px）・大きさ・不透明度（computed opacity の積）
async function visible(id) {
  const inner = await pv(`(() => {
    const el = document.querySelector('[data-akari-layer-id="${id}"], [data-overlay-id="${id}"]');
    const stage = document.getElementById('preview-stage');
    if (!el || !stage) return null;
    const painted = el.matches('img, video') ? el : el.querySelector('img, video, svg');
    let target = painted && painted.getBoundingClientRect().width > 2 ? painted : el;
    let r = target.getBoundingClientRect();
    if (!(r.width > 1) || !(r.height > 1)) {
      const fallback = document.querySelector('#layer-select-box.is-active')
        || [...document.querySelectorAll('[data-akari-interaction="selection-frame"]')].find(e => !e.hidden);
      if (!fallback) return null;
      target = fallback; r = fallback.getBoundingClientRect();
    }
    const s = stage.getBoundingClientRect();
    if (!(r.width > 1) || !(r.height > 1)) return null;
    let opacity = 1; for (let n = target; n && n !== stage; n = n.parentElement) opacity *= Number(getComputedStyle(n).opacity);
    return { x: r.x - s.x + r.width / 2, y: r.y - s.y + r.height / 2, w: r.width, h: r.height, stageW: s.width, stageH: s.height, opacity };
  })()`);
  if (!inner) return null;
  const stage = await stageRect();
  const k = 1920 / inner.stageW;
  return { output: { x: round2(inner.x * k - 960), y: round2(inner.y * 1080 / inner.stageH - 540) },
    size: { w: round2(inner.w * k), h: round2(inner.h * 1080 / inner.stageH) }, opacity: round2(inner.opacity),
    page: { x: stage.x + inner.x, y: stage.y + inner.y } };
}
async function historyCount() {
  try { return (await readdir(path.join(project, '.akari', 'history'))).length; } catch { return 0; }
}
async function historyLabels() {
  try {
    const names = await readdir(path.join(project, '.akari', 'history'));
    const labels = [];
    for (const name of names.slice(-80)) {
      try {
        const entry = JSON.parse(await readFile(path.join(project, '.akari', 'history', name), 'utf8'));
        labels.push(String(entry?.label ?? name));
      } catch { labels.push(name); }
    }
    return labels.slice(-12);
  } catch { return []; }
}
// 1 回の操作: 書き込み回数（履歴の増分）・その時刻の点・点が x と y を両方持つか・戻らない・undo 1 回・redo
async function operation(id, name, frame, act) {
  currentStep = name;
  const color = itemColor(id);
  const seeked = await seekItem(id, frame);
  const beforeText = await readEditText();
  const beforeHistory = await historyCount();
  const beforeVisible = await waitColorBox(id, color);
  await installWriteHook();
  let detail, actError = null;
  try { detail = await act({ beforeVisible, beforeItem: findItem(JSON.parse(beforeText), id) }); }
  catch (error) { actError = clean(error?.message ?? error); detail = { error: actError }; }
  const actFailed = Boolean(actError) || detail?.result?.value?.ok === false || detail?.result?.ok === false;
  let afterText = beforeText;
  for (let n = 0; n < (actFailed ? 3 : 50) && afterText === beforeText; n++) { await sleep(200); afterText = await readEditText(); }
  await sleep(1200);
  afterText = await readEditText();
  const writes = (await historyCount()) - beforeHistory;
  const afterVisible = await waitColorBox(id, color);
  await stageShot(`${name}-after`);
  // 戻らない: 別の時刻へ行って戻っても見えている値が変わらない
  await seekItem(id, 0); await seekItem(id, frame);
  const reseekVisible = await waitColorBox(id, color);
  const afterItem = findItem(JSON.parse(afterText), id);
  const beforeItem = findItem(JSON.parse(beforeText), id);
  const points = await pointsOfItem(afterItem);
  const seat = nearestPoint(points, frame);
  const visibleDelta = beforeVisible && afterVisible ? {
    dx: round2(afterVisible.output.x - beforeVisible.output.x), dy: round2(afterVisible.output.y - beforeVisible.output.y),
    dw: round2(afterVisible.size.w - beforeVisible.size.w), dh: round2(afterVisible.size.h - beforeVisible.size.h)
  } : null;
  const expected = detail?.expectedDelta ?? null;
  // スナップ（8px 吸着）と、回転後の字形の外接箱オフセットがあるので 12px まで許す
  const visibleMovedAsExpected = !expected || !visibleDelta ? null
    : Math.abs(visibleDelta.dx - (expected.x ?? 0)) <= 12 && Math.abs(visibleDelta.dy - (expected.y ?? 0)) <= 12;
  const noWrite = writes === 0 && afterText === beforeText;
  let undoRestored = null, redoRestored = null, undoneText = afterText, redoText = afterText;
  if (!noWrite) {
    await evaluate(main, `(() => { document.activeElement?.blur?.(); return true; })()`);
    await key('z', 'KeyZ', 90, 4, ['undo']);
    for (let n = 0; n < 40 && await readEditText() === afterText; n++) await sleep(200);
    await sleep(600);
    undoneText = await readEditText();
    undoRestored = JSON.stringify(JSON.parse(undoneText)) === JSON.stringify(JSON.parse(beforeText));
    await key('z', 'KeyZ', 90, 12, ['redo']);
    for (let n = 0; n < 40 && await readEditText() === undoneText; n++) await sleep(200);
    await sleep(600);
    redoText = await readEditText();
    redoRestored = JSON.stringify(JSON.parse(redoText)) === JSON.stringify(JSON.parse(afterText));
    if (!redoRestored) { await writeFile(editPath, afterText); await sleep(2500); }
  }
  const real = realPoints(points);
  const last = real[real.length - 1] ?? null;
  return { name, frame, seeked, detail, actError, writes, noWrite, beforeVisible, afterVisible, reseekVisible, visibleDelta,
    visibleMovedAsExpected, expectedDelta: expected,
    noRevert: afterVisible && reseekVisible
      ? Math.hypot(afterVisible.output.x - reseekVisible.output.x, afterVisible.output.y - reseekVisible.output.y) <= 1.5
        && Math.abs(afterVisible.size.w - reseekVisible.size.w) <= 1.5 && Math.abs(afterVisible.size.h - reseekVisible.size.h) <= 1.5
      : null,
    pointCreated: Boolean(seat), pointAtFrame: seat, pointHasX: seat?.transform ? Number.isFinite(seat.transform.x) : null,
    pointHasY: seat?.transform ? Number.isFinite(seat.transform.y) : null,
    pointTimes: real.map(point => point.t), lastPoint: last,
    staticBefore: beforeItem?.transform ?? null, staticAfter: afterItem?.transform ?? null,
    evaluatedAtFrame: afterItem ? evaluatedItemTransform(afterItem, frame) : null,
    undoRestored, redoRestored };
}
async function focusItem(id) {
  await command('akari.timeline.focusItem', { itemId: id, reveal: true });
  await sleep(500);
  await evaluate(main, `(() => { document.querySelector('[data-akari-ui="tab:inspector-video"]')?.click(); return true; })()`);
  await sleep(500);
}
async function pressSeat(id, frame, field) {
  await seekItem(id, frame);
  await focusItem(id);
  const beforeHistory = await historyCount();
  const beforeText = await readEditText();
  const pressed = await evaluate(main, `(() => { const b = document.querySelector('[data-akari-ui="inspector-kf-seat:${field}"]');
    if (!b) return { found: false, seats: [...document.querySelectorAll('[data-akari-ui^="inspector-kf-seat:"]')].map(e => e.getAttribute('data-akari-ui')) };
    const old = b.getAttribute('aria-pressed'); b.click(); return { found: true, old, title: b.title }; })()`);
  for (let n = 0; n < 40 && await readEditText() === beforeText; n++) await sleep(200);
  await sleep(900);
  const after = await evaluate(main, `(() => { const b = document.querySelector('[data-akari-ui="inspector-kf-seat:${field}"]');
    return b ? { pressed: b.getAttribute('aria-pressed'), title: b.title } : null; })()`);
  const item = findItem(await readEdit(), id);
  return { pressed, after, writes: (await historyCount()) - beforeHistory, item,
    points: (await pointsOfItem(item)).filter(point => point.transform || point.opacity !== undefined) };
}
async function handleCenter(selector) {
  const rect = await stageRect();
  // つまみの中心がステージの外（下）に出ていることがあるので、elementFromPoint で
  // 実際に押せる点（つまみ自身が最前面）を探す
  const found = await pv(`(() => { const s = document.getElementById('preview-stage').getBoundingClientRect();
    const candidates = [...document.querySelectorAll(${JSON.stringify(selector)})]
      .filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).display !== 'none'; });
    for (const e of candidates) {
      const r = e.getBoundingClientRect();
      for (const [fx, fy] of [[0.5, 0.5], [0.5, 0.25], [0.25, 0.5], [0.5, 0.75], [0.75, 0.5], [0.5, 0.1], [0.5, 0.9]]) {
        const x = r.x + r.width * fx, y = r.y + r.height * fy;
        const hit = document.elementFromPoint(x, y);
        if (hit && (hit === e || e.contains(hit))) return { x: x - s.x, y: y - s.y, fx, fy };
      }
    }
    return null; })()`);
  return found ? { x: rect.x + found.x, y: rect.y + found.y, sample: { fx: found.fx, fy: found.fy } } : null;
}
async function drag(start, target, steps = 12) {
  await mouse('mouseMoved', start); await sleep(100); await mouse('mousePressed', start, 1); await sleep(120);
  for (let n = 1; n <= steps; n++) {
    await mouse('mouseMoved', typeof target === 'function' ? target(n / steps)
      : { x: start.x + (target.x - start.x) * n / steps, y: start.y + (target.y - start.y) * n / steps }, 1);
    await sleep(35);
  }
  const end = typeof target === 'function' ? target(1) : target;
  await mouse('mouseReleased', end); await sleep(120);
  await mouse('mouseMoved', { x: end.x + 3, y: end.y + 3 });
}
// 選択の状態（cut / layer の箱 / overlay の選択 / interaction の選択枠とつまみ）
async function selectionState(id) {
  return pv(`(() => {
    const box = document.querySelector('#layer-select-box.is-active');
    const cutBox = document.querySelector('#cut-select-box.is-active');
    const host = document.querySelector('[data-akari-layer-id="${id}"]');
    const rectOf = el => { const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: Math.round(r.width) }; };
    const layer = box ? rectOf(box) : null;
    const cut = cutBox ? rectOf(cutBox) : null;
    const overlay = document.querySelector('[data-overlay-id="${id}"][data-akari-interaction-selected="true"]');
    const frame = document.querySelector('[data-akari-interaction="selection-frame"]');
    const handles = [...document.querySelectorAll('[data-akari-interaction="selection-handle"]')].map(e => {
      const r = e.getBoundingClientRect();
      return { cls: String(e.className).slice(0, 48), w: Math.round(r.width * 100) / 100, h: Math.round(r.height * 100) / 100, display: getComputedStyle(e).display };
    });
    return { layer, cut, layerHostPresent: Boolean(host), overlay: !!overlay,
      frame: frame ? { hidden: frame.hidden, connected: frame.isConnected, w: Math.round(frame.getBoundingClientRect().width * 100) / 100 } : null,
      selectedId: window.akari.interaction?.selectedId ?? null, handles: handles.slice(0, 14) }; })()`);
}
// 色の箱の中心を押して選択する（overlay）。写真（media layer）は素のクリックだと pointerup の
// blank-click で選択が外れるので、タイムラインの選択（akari-preview-select-layer）を使う。
async function selectOnStage(id, color) {
  const info = await pv(`(() => { const s = window.akari.state?.summary; const has = (list, key) =>
    (list || []).some(entry => entry && entry[key] === ${JSON.stringify(id)});
    return { layer: has(s?.layers, 'id'), cut: has(s?.cuts, 'id'), tree: has(s?.tree, 'id'), overlay: has(s?.overlays, 'id') }; })()`).catch(() => null);
  const isVisual = info && (info.layer || info.cut || info.tree);
  if (isVisual) {
    await focusItem(id);
    await sleep(500);
    let state = await selectionState(id);
    let via = (state.layer || state.cut) ? 'timeline' : null;
    if (!state.layer && !state.cut) {
      // タイムライン選択がプレビューへ届かないときは、アプリ自身のイベントを直接発火する
      const dispatch = info.cut
        ? `window.dispatchEvent(new CustomEvent('akari.timeline.primarySelected', { detail: { editUri: ${JSON.stringify(editUri)},
            selection: { kind: 'cut', id: ${JSON.stringify(id)} } } }))`
        : `window.dispatchEvent(new CustomEvent('akari.timeline.layerSelected', { detail: { editUri: ${JSON.stringify(editUri)},
            layerId: ${JSON.stringify(id)} } }))`;
      await evaluate(main, `(() => { ${dispatch}; return true; })()`);
      await sleep(700);
      state = await selectionState(id);
      via = (state.layer || state.cut) ? 'event' : 'none';
    }
    return { selected: Boolean(state.layer || state.cut), state, via, info, box: await waitColorBox(id, color, 6000) };
  }
  const box = await waitColorBox(id, color);
  if (!box) return { selected: false, reason: 'color box not found', diagnostic: await previewDiagnostic(id) };
  await mouse('mouseMoved', box.page); await mouse('mousePressed', box.page, 1); await sleep(60); await mouse('mouseReleased', box.page);
  await sleep(560);
  const state = await selectionState(id);
  return { selected: Boolean(state.overlay || (state.frame && !state.frame.hidden && state.frame.connected)), state, box };
}
async function dragBody(id, color, dx, dy) {
  const box = await waitColorBox(id, color);
  if (!box) return { error: `color box ${id} missing`, diagnostic: await previewDiagnostic(id) };
  const rect = await stageRect();
  const start = box.page;
  const target = { x: start.x + dx * rect.w / 1920, y: start.y + dy * rect.h / 1080 };
  await drag(start, target);
  return { start, target };
}
async function hitChainAt(page) {
  const rect = await stageRect();
  const x = page.x - rect.hostX, y = page.y - rect.hostY;
  return pv(`(() => { const el = document.elementFromPoint(${x}, ${y}); const chain = [];
    for (let n = el; n && chain.length < 6; n = n.parentElement) chain.push(n.tagName + (n.id ? '#' + n.id : '') + '.' + String(n.className).slice(0, 40));
    return chain; })()`).catch(() => null);
}
async function bar(request) { return command('akari.contextBar.run', { editUri, ...request }); }

const SE_HANDLE = '#layer-select-box.is-active .akari-layer-handle-se, #cut-select-box.is-active .akari-cut-handle-se, .akari-interaction-handle.is-se';
const ROTATE_HANDLE = '#layer-select-box.is-active .akari-layer-handle-rotate, #cut-select-box.is-active .akari-cut-handle-rotate, .akari-interaction-action.is-rotate';

// Normal interaction regressions run on separate fixture items.
async function regression(name, id, frame, act) {
  const result = await operation(id, `reg-${name}`, frame, act);
  const moved = result.staticBefore && result.staticAfter
    ? Math.hypot((result.staticAfter.x ?? 0) - (result.staticBefore.x ?? 0),
      (result.staticAfter.y ?? 0) - (result.staticBefore.y ?? 0)) > 10
    : false;
  const resized = result.afterVisible && result.beforeVisible
    ? Math.abs(result.afterVisible.size.w - result.beforeVisible.size.w) > 10 : false;
  const rotated = result.staticBefore && result.staticAfter
    ? Math.abs((result.staticAfter.rotate ?? 0) - (result.staticBefore.rotate ?? 0)) > 5 : false;
  const effect = name.endsWith('-drag') ? moved : name.endsWith('-resize') || name.endsWith('-handle') ? resized : rotated;
  return { ...result, passed: result.writes === 1 && result.undoRestored === true
    && result.redoRestored === true && effect, effect };
}
async function runRegression() {
  const cases = {};
  for (const kind of ['text', 'html']) {
    const id = `reg-${kind}`, color = itemColor(id);
    cases[`${kind}-drag`] = await regression(`${kind}-drag`, id, 20, async () => {
      const select = await selectOnStage(id, color);
      return { select, drag: await dragBody(id, color, 120, 70), expectedDelta: { x: 120, y: 70 } };
    });
    cases[`${kind}-resize`] = await regression(`${kind}-resize`, id, 45, async () => {
      const select = await selectOnStage(id, color); const handle = await handleCenter(SE_HANDLE);
      if (!handle) throw new Error('resize handle missing');
      const rect = await stageRect(); await drag(handle, { x: handle.x + 80 * rect.w / 1920, y: handle.y + 80 * rect.h / 1080 });
      return { select, handle: 'se' };
    });
    cases[`${kind}-rotate`] = await regression(`${kind}-rotate`, id, 70, async () => {
      const select = await selectOnStage(id, color); const box = await waitColorBox(id, color);
      const handle = await handleCenter(ROTATE_HANDLE); if (!handle || !box) throw new Error('rotate handle missing');
      const radius = Math.hypot(handle.x - box.page.x, handle.y - box.page.y);
      const angle = Math.atan2(handle.y - box.page.y, handle.x - box.page.x);
      await drag(handle, u => ({ x: box.page.x + radius * Math.cos(angle - u * Math.PI / 6),
        y: box.page.y + radius * Math.sin(angle - u * Math.PI / 6) }), 16);
      return { select, handle: 'rotate' };
    });
  }
  cases['photo-drag'] = await regression('photo-drag', 'reg-photo', 20, async () => {
    const select = await selectOnStage('reg-photo', 'red');
    const handle = await handleCenter('#cut-select-box.is-active .akari-cut-handle-move');
    if (!handle) throw new Error('cut move handle missing');
    const rect = await stageRect();
    await drag(handle, { x: handle.x + 120 * rect.w / 1920, y: handle.y + 70 * rect.h / 1080 });
    return { select, handle: 'move', expectedDelta: { x: 120, y: 70 } };
  });
  cases['nested-photo-handle'] = await regression('nested-photo-handle', 'reg-nested-photo', 45, async () => {
    const select = await selectOnStage('reg-nested-photo', 'red');
    const handle = await handleCenter(SE_HANDLE); if (!handle) throw new Error('nested photo handle missing');
    const rect = await stageRect(); await drag(handle, { x: handle.x + 80 * rect.w / 1920, y: handle.y + 80 * rect.h / 1080 });
    return { select, handle: 'se' };
  });
  return cases;
}
async function motionDraw(kind, id) {
  currentStep = `draw:${id}`;
  const frame = 30;
  const color = itemColor(id);
  await seekItem(id, frame);
  await focusItem(id);
  await installWriteHook();
  const beforeText = await readEditText();
  const beforeHistory = await historyCount();
  // 「動きを描く」はインスペクターの「動き」タブ（assignSectionToTab が motion:* を motion へ割り当てる）。
  // 先に動きの区画を開き、それでも見つからなければ animations widget の motion-draw 分岐と同じ
  // イベント（akari.motion.draw）を直接発火する。
  const openedMotion = await evaluate(main, `(() => {
    const tab = document.querySelector('[data-akari-ui="tab:inspector-motion"]');
    if (tab) { tab.click(); return 'tab'; }
    const open = document.querySelector('[data-akari-ui="action:inspector-motion-open"]');
    if (open) { open.click(); return 'action'; }
    return null; })()`);
  await sleep(700);
  let triggered = await evaluate(main, `(() => { const b = document.querySelector('[data-akari-ui="action:inspector-motion-draw"]');
    if (!b) return { found: false, via: 'inspector', openedMotion: ${JSON.stringify(openedMotion)},
      actions: [...document.querySelectorAll('[data-akari-ui^="action:inspector-"]')].map(e => e.getAttribute('data-akari-ui')).slice(0, 60),
      tabs: [...document.querySelectorAll('[data-akari-ui^="tab:inspector-"]')].map(e => e.getAttribute('data-akari-ui')) };
    b.click(); return { found: true, via: 'inspector', label: b.textContent }; })()`);
  if (!triggered.found) {
    const dispatched = await evaluate(main, `(() => { window.dispatchEvent(new CustomEvent('akari.motion.draw',
      { detail: { editUri: ${JSON.stringify(editUri)}, itemId: ${JSON.stringify(id)} } })); return true; })()`);
    triggered = { ...triggered, via: 'event', dispatched };
  }
  let armed = false;
  for (let n = 0; n < 50 && !armed; n++) {
    armed = await pv(`document.querySelector('.preview-pane')?.style.cursor === 'crosshair'`).catch(() => false);
    if (!armed) await sleep(200);
  }
  const ownerArmed = label.startsWith('after') ? await pv(`window.akari.interaction?.pointerOwner ?? null`) : null;
  if (label.startsWith('after')) await pv(`(() => {
    window.__r1DrawPointerStates = [];
    window.addEventListener('pointermove', () => {
      if (window.__r1DrawPointerStates.length < 30) window.__r1DrawPointerStates.push({
        owner: window.akari.interaction?.pointerOwner ?? null,
        ordinaryActive: window.akari.interaction?.activePointerOperation ?? null
      });
    }, true);
    if (${JSON.stringify(id)} === 'nested-photo') {
      const original = window.akari.engine.layerWrite;
      window.akari.engine.layerWrite = (itemId, patch) => {
        if (itemId === 'nested-photo' && patch?.xyKeyframes)
          sessionStorage.setItem('r1NestedPhotoWorldPoints', JSON.stringify(patch.xyKeyframes));
        return original(itemId, patch);
      };
    }
    return true;
  })()`);
  const box = armed ? await waitColorBox(id, color, 8000) : null;
  let stroke = null;
  if (armed && box) {
    const rect = await stageRect();
    const start = { x: box.page.x - 30 * rect.w / 1920, y: box.page.y - 20 * rect.h / 1080 };
    const swingX = Math.max(140, Math.min(420, box.size.w * 0.8 + 200));
    const swingY = kind === 'photo' ? 140 : Math.max(90, Math.min(260, box.size.h * 0.6 + 120));
    await drag(start, u => ({ x: start.x + u * swingX * rect.w / 1920 + Math.sin(u * Math.PI) * 26 * rect.w / 1920,
      y: start.y + u * swingY * rect.h / 1080 + Math.sin(u * Math.PI * 1.5) * 22 * rect.h / 1080 }), 16);
    stroke = { start: { x: round2(start.x), y: round2(start.y) }, swingX, swingY, box };
  } else {
    stroke = { armed: false, box };
  }
  const pointerStates = label.startsWith('after') ? await pv(`window.__r1DrawPointerStates ?? []`) : [];
  const ownerAfter = label.startsWith('after') ? await pv(`window.akari.interaction?.pointerOwner ?? null`) : null;
  let afterText = beforeText;
  for (let n = 0; n < 60 && afterText === beforeText; n++) { await sleep(200); afterText = await readEditText(); }
  await sleep(1200);
  afterText = await readEditText();
  const writes = (await historyCount()) - beforeHistory;
  const historyAfter = await historyLabels();
  const afterItem = findItem(JSON.parse(afterText), id);
  const points = realPoints(await pointsOfItem(afterItem));
  const withTransform = points.filter(point => point.transform);
  await stageShot(`draw-${id}-after`);
  let undoRestored = null, redoRestored = null;
  if (afterText !== beforeText) {
    await evaluate(main, `(() => { document.activeElement?.blur?.(); return true; })()`);
    await key('z', 'KeyZ', 90, 4, ['undo']);
    for (let n = 0; n < 40 && await readEditText() === afterText; n++) await sleep(200);
    await sleep(600);
    const undoneText = await readEditText();
    undoRestored = JSON.stringify(JSON.parse(undoneText)) === JSON.stringify(JSON.parse(beforeText));
    await key('z', 'KeyZ', 90, 12, ['redo']);
    for (let n = 0; n < 40 && await readEditText() === undoneText; n++) await sleep(200);
    await sleep(600);
    const redoText = await readEditText();
    redoRestored = JSON.stringify(JSON.parse(redoText)) === JSON.stringify(JSON.parse(afterText));
    if (!redoRestored) { await writeFile(editPath, afterText); await sleep(2500); }
  } else if (armed) await key('Escape', 'Escape', 27);
  const entry = DRAW.find(value => value.id === id);
  const pair = withTransform.length >= 2 ? [withTransform[0], withTransform.at(-1)] : [];
  const previewPath = [];
  for (const point of pair) {
    await seekItem(id, point.t);
    previewPath.push({ frame: point.t, local: { x: point.transform.x, y: point.transform.y },
      visible: await waitColorBox(id, color, 6000) });
  }
  const localDelta = pair.length === 2 ? { x: pair[1].transform.x - pair[0].transform.x,
    y: pair[1].transform.y - pair[0].transform.y } : null;
  const angle = PARENT.rotate * Math.PI / 180;
  const expectedWorldDelta = localDelta && entry?.nested
    ? { x: PARENT.scale * (localDelta.x * Math.cos(angle) - localDelta.y * Math.sin(angle)),
      y: PARENT.scale * (localDelta.x * Math.sin(angle) + localDelta.y * Math.cos(angle)) }
    : localDelta;
  const observedWorldDelta = previewPath.length === 2 && previewPath.every(row => row.visible)
    ? { x: round2(previewPath[1].visible.output.x - previewPath[0].visible.output.x),
      y: round2(previewPath[1].visible.output.y - previewPath[0].visible.output.y) } : null;
  const pathErrorPx = expectedWorldDelta && observedWorldDelta
    ? round2(Math.hypot(expectedWorldDelta.x - observedWorldDelta.x,
      expectedWorldDelta.y - observedWorldDelta.y)) : null;
  let nestedCoordinateCheck = null;
  if (label.startsWith('after') && id === 'nested-photo') {
    const world = await pv(`(() => { try { return JSON.parse(sessionStorage.getItem('r1NestedPhotoWorldPoints') ?? '[]'); } catch { return []; } })()`);
    const theta = -PARENT.rotate * Math.PI / 180;
    const comparisons = world.map(point => {
      const dx = point.transform.x - PARENT.x, dy = point.transform.y - PARENT.y;
      const expected = { x: (dx * Math.cos(theta) - dy * Math.sin(theta)) / PARENT.scale,
        y: (dx * Math.sin(theta) + dy * Math.cos(theta)) / PARENT.scale };
      const saved = points.find(p => p.t === point.t)?.transform ?? null;
      return { frame: point.t, expected, saved, errorPx: saved
        ? Math.hypot(saved.x - expected.x, saved.y - expected.y) : null };
    });
    nestedCoordinateCheck = { inputSpace: 'world', parent: PARENT, comparisons,
      maxErrorPx: Math.max(...comparisons.map(row => row.errorPx ?? Infinity)) };
  }
  return { id, frame, triggered, armed, stroke, writes, historyAfter,
    pointerOwnership: label.startsWith('after') ? { ownerArmed, ownerAfter, pointerStates,
      ordinaryGestureBlocked: ownerAfter === null
        && pointerStates.some(row => row.owner === 'motion-draw')
        && pointerStates.filter(row => row.owner === 'motion-draw').every(row => row.ordinaryActive === false) } : null,
    nestedCoordinateCheck,
    parent: entry?.nested ? PARENT : null, previewPath, expectedWorldDelta, observedWorldDelta, pathErrorPx,
    keyframesForm: Array.isArray(afterItem?.keyframes) ? 'array' : 'bag',
    pointCount: points.length, pointTimes: points.map(point => point.t),
    everyPointHasXY: withTransform.length > 0 && withTransform.every(point => Number.isFinite(point.transform.x) && Number.isFinite(point.transform.y)),
    positionGroupAligned: withTransform.length > 0 && points.every(point => !point.transform ||
      (Number.isFinite(point.transform.x) && Number.isFinite(point.transform.y))),
    firstPoints: points.slice(0, 6), undoRestored, redoRestored };
}

// ---- フレームの選択（点の時刻と点の間を混ぜて 6 つ） -------------------------------------------
function chooseFrames(points) {
  const times = [...new Set(points.map(point => point.t))].sort((a, b) => a - b);
  if (!times.length) return [10, 40, 75, 110, 140];
  const mids = times.slice(1).map((t, i) => Math.floor((times[i] + t) / 2));
  const wanted = [];
  const push = frame => { if (frame >= 0 && frame <= 149 && !wanted.includes(frame)) wanted.push(frame); };
  push(times[0]);
  push(times[Math.floor(times.length / 3)]);
  push(mids[0] ?? times[0]);
  push(times[Math.floor(times.length * 2 / 3)]);
  push(mids[mids.length - 1] ?? times[times.length - 1]);
  push(times[times.length - 1]);
  return wanted.sort((a, b) => a - b);
}
const COMPARE_GROUP = Object.fromEntries(DRAW.map(entry => [entry.id, `draw:${entry.id}`]));
async function captureCompareFrames() {
  const edit = await readEdit();
  const compare = {};
  for (const { id } of COMPARE) {
    if (!onlyHas(COMPARE_GROUP[id])) continue;
    const item = findItem(edit, id);
    const points = realPoints(await pointsOfItem(item));
    const frames = chooseFrames(points);
    compare[id] = frames;
    for (const frame of frames) {
      currentStep = `capture:${id}:${frame}`;
      await seekItem(id, frame);
      await evaluate(main, `(() => { document.activeElement?.blur?.(); return true; })()`).catch(() => {});
      await stageShot(`preview-${id}-${frame}`);
    }
  }
  return compare;
}

// ---- launch / run ---------------------------------------------------------------------------
const results = { draw: {}, regression: {} };
async function scenario(bucket, key, fn) {
  currentStep = `${bucket}:${key}`;
  try { results[bucket][key] = await fn(); } catch (error) { results[bucket][key] = { error: clean(error?.stack ?? error).slice(0, 1600) }; }
}
const report = { label, port, httpPort, parent: PARENT, drawIds: DRAW.map(entry => entry.id) };
try {
  await mkdir(outDir, { recursive: true });
  try { await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1000) });
    throw new Error(`CDP port ${port} already occupied`); } catch (error) { if (String(error).includes('already occupied')) throw error; }
  await makeFixture();
  const profile = path.join(scratch, 'profile'), config = path.join(scratch, 'config'), home = path.join(scratch, 'akari-home');
  await Promise.all([mkdir(profile), mkdir(config), mkdir(home)]);
  // Electron の stdout/stderr（Theia ロガー・webview のクラッシュ等）を残す（最後に clean() する）
  electronLog = path.join(outDir, `${label}-electron.log`);
  electronLogFd = openSync(electronLog, 'w');
  child = spawn(electron, [shellDir, project, `--remote-debugging-port=${port}`, '--hostname=127.0.0.1', `--port=${httpPort}`,
    `--user-data-dir=${profile}`, '--no-sandbox'], { cwd: shellDir, env: { ...process.env, THEIA_CONFIG_DIR: config, AKARI_HOME: home }, stdio: ['ignore', electronLogFd, electronLogFd], detached: true });
  const isShell = v => v.type === 'page' && v.url && !v.url.startsWith('devtools:');
  const target = (await waitForJson(`http://127.0.0.1:${port}/json/list`, v => v.find(isShell))).find(isShell);
  main = new CDP(target.webSocketDebuggerUrl); await main.connect(); track(main); await main.send('Runtime.enable'); await main.send('Page.enable');
  const version = await waitForJson(`http://127.0.0.1:${port}/json/version`, v => v.webSocketDebuggerUrl);
  browser = new CDP(version.webSocketDebuggerUrl); await browser.connect(); track(browser); trackTargets(browser);
  await browser.send('Target.setDiscoverTargets', { discover: true }).catch(() => {});
  try { const { windowId } = await browser.send('Browser.getWindowForTarget', { targetId: target.id });
    await browser.send('Browser.setWindowBounds', { windowId, bounds: { left: 0, top: 0, width: 1680, height: 1040, windowState: 'normal' } }); } catch {}
  await sleep(9000);
  const openOnly = () => evaluate(main, `(() => { const b = [...document.querySelectorAll('button')].find(e => ['開くだけ', '後で'].includes(e.textContent?.trim())); if (b) b.click(); return !!b; })()`);
  const soft = (id, value) => Promise.race([command(id, value).catch(e => ({ ok: false, error: String(e) })), sleep(5000).then(() => ({ ok: false, error: 'pending' }))]);
  for (let i = 0; i < 50; i++) { await openOnly().catch(() => {}); report.timelineOpen = await soft('akari.annotations.open'); if (report.timelineOpen.ok) break; await sleep(1600); }
  for (let i = 0; i < 40 && !view; i++) { await openOnly().catch(() => {}); await soft('akari.preview.ensureVisible', { editUri }); await sleep(2600); view = await findPreview(12000); }
  if (!view) throw new Error('preview not found');
  for (let i = 0; i < 60; i++) { if (await pv(`Number(document.getElementById('seek')?.max || 0) >= 59`).catch(() => false)) break; await sleep(500); }
  // 書き込みの失敗理由（本体 → webview の応答 error）を拾う（findPreview が新規文書へも仕込む）
  try {
    await pv(WRITE_ERROR_HOOK);
  } catch (error) { report.writeHookError = clean(error?.message ?? error); }
  report.inspectorOpen = await command('akari.inspector.open'); await sleep(900);
  report.seats = await evaluate(main, `(() => [...document.querySelectorAll('[data-akari-ui^="inspector-kf-seat:"]')].map(e => e.getAttribute('data-akari-ui')))()`);

  if (label === 'after' && onlyHas('photo-body')) {
    await scenario('regression', 'photo-body', () => regression('photo-body-drag', 'top-photo', 20, async () => {
      const select = await selectOnStage('top-photo', 'red');
      const box = await waitColorBox('top-photo', 'red');
      return { select, hitChain: box ? await hitChainAt(box.page) : null,
        drag: await dragBody('top-photo', 'red', 120, 70), expectedDelta: { x: 120, y: 70 } };
    }));
  }
    for (const entry of DRAW) if (onlyHas(`draw:${entry.id}`))
    await scenario('draw', entry.id, () => motionDraw(entry.kind, entry.id));
  if (onlyHas('regression') && label !== 'before-noguard')
    await scenario('regression', 'normal', runRegression);
  if ((label === 'after' && onlyHas('regression')) || only.includes('escape')) {
    if (!only.includes('escape')) await scenario('regression', 'after-draw-drag', () => regression('after-draw-drag', 'reg-text', 20, async () => ({
      ownerBefore: await pv(`window.akari.interaction?.pointerOwner ?? null`),
      drag: await dragBody('reg-text', itemColor('reg-text'), 120, 70)
    })));
    await scenario('regression', 'after-escape-drag', async () => {
      await seekItem('reg-html', 20); await focusItem('reg-html');
      await evaluate(main, `(() => { window.dispatchEvent(new CustomEvent('akari.motion.draw',
        { detail: { editUri: ${JSON.stringify(editUri)}, itemId: 'reg-html' } })); return true; })()`);
      for (let n = 0; n < 40; n++) {
        if (await pv(`document.querySelector('.preview-pane')?.style.cursor === 'crosshair`).catch(() => false)) break;
        await sleep(200);
      }
      const ownerArmed = await pv(`window.akari.interaction?.pointerOwner ?? null`);
      const escapeImmediate = await pv(`(() => { window.dispatchEvent(new KeyboardEvent('keydown',
        { key: 'Escape', bubbles: true })); return { owner: window.akari.interaction?.pointerOwner ?? null,
        cursor: document.querySelector('.preview-pane')?.style.cursor ?? null }; })()`);
      await sleep(150);
      const ownerReleased = await pv(`window.akari.interaction?.pointerOwner ?? null`);
      const dragResult = await regression('after-escape-drag', 'reg-html', 20, async () => ({
        drag: await dragBody('reg-html', itemColor('reg-html'), 120, 70)
      }));
      return { ...dragResult, ownerArmed, ownerReleased, escapeImmediate,
        passed: dragResult.passed && ownerArmed === 'motion-draw' && ownerReleased === null };
    });
  }
    if (onlyHas('selection') && label !== 'before-noguard') {
    await scenario('regression', 'photo-selection', async () => {
      await seekItem('reg-photo', 95);
      const before = await historyCount();
      const selected = await selectOnStage('reg-photo', 'red');
      return { selected, writes: (await historyCount()) - before,
        passed: selected.selected && (await historyCount()) === before };
    });
  }
  if (only.includes('photo-body') && label !== 'before-noguard' && label !== 'after') {
    await scenario('regression', 'photo-body', () => regression('photo-body-drag', 'top-photo', 20, async () => {
      const select = await selectOnStage('top-photo', 'red');
      const box = await waitColorBox('top-photo', 'red');
      const hitChain = box ? await hitChainAt(box.page) : null;
      return { select, hitChain, drag: await dragBody('top-photo', 'red', 120, 70),
        expectedDelta: { x: 120, y: 70 } };
    }));
  }
  if (onlyHas('marquee') && label !== 'before-noguard') {
    await scenario('regression', 'marquee', async () => {
      await seekItem('reg-marquee', 60);
      const before = await historyCount(); const rect = await stageRect();
      const start = { x: rect.x + rect.w * 0.03, y: rect.y + rect.h * 0.03 };
      const end = { x: rect.x + rect.w * 0.97, y: rect.y + rect.h * 0.97 };
      const hitChain = await hitChainAt(start);
      const local = { x: start.x - rect.hostX, y: start.y - rect.hostY };
      const startDecision = await pv(`(() => { const target = document.elementFromPoint(${local.x}, ${local.y});
        return { tag: target?.tagName, id: target?.id, allow: window.akari.shouldStartPreviewMarquee?.({
          target, button: 0, altKey: false, shiftKey: true }) ?? null }; })()`);
      await pv(`(() => {
        window.__r1MarqueeProbe = [];
        const original = window.akari.shouldStartPreviewMarquee;
        window.akari.shouldStartPreviewMarquee = event => {
          const allow = original(event);
          window.__r1MarqueeProbe.push({ type: 'decision', allow, target: event.target?.id || event.target?.tagName });
          return allow;
        };
        for (const type of ['pointerdown', 'pointermove', 'pointerup']) window.addEventListener(type, event => {
          if (window.__r1MarqueeProbe.length < 45) window.__r1MarqueeProbe.push({ type, target: event.target?.id || event.target?.tagName,
            shift: event.shiftKey, x: Math.round(event.clientX), y: Math.round(event.clientY) });
        }, true);
        return true;
      })()`);
      await mouse('mouseMoved', start, 0, 8); await mouse('mousePressed', start, 1, 8); await sleep(120);
      let live = null;
      for (let n = 1; n <= 12; n++) {
        await mouse('mouseMoved', { x: start.x + (end.x - start.x) * n / 12,
          y: start.y + (end.y - start.y) * n / 12 }, 1, 8);
        await sleep(35);
        if (n === 9) live = await pv(`(() => ({ marquee: Boolean(document.querySelector('[data-akari-ui="preview-marquee"]')),
          hits: [...document.querySelectorAll('[data-akari-interaction-marquee-hit="true"]')].length }))()`);
      }
      await mouse('mouseReleased', end, 0, 8); await sleep(350);
      const selection = await selectionState('reg-marquee');
      const events = await pv(`window.__r1MarqueeProbe ?? []`);
      return { writes: (await historyCount()) - before, hitChain, startDecision, live, selection, events,
        passed: (await historyCount()) === before && live?.marquee === true };
    });
  }
  // フックの記録は Electron を止める前に読む（止めた後の pv は失敗する）
  currentStep = 'read-hooks';
  results.writeErrors = await pv(`(() => { try { return JSON.parse(sessionStorage.getItem('r1WriteErrors') ?? '[]'); }
    catch { return window.__r1WriteErrors ?? []; } })()`).catch(() => []);
  results.hookCheck = await pv(`(() => ({ consoleWrapped: window.__r1ConsoleWrapped === true,
    engineWrapped: window.akari?.engine?.__r1Wrapped === true, engineType: typeof window.akari?.engine?.overlayWrite,
    errors: (window.__r1WriteErrors ?? []).length, editPath: window.akari?.state?.editPath ?? null }))()`).catch(() => null);
  currentStep = 'capture';
  results.compare = await captureCompareFrames();
  results.finalEdit = await readEdit();
  const bags = {};
  for (const track of results.finalEdit.tracks ?? []) for (const item of track.items ?? []) {
    if (item.keyframes && !Array.isArray(item.keyframes) && typeof item.keyframes.path === 'string') {
      try { bags[item.keyframes.path] = await readFile(path.join(project, item.keyframes.path), 'utf8'); } catch {}
    }
  }
  results.motionBagPaths = Object.keys(bags);
  if (Object.keys(bags).length) await writeFile(path.join(outDir, `${label}-final-motion-bags.json`), `${JSON.stringify(bags, null, 2)}\n`);
} catch (error) { report.error = clean(error?.stack ?? error); }
finally {
  main?.close(); browser?.close();
  if (child?.pid) { try { process.kill(-child.pid, 'SIGTERM'); } catch {} await sleep(1800); try { process.kill(-child.pid, 'SIGKILL'); } catch {} }
  // Electron may leave a reparented Helper that still owns the private HTTP port.
  // Match only this invocation's unique profile and terminate exact PIDs.
  const listing = spawnSync('ps', ['-axo', 'pid=,command='], { encoding: 'utf8' });
  for (const row of (listing.stdout ?? '').split('\n')) {
    if (!row.includes(path.join(scratch, 'profile')) || !row.includes('Electron Helper')) continue;
    const pid = Number(row.trim().match(/^\d+/)?.[0]);
    if (Number.isInteger(pid) && pid > 0) { try { process.kill(pid, 'SIGTERM'); } catch {} }
  }

  try { closeSync(electronLogFd); } catch {}
  await sleep(300);
  try { if (electronLog) await writeFile(electronLog, clean(await readFile(electronLog, "utf8"))); } catch {}
}
report.results = results;
report.writeErrors = results.writeErrors ?? [];
results.contextLosses = contextLosses;
results.targetEvents = targetEvents.slice(-60);
report.consoleErrors = [...new Set(consoleErrors.map(clean))].slice(-20);
if (results.finalEdit) { await writeFile(path.join(outDir, `${label}-final-edit.json`), `${JSON.stringify(results.finalEdit, null, 2)}\n`); delete results.finalEdit; }
await writeFile(path.join(outDir, `${label}.json`), `${clean(JSON.stringify(report, null, 2))}\n`);
if (!process.argv.includes('--keep')) await rm(scratch, { recursive: true, force: true });
console.log(JSON.stringify({ label, error: report.error ?? null, draw: Object.keys(results.draw), regression: Object.keys(results.regression) }));
if (report.error || [...Object.values(results.draw), ...Object.values(results.regression)].some(value => value?.error))
  process.exitCode = 1;
