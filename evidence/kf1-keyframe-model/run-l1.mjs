#!/usr/bin/env node
// KF-1 L1。オーナーの edit.json のコピーから隔離した 4 種の item を操作する。
// 使い方: node evidence/kf1-keyframe-model/run-l1.mjs --owner <project> --label before|after
// 呼び出し側が heavy-slot の枠を持つこと。一時ディレクトリ・ポートはこの票専用。
import { spawn, spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : fallback; };
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const shellDir = path.resolve(arg('shell', path.join(repo, 'apps/shell')));
const outDir = path.resolve(arg('out', path.join(repo, 'evidence/kf1-keyframe-model')));
const ownerDir = path.resolve(arg('owner'));
const label = arg('label', 'after');
const only = (arg('only', '') || '').split(',').filter(Boolean);
const reopenOnly = arg('reopen-only', '') === 'yes';
const port = 9571;
const electron = path.join(shellDir, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
const ffmpeg = process.env.FFMPEG ?? 'ffmpeg';
const W = 640, H = 360, FPS = 30;

const scratch = await realpath(await mkdtemp(path.join(os.tmpdir(), '2026-09-26-libcanvas-kf1-keyframe-model-l1-')));
const project = path.join(scratch, 'project');
const editPath = path.join(project, 'edit.json');
const editUri = pathToFileURL(editPath).href;
const clean = v => String(v).replaceAll(repo, '<repo>').replaceAll(scratch, '<scratch>').replace(/\/Users\/[^\s"')]+/g, '<local>')
  .replace(/\/(private\/)?(tmp|var)\/[^\s"')]+/g, '<tmp>');

// ---- isolated owner fixture -------------------------------------------------------------
const readEditText = () => readFile(editPath, 'utf8');
const findItem = (edit, id) => { for (const track of edit.tracks ?? []) for (const item of track.items ?? []) if (item.id === id) return item; };
const targetIds = ['shape-1', 'image-1', 'text-kf1', 'title-01'];
async function makeFixture() {
  await mkdir(project, { recursive: true });
  for (const name of ['edit.json', 'captions.json']) await cp(path.join(ownerDir, name), path.join(project, name));
  const captions = JSON.parse(await readFile(path.join(project, 'captions.json'), 'utf8'));
  captions.captions = [];
  await writeFile(path.join(project, 'captions.json'), `${JSON.stringify(captions, null, 2)}\n`);
  await mkdir(path.join(project, 'assets/generated'), { recursive: true });
  await cp(path.join(ownerDir, 'assets/generated/still-1790353959489-vvGwaI.png'),
    path.join(project, 'assets/generated/still-1790353959489-vvGwaI.png'));
  await cp(path.join(ownerDir, 'overlays'), path.join(project, 'overlays'), { recursive: true });
  await writeFile(path.join(project, 'overlays/kf1-text.html'), `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;width:100%;height:100%;background:transparent}
    .text{position:absolute;left:50%;top:45%;transform:translate(-50%,-50%);color:white;
      font:700 120px sans-serif;white-space:nowrap;text-shadow:0 3px 8px #000}
    </style></head><body><div class="text">動きを確認</div></body></html>`);
  await mkdir(path.join(project, '.akari'), { recursive: true });
  await writeFile(path.join(project, '.akari', 'lint.json'), '{"version":1,"verdict":"pass"}\n');
  const original = JSON.parse(await readEditText());
  const selections = targetIds.filter(id => id !== 'text-kf1').map(id => structuredClone(findItem(original, id)));
  selections[1].source.src = 'still-src-1';
  selections.splice(2, 0, { id: 'text-kf1', source: { kind: 'html', path: 'overlays/kf1-text.html' } });
  const scales = [0.6, 0.3, 1, 1];
  const tracks = selections.map((item, index) => ({ id: `kf${index + 1}`, lane: 'visual', name: `KF ${index + 1}`, items: [{
    ...item, at: index * 150, duration: 150, transform: { x: 0, y: 0, scale: scales[index], rotate: 0 }, keyframes: undefined
  }] }));
  const fixture = { ...original, output: { width: 1920, height: 1080, fps: FPS },
    sources: original.sources.filter(source => source.id === 'still-src-1'), tracks };
  await writeFile(editPath, `${JSON.stringify(fixture, null, 2)}\n`);
  return fixture;
}

if (arg('export-only', '') === 'yes') {
  const previewKind = arg('preview-kind', 'editing');
  await mkdir(outDir, { recursive: true });
  await makeFixture();
  const saved = JSON.parse(await readFile(path.join(outDir, `${label}-final-edit.json`), 'utf8'));
  saved.tracks = saved.tracks.filter(track => track.items?.some(item => item.id === 'shape-1'));
  saved.tracks[0].items = saved.tracks[0].items.filter(item => item.id === 'shape-1');
  saved.sources = saved.sources.filter(source => source.id === 'still-src-1');
  await writeFile(editPath, `${JSON.stringify(saved, null, 2)}\n`);
  const home = path.join(scratch, 'akari-home');
  await mkdir(home, { recursive: true });
  await mkdir(path.join(project, 'exports'), { recursive: true });
  const mp4 = path.join(project, 'exports', 'shape-osr.mp4');
  const command = spawnSync(process.execPath, [path.join(repo, 'packages/render-cut/bin/render-cut.mjs'), project,
    '--out', mp4, '--engine', 'osr', '--scale-to', '640x360', '--preview', 'off', '--no-verify-blank', '--force'],
  { cwd: repo, env: { ...process.env, AKARI_HOME: home, AKARI_OSR_ELECTRON: '',
    THEIA_CONFIG_DIR: path.join(scratch, 'config') }, encoding: 'utf8', maxBuffer: 20_000_000, timeout: 600000 });
  const exportReport = { label, commandExit: command.status, stdout: clean(command.stdout ?? '').slice(-5000),
    stderr: clean(command.stderr ?? '').slice(-5000), frames: [] };
  const rgb = (file, seconds) => {
    const input = seconds === undefined ? ['-i', file] : ['-ss', String(seconds), '-i', file, '-frames:v', '1'];
    const decoded = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', ...input,
      '-vf', 'scale=640:360:flags=area', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'],
    { maxBuffer: 640 * 360 * 4 });
    if (decoded.status !== 0 || decoded.stdout.length !== 640 * 360 * 3) throw new Error('frame decode failed');
    return decoded.stdout;
  };
  const whiteBounds = buffer => {
    let minX = 640, minY = 360, maxX = -1, maxY = -1;
    for (let y = 0; y < 360; y++) for (let x = 0; x < 640; x++) {
      const index = (y * 640 + x) * 3;
      if (buffer[index] < 215 || buffer[index + 1] < 215 || buffer[index + 2] < 215) continue;
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
    return maxX < 0 ? null : { x: (minX + maxX) / 2, y: (minY + maxY) / 2,
      box: { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 } };
  };
  if (command.status === 0) for (const frame of [0, 11, 22, 70, 123, 126]) {
    const previewName = previewKind === 'reopened' ? `${label}-d-reopen-shape-${frame}.png`
      : `${label}-d-shape-${frame}.png`;
    const preview = whiteBounds(rgb(path.join(outDir, previewName)));
    const rendered = whiteBounds(rgb(mp4, frame / 30));
    exportReport.frames.push({ frame, preview, rendered,
      delta: preview && rendered ? { x: +(rendered.x - preview.x).toFixed(2),
        y: +(rendered.y - preview.y).toFixed(2) } : null });
    const shot = path.join(outDir, `${label}-osr-shape-${frame}.png`);
    spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-ss', String(frame / 30),
      '-i', mp4, '-frames:v', '1', shot]);
  }
  await writeFile(path.join(outDir, previewKind === 'reopened'
    ? `${label}-export-reopened.json` : `${label}-export.json`),
  `${JSON.stringify(exportReport, null, 2)}\n`);
  await rm(scratch, { recursive: true, force: true });
  console.log(JSON.stringify({ label, exportExit: command.status, frames: exportReport.frames.length }));
  process.exit(command.status === 0 ? 0 : 1);
}

// ---- CDP ---------------------------------------------------------------------------------
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
function track(cdp) {
  cdp.on('Runtime.executionContextCreated', (p, s) => { if (!p?.context?.auxData?.isDefault) return; contexts.set(s, [...(contexts.get(s) ?? []), p.context.id]); });
  cdp.on('Runtime.executionContextsCleared', (_p, s) => contexts.delete(s));
  cdp.on('Runtime.exceptionThrown', p => consoleErrors.push(String(p.exceptionDetails?.exception?.description ?? p.exceptionDetails?.text ?? '').slice(0, 400)));
  cdp.on('Runtime.consoleAPICalled', p => { if (p.type === 'error') consoleErrors.push(p.args.map(a => a.value ?? a.description ?? '').join(' ').slice(0, 400)); });
}
let main, browser, view, child;
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
const pv = expr => evaluate(browser, expr, view.contextId, view.sessionId);
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
// 出力の枠の本体ページ上の矩形（本体の webview iframe + 中の #preview-stage）
async function stageRect() {
  const inner = await pv(`(() => { const r = document.getElementById('preview-stage').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`);
  const host = await evaluate(main, `(() => { const f = [...document.querySelectorAll('iframe')].filter(f => /webview/.test(f.src || '')).map(f => f.getBoundingClientRect()).filter(r => r.width > 100 && r.height > 100).sort((a, b) => b.width * b.height - a.width * a.height)[0]; return f ? { x: f.x, y: f.y, w: f.width, h: f.height } : null; })()`);
  return { x: host.x + inner.x, y: host.y + inner.y, w: inner.w, h: inner.h };
}
async function stageShot(name) {
  const rect = await stageRect();
  const dpr = await evaluate(main, 'window.devicePixelRatio');
  const { data } = await main.send('Page.captureScreenshot', { format: 'png', clip: { x: rect.x, y: rect.y, width: rect.w, height: rect.h, scale: W / rect.w / dpr } });
  const file = path.join(outDir, `${label}-${name}.png`);
  await writeFile(file, Buffer.from(data, 'base64'));
  return file;
}
const toPage = (rect, p) => ({ x: rect.x + (p.x + W / 2) * rect.w / W, y: rect.y + (p.y + H / 2) * rect.h / H });
async function mouse(type, pt, buttons = 0) {
  await main.send('Input.dispatchMouseEvent', { type, x: pt.x, y: pt.y, button: type === 'mouseMoved' && !buttons ? 'none' : 'left', buttons, clickCount: type === 'mouseMoved' ? 0 : 1 });
}
const results = {};
async function scenario(name, fn) {
  if (only.length && !only.includes(name)) return;
  try { results[name] = await fn(); } catch (e) { results[name] = { error: clean(e?.stack ?? e).slice(0, 1600) }; }
}
async function overlayPosition(id) {
  const inner = await pv(`(() => { const host = document.querySelector('[data-overlay-id="${id}"], [data-akari-layer-id="${id}"], [data-layer-id="${id}"], [data-item-id="${id}"]');
    const e = host?.querySelector('svg, img, video') ?? host
      ?? (['image-1', 'text-kf1'].includes('${id}')
        ? document.querySelector('#layer-select-box.is-active, #cut-select-box.is-active') : null);
    const stage = document.getElementById('preview-stage');
    if (!e || !stage) return null; const r = e.getBoundingClientRect(), s = stage.getBoundingClientRect();
    return { x: r.x-s.x+r.width/2, y: r.y-s.y+r.height/2, w:r.width, h:r.height, stageW:s.width, stageH:s.height }; })()`);
  if (!inner) return null;
  const stage = await stageRect();
  return { output: { x: +(inner.x / inner.stageW * 1920 - 960).toFixed(2), y: +(inner.y / inner.stageH * 1080 - 540).toFixed(2) },
    page: { x: stage.x + inner.x, y: stage.y + inner.y }, size: { w: inner.w, h: inner.h } };
}
async function dragItem(id, dx, dy, name) {
  const before = await overlayPosition(id);
  if (!before) throw new Error(`overlay ${id} missing`);
  const rect = await stageRect();
  const moves = await pv(`(() => { const stage=document.getElementById('preview-stage').getBoundingClientRect();
    return [...document.querySelectorAll('.akari-interaction-action.is-move, #layer-select-box.is-active .akari-layer-handle-move, #cut-select-box.is-active .akari-cut-handle-move')].map(e=>{const r=e.getBoundingClientRect();return {
      x:r.x-stage.x+r.width/2,y:r.y-stage.y+r.height/2,w:r.width,h:r.height,display:getComputedStyle(e).display};}); })()`);
  const usable = moves.filter(move => move.w > 0 && move.h > 0 && move.display !== 'none')
    .sort((a,b) => Math.hypot(a.x-(before.page.x-rect.x),a.y-(before.page.y-rect.y))
      - Math.hypot(b.x-(before.page.x-rect.x),b.y-(before.page.y-rect.y)))[0];
  const start = usable ? { x: rect.x+usable.x, y: rect.y+usable.y } : before.page;
  const target = { x: start.x + dx * rect.w / 1920, y: start.y + dy * rect.h / 1080 };
  const textBefore = await readEditText();
  await pv(`(() => { window.__kf1Events=[]; for(const type of ['pointerdown','pointermove','pointerup','pointercancel'])
    window.addEventListener(type,e=>window.__kf1Events.push({type,id:e.pointerId,x:e.clientX,y:e.clientY}),true); return true; })()`);
  await mouse('mouseMoved', start); await sleep(100); await mouse('mousePressed', start, 1); await sleep(120);
  for (let n = 1; n <= 12; n++) { await mouse('mouseMoved', { x: start.x + (target.x-start.x)*n/12,
    y: start.y + (target.y-start.y)*n/12 }, 1); await sleep(35); }
  await stageShot(name + '-during');
  await mouse('mouseReleased', target);
  await sleep(120);
  await mouse('mouseMoved', { x: target.x + 4, y: target.y + 4 });
  const release = await pv(`(() => { const events=window.__kf1Events??[];
    const down=events.find(e=>e.type==='pointerdown'); const up=events.some(e=>e.type==='pointerup'&&e.id===down?.id);
    if(down&&!up){const last=events.filter(e=>e.type==='pointermove').at(-1)??down;
      window.dispatchEvent(new PointerEvent('pointerup',{pointerId:down.id,clientX:last.x,clientY:last.y,bubbles:true}));}
    return {synthetic:!!down&&!up,events:events.slice(-24)}; })()`).catch(() => ({synthetic:false,events:[]}));
  for (let n = 0; n < 40 && await readEditText() === textBefore; n++) await sleep(200);
  await sleep(900);
  const after = await overlayPosition(id);
  await stageShot(name + '-after');
  const notice = await evaluate(main, `document.body.innerText.slice(-450)`);
  return { before: before?.output, after: after?.output, moves, selectedMove: usable ?? null, release, notice,
    keyframes: findItem(JSON.parse(await readEditText()), id)?.keyframes ?? null,
    staticTransform: findItem(JSON.parse(await readEditText()), id)?.transform ?? null };
}
async function seat(id, frame, labelText) {
  const at = targetIds.indexOf(id) * 5 + frame / FPS;
  await seek(at);
  const focus = await command('akari.timeline.focusItem', { itemId: id, reveal: true });
  await sleep(500);
  const tabId = 'video';
  await evaluate(main, `(() => { document.querySelector('[data-akari-ui="tab:inspector-${tabId}"]')?.click(); return true; })()`);
  await sleep(500);
  const pressed = await evaluate(main, `(() => {
    const b = document.querySelector('[data-akari-ui="inspector-kf-seat:transform-x"]');
    if (!b) return { found:false, panel:!!document.querySelector('[data-akari-ui="panel:inspector"]'),
      tabs:[...document.querySelectorAll('[data-akari-ui^="tab:inspector-"]')].map(e=>e.getAttribute('data-akari-ui')),
      seats:[...document.querySelectorAll('[data-akari-ui^="inspector-kf-seat:"]')].map(e=>e.getAttribute('data-akari-ui')),
      text:document.querySelector('[data-akari-ui="panel:inspector"]')?.innerText.slice(0,300) };
    const old = b.getAttribute('aria-pressed'); b.click(); return { found:true, old, title:b.title };
  })()`);
  await sleep(950);
  await stageShot(labelText);
  return { focus, pressed, keyframes: findItem(JSON.parse(await readEditText()), id)?.keyframes ?? null };
}
async function changeInspectorX(id, frame, value) {
  await seek(targetIds.indexOf(id) * 5 + frame / FPS);
  await command('akari.timeline.focusItem', { itemId:id, reveal:true });
  await sleep(350);
  const changed = await evaluate(main, `(() => {
    const row=document.querySelector('[data-akari-ui="field:inspector-transform-x"]'); const input=row?.querySelector('input');
    if(!input) return {found:false}; input.value=${JSON.stringify(String(value))}; input.dispatchEvent(new Event('input',{bubbles:true}));
    input.dispatchEvent(new Event('blur',{bubbles:true})); return {found:true}; })()`);
  await sleep(950);
  return { changed, keyframes: findItem(JSON.parse(await readEditText()), id)?.keyframes ?? null,
    staticTransform: findItem(JSON.parse(await readEditText()), id)?.transform ?? null };
}
async function runScenarios() {
  report.inspectorOpen = await command('akari.inspector.open'); await sleep(900);
  report.fields = await evaluate(main, `(() => [...document.querySelectorAll('[data-akari-ui^="inspector-kf-seat:"]')].map(e=>e.getAttribute('data-akari-ui')))()`);
  for (const id of targetIds) await scenario(id, async () => {
    const base = targetIds.indexOf(id) * 5;
    const initial = findItem(JSON.parse(await readEditText()), id);
    const last = await seat(id, 123, `${id}-last-seat`);
    await seek(base + 11/FPS); const first = await dragItem(id, 130, 65, `${id}-first-drag`);
    await seek(base + 70/FPS); const middle = await dragItem(id, -80, 90, `${id}-middle-drag`);
    const noPoint = await changeInspectorX(id, 90, 25);
    await seek(base + 123/FPS); const removed = await seat(id, 123, `${id}-remove-seat`);
    await seek(base + 70/FPS); const reselected = await overlayPosition(id);
    return { initial: {transform:initial.transform,keyframes:initial.keyframes??null}, last, first, middle, noPoint, removed,
      afterDeleteAt70: reselected?.output ?? null };
  });
  if (!only.length || only.includes('d')) {
    const d = [];
    for (const frame of [0,11,22,70,123,126]) {
      await seek(frame/FPS); const pos = await overlayPosition('shape-1');
      await stageShot(`d-shape-${frame}`); d.push({ frame, editing: pos?.output ?? null });
    }
    results.d = d;
  }
  results.finalEdit = JSON.parse(await readEditText());
  const undoStart = await readEditText();
  await evaluate(main, `(() => { document.activeElement?.blur?.(); return true; })()`);
  await main.send('Input.dispatchKeyEvent', { type:'keyDown', key:'z', code:'KeyZ',
    windowsVirtualKeyCode:90, modifiers:4, commands:['undo'] });
  await main.send('Input.dispatchKeyEvent', { type:'keyUp', key:'z', code:'KeyZ',
    windowsVirtualKeyCode:90, modifiers:4 });
  for (let i=0;i<30 && await readEditText()===undoStart;i++) await sleep(200);
  const undone = JSON.parse(await readEditText());
  const title = findItem(undone, 'title-01');
  results.undo = { changed: JSON.stringify(undone)!==JSON.stringify(results.finalEdit),
    restoredTitlePoint: title?.keyframes?.some(point => point.t===123 && point.transform?.x!==undefined) ?? false };
}

async function reopenedFrames() {
  const rows = [];
  for (const frame of [0, 11, 22, 70, 123, 126]) {
    await seek(frame / FPS);
    await sleep(1500);
    const position = await overlayPosition('shape-1');
    const diagnostic = await pv(`(() => { const layer=document.querySelector('[data-overlay-id="shape-1"]');
      const summary=window.akari?.state?.summary; const tree=summary?.tree?.find(item=>item.id==='shape-1');
      const spec=summary?.overlays?.find(item=>item.id==='shape-1');
      return { seek:Number(document.getElementById('seek')?.value), mode:document.getElementById('preview-stage')?.dataset.frameEngineActive,
        style:layer?.getAttribute('style')?.slice(0,400), computed:layer?getComputedStyle(layer).transform:null,
        tree:tree?{id:tree.id,kind:tree.kind,keyframes:tree.keyframes,transform:tree.transform}:null,
        spec:spec?{id:spec.id,start:spec.start,duration:spec.duration,keyframes:spec.keyframes,
          keyframeUnit:spec.keyframeUnit,transform:spec.transform}:null,
        summaryKeys:summary?Object.keys(summary).slice(0,20):[] }; })()`);
    await stageShot(`d-reopen-shape-${frame}`);
    rows.push({ frame, reopened: position?.output ?? null, diagnostic });
  }
  return rows;
}

// ---- launch / capture --------------------------------------------------------------------
const report = { label, port, kinds: targetIds };
let fixture;
try {
  await mkdir(outDir, { recursive: true });
  try { await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1000) });
    throw new Error(`CDP port ${port} already occupied`); } catch (error) {
    if (String(error).includes('already occupied')) throw error;
  }
  fixture = await makeFixture();
  if (reopenOnly) await writeFile(editPath,
    await readFile(path.join(outDir, `${label}-final-edit.json`), 'utf8'));
  const profile=path.join(scratch,'profile'), config=path.join(scratch,'config'), home=path.join(scratch,'akari-home');
  await Promise.all([mkdir(profile),mkdir(config),mkdir(home)]);
  child=spawn(electron,[shellDir,project,`--remote-debugging-port=${port}`,'--hostname=127.0.0.1','--port=48961',
    `--user-data-dir=${profile}`,'--no-sandbox'],{cwd:shellDir,env:{...process.env,THEIA_CONFIG_DIR:config,AKARI_HOME:home},stdio:'ignore',detached:true});
  const isShell=v=>v.type==='page'&&v.url&&!v.url.startsWith('devtools:');
  const target=(await waitForJson(`http://127.0.0.1:${port}/json/list`,v=>v.find(isShell))).find(isShell);
  main=new CDP(target.webSocketDebuggerUrl); await main.connect(); track(main); await main.send('Runtime.enable'); await main.send('Page.enable');
  const version=await waitForJson(`http://127.0.0.1:${port}/json/version`,v=>v.webSocketDebuggerUrl);
  browser=new CDP(version.webSocketDebuggerUrl); await browser.connect(); track(browser);
  await browser.send('Target.setDiscoverTargets',{discover:true}).catch(()=>{});
  try { const {windowId}=await browser.send('Browser.getWindowForTarget',{targetId:target.id});
    await browser.send('Browser.setWindowBounds',{windowId,bounds:{left:0,top:0,width:1680,height:1040,windowState:'normal'}}); } catch {}
  await sleep(9000);
  const openOnly=()=>evaluate(main,`(() => { const b=[...document.querySelectorAll('button')].find(e=>['開くだけ','後で'].includes(e.textContent?.trim())); if(b)b.click(); return !!b; })()`);
  const soft=(id,value)=>Promise.race([command(id,value).catch(e=>({ok:false,error:String(e)})),sleep(5000).then(()=>({ok:false,error:'pending'}))]);
  for(let i=0;i<50;i++){await openOnly().catch(()=>{}); report.timelineOpen=await soft('akari.annotations.open'); if(report.timelineOpen.ok)break; await sleep(1600);}
  for(let i=0;i<40&&!view;i++){await openOnly().catch(()=>{}); await soft('akari.preview.ensureVisible',{editUri}); await sleep(2600); view=await findPreview(12000);}
  if(!view)throw new Error('preview not found');
  for(let i=0;i<40;i++){if(await pv(`Number(document.getElementById('seek')?.max || 0) >= 18`).catch(()=>false))break; await sleep(500);}
  if (reopenOnly) results.reopened = await reopenedFrames();
  else await runScenarios();
} catch(e){report.error=clean(e?.stack??e);}
finally {
  main?.close(); browser?.close();
  if(child?.pid){try{process.kill(-child.pid,'SIGTERM');}catch{} await sleep(1800); try{process.kill(-child.pid,'SIGKILL');}catch{}}
  const owned = spawnSync('ps', ['-axo', 'pid=,command='], { encoding: 'utf8' }).stdout ?? '';
  for (const line of owned.split('\n')) {
    if (!line.includes(scratch) || !line.includes('Electron Helper')) continue;
    const pid = Number(line.trim().split(/\s+/)[0]);
    if (Number.isInteger(pid) && pid > 0) try { process.kill(pid, 'SIGKILL'); } catch {}
  }
}
report.results=results;
report.consoleErrors=[...new Set(consoleErrors.map(clean))].slice(-20);
if(results.finalEdit){await writeFile(path.join(outDir,`${label}-final-edit.json`),`${JSON.stringify(results.finalEdit,null,2)}\n`);delete results.finalEdit;}
await writeFile(path.join(outDir,reopenOnly ? `${label}-reopened.json` : `${label}.json`),
  `${clean(JSON.stringify(report,null,2))}\n`);
if (!process.argv.includes('--keep')) await rm(scratch,{recursive:true,force:true});
console.log(JSON.stringify({label,error:report.error??null,scenarios:Object.keys(results)}));
