#!/usr/bin/env node
// KF-1 L1 の追加分（再開の走り）。run-l1.mjs で触れなかった操作を図形で確かめる。
//   A: 位置のまとまりが動きを持つ図形で、キーフレームの無い時刻に つまみで拡大縮小 / 回転 / 矢印キーのナッジ /
//      コンテキストバー（揃え = nudge・x の数値 = write・幅 = resize）→ その時刻に揃った点・戻らない・書き込み 1 回・undo 1 回
//   B: 大きさ・不透明度のまとまりを◆で打つ → 別の時刻でインスペクターの数値を変える → 動きになる / タイムラインの点の削除 → 点ごと
//   C: 点が 1 つ（+ 空の相方）の図形の OSR 書き出し ⇄ プレビュー（± 2px）
// 使い方: node evidence/kf1-keyframe-model/run-l1-extra.mjs            … アプリを起動して A・B・C の操作とプレビューの撮影
//         node evidence/kf1-keyframe-model/run-l1-extra.mjs --export   … C の保存結果を render-cut（OSR）で書き出して比較
// 呼び出し側が heavy-slot の枠を持つこと。一時ディレクトリ・ポートはこの票専用。
import { spawn, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url);
const { evaluatedItemTransform, evaluatedItemOpacity } = require(path.join(repo, 'packages/edit-store/lib/index.js'));
const shellDir = path.join(repo, 'apps/shell');
const outDir = path.join(repo, 'evidence/kf1-keyframe-model');
const label = 'extra';
const port = 9571;
const electron = path.join(shellDir, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
const ffmpeg = process.env.FFMPEG ?? 'ffmpeg';
const W = 640, H = 360, FPS = 30;

const scratch = await realpath(await mkdtemp(path.join(os.tmpdir(), '2026-09-26-libcanvas-kf1-keyframe-model-extra-')));
const project = path.join(scratch, 'project');
const editPath = path.join(project, 'edit.json');
const editUri = pathToFileURL(editPath).href;
const clean = v => String(v).replaceAll(repo, '<repo>').replaceAll(scratch, '<scratch>').replace(/\/Users\/[^\s"')]+/g, '<local>')
  .replace(/\/(private\/)?(tmp|var)\/[^\s"')]+/g, '<tmp>');
const readEditText = () => readFile(editPath, 'utf8');
const readEdit = async () => JSON.parse(await readEditText());
const findItem = (edit, id) => { for (const track of edit.tracks ?? []) for (const item of track.items ?? []) if (item.id === id) return item; };
const realPoints = item => (item?.keyframes ?? []).filter(p => p.transform || p.opacity !== undefined);
const round = v => Math.round(v * 100) / 100;

// ---- fixture: 3 つの図形を時間で並べる（同時に 1 つだけ見える） ---------------------------
const bubble = () => ({ kind: 'shape', shape: 'bubble', params: { fill: '#ffffff', stroke: '#000000', strokeWidth: 5, style: 'rect',
  count: 16, depth: 40, jitter: 25, seed: 1, tail: 'point', tailAngle: 195, tailLength: 42, tailWidth: 26, tailCurve: 0,
  dash: 'solid', preset: 'manga-rect-tail', width: 360, height: 360 } });
const ORDER = ['shape-c', 'shape-a', 'shape-b'];
const baseOf = id => ORDER.indexOf(id) * 5; // 出力の秒
async function makeFixture() {
  await mkdir(path.join(project, '.akari'), { recursive: true });
  await writeFile(path.join(project, 'captions.json'), '{\n  "captions": []\n}\n');
  await writeFile(path.join(project, '.akari', 'lint.json'), '{"version":1,"verdict":"pass"}\n');
  const edit = { version: 2, output: { width: 1920, height: 1080, fps: FPS }, sources: [],
    tracks: ORDER.map((id, index) => ({ id: `k${index + 1}`, lane: 'visual', name: `KF ${index + 1}`, items: [{
      id, at: index * 150, duration: 150, source: bubble(), transform: { x: 0, y: 0, scale: 0.6, rotate: 0 } }] })) };
  await writeFile(editPath, `${JSON.stringify(edit, null, 2)}\n`);
}

// ---- export mode (C) ----------------------------------------------------------------------
const rgb = (file, seconds) => {
  const input = seconds === undefined ? ['-i', file] : ['-ss', String(seconds), '-i', file, '-frames:v', '1'];
  const decoded = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', ...input,
    '-vf', 'scale=640:360:flags=area', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 640 * 360 * 4 });
  if (decoded.status !== 0 || decoded.stdout.length !== 640 * 360 * 3) throw new Error('frame decode failed');
  return decoded.stdout;
};
const whiteBounds = buffer => {
  let minX = 640, minY = 360, maxX = -1, maxY = -1;
  for (let y = 0; y < 360; y++) for (let x = 0; x < 640; x++) {
    const index = (y * 640 + x) * 3;
    if (buffer[index] < 215 || buffer[index + 1] < 215 || buffer[index + 2] < 215) continue;
    minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  return maxX < 0 ? null : { x: (minX + maxX) / 2, y: (minY + maxY) / 2, box: { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 } };
};
const C_FRAMES = [0, 20, 50, 80, 149];
if (process.argv.includes('--export')) {
  await makeFixture();
  const saved = JSON.parse(await readFile(path.join(outDir, `${label}-final-edit.json`), 'utf8'));
  saved.tracks = saved.tracks.filter(track => track.items?.some(item => item.id === 'shape-c'));
  // render-cut は sources を 1 つ以上要求する。黒い静止画を下のトラックへ敷く（白の検出に影響しない）
  await mkdir(path.join(project, 'assets'), { recursive: true });
  spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=black:s=1920x1080', '-frames:v', '1',
    path.join(project, 'assets', 'black.png')]);
  saved.sources = [{ id: 'black', path: 'assets/black.png' }];
  saved.tracks.unshift({ id: 'bg', lane: 'visual', name: 'BG', items: [{ id: 'bg-1', at: 0, duration: 150,
    source: { kind: 'media', src: 'black', in: 0, out: 5 } }] });
  await writeFile(editPath, `${JSON.stringify(saved, null, 2)}\n`);
  const home = path.join(scratch, 'akari-home');
  await mkdir(home, { recursive: true });
  await mkdir(path.join(project, 'exports'), { recursive: true });
  const mp4 = path.join(project, 'exports', 'shape-c-osr.mp4');
  const command = spawnSync(process.execPath, [path.join(repo, 'packages/render-cut/bin/render-cut.mjs'), project,
    '--out', mp4, '--engine', 'osr', '--scale-to', '640x360', '--preview', 'off', '--no-verify-blank', '--force'],
  { cwd: repo, env: { ...process.env, AKARI_HOME: home, AKARI_OSR_ELECTRON: '', THEIA_CONFIG_DIR: path.join(scratch, 'config') },
    encoding: 'utf8', maxBuffer: 20_000_000, timeout: 600000 });
  const report = { commandExit: command.status, stdout: clean(command.stdout ?? '').slice(-3000),
    stderr: clean(command.stderr ?? '').slice(-3000), shapeC: findItem(saved, 'shape-c'), frames: [] };
  if (command.status === 0) for (const frame of C_FRAMES) {
    const preview = whiteBounds(rgb(path.join(outDir, `${label}-c-preview-${frame}.png`)));
    const rendered = whiteBounds(rgb(mp4, frame / FPS));
    const reopened = whiteBounds(rgb(path.join(outDir, `${label}-c-reopen-${frame}.png`)));
    report.frames.push({ frame, preview, reopened, rendered,
      delta: preview && rendered ? { x: +(rendered.x - preview.x).toFixed(2), y: +(rendered.y - preview.y).toFixed(2) } : null,
      deltaReopened: reopened && rendered ? { x: +(rendered.x - reopened.x).toFixed(2), y: +(rendered.y - reopened.y).toFixed(2) } : null });
    spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-ss', String(frame / FPS), '-i', mp4, '-frames:v', '1',
      path.join(outDir, `${label}-c-osr-${frame}.png`)]);
  }
  const deltas = report.frames.flatMap(f => [f.delta, f.deltaReopened]).filter(Boolean);
  report.maxAbsDeltaPx = deltas.length ? Math.max(...deltas.flatMap(d => [Math.abs(d.x), Math.abs(d.y)])) : null;
  await writeFile(path.join(outDir, `${label}-export.json`), `${JSON.stringify(report, null, 2)}\n`);
  await rm(scratch, { recursive: true, force: true });
  console.log(JSON.stringify({ exportExit: command.status, maxAbsDeltaPx: report.maxAbsDeltaPx }));
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
const seekItem = (id, frame) => seek(baseOf(id) + frame / FPS);
async function stageRect() {
  const inner = await pv(`(() => { const r = document.getElementById('preview-stage').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`);
  const host = await evaluate(main, `(() => { const f = [...document.querySelectorAll('iframe')].filter(f => /webview/.test(f.src || '')).map(f => f.getBoundingClientRect()).filter(r => r.width > 100 && r.height > 100).sort((a, b) => b.width * b.height - a.width * a.height)[0]; return f ? { x: f.x, y: f.y, w: f.width, h: f.height } : null; })()`);
  return { x: host.x + inner.x, y: host.y + inner.y, w: inner.w, h: inner.h };
}
async function stageShot(name) {
  const rect = await stageRect();
  const dpr = await evaluate(main, 'window.devicePixelRatio');
  const { data } = await main.send('Page.captureScreenshot', { format: 'png', clip: { x: rect.x, y: rect.y, width: rect.w, height: rect.h, scale: W / rect.w / dpr } });
  await writeFile(path.join(outDir, `${label}-${name}.png`), Buffer.from(data, 'base64'));
}
async function mouse(type, pt, buttons = 0) {
  await main.send('Input.dispatchMouseEvent', { type, x: pt.x, y: pt.y, button: type === 'mouseMoved' && !buttons ? 'none' : 'left', buttons, clickCount: type === 'mouseMoved' ? 0 : 1 });
}
async function key(keyName, code, vk, modifiers = 0, commands) {
  await main.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: keyName, code, windowsVirtualKeyCode: vk, modifiers, ...(commands ? { commands } : {}) });
  await main.send('Input.dispatchKeyEvent', { type: 'keyUp', key: keyName, code, windowsVirtualKeyCode: vk, modifiers });
}
// 見えている位置（出力の中心原点の px）・大きさ・不透明度
async function visible(id) {
  const inner = await pv(`(() => { const host = document.querySelector('[data-overlay-id="${id}"]');
    const e = host?.querySelector('svg, img, video') ?? host; const stage = document.getElementById('preview-stage');
    if (!e || !stage) return null; const r = e.getBoundingClientRect(), s = stage.getBoundingClientRect();
    let opacity = 1; for (let n = e; n && n !== stage; n = n.parentElement) opacity *= Number(getComputedStyle(n).opacity);
    return { x: r.x-s.x+r.width/2, y: r.y-s.y+r.height/2, w: r.width, h: r.height, stageW: s.width, stageH: s.height, opacity }; })()`);
  if (!inner) return null;
  const stage = await stageRect();
  const k = 1920 / inner.stageW;
  return { output: { x: round(inner.x * k - 960), y: round(inner.y * 1080 / inner.stageH - 540) },
    size: { w: round(inner.w * k), h: round(inner.h * k) }, opacity: round(inner.opacity),
    page: { x: stage.x + inner.x, y: stage.y + inner.y } };
}
async function historyCount() {
  try { return (await readdir(path.join(project, '.akari', 'history'))).length; } catch { return 0; }
}
// 1 回の操作: 書き込み回数（履歴の増分）・前後の edit・undo 1 回で元に戻るか・redo で戻せるか
async function operation(id, name, frame, act) {
  await seekItem(id, frame);
  const beforeText = await readEditText();
  const beforeHistory = await historyCount();
  const beforeVisible = await visible(id);
  const detail = await act();
  for (let n = 0; n < 40 && await readEditText() === beforeText; n++) await sleep(200);
  await sleep(1500);
  const afterText = await readEditText();
  const writes = await historyCount() - beforeHistory;
  const afterVisible = await visible(id);
  await stageShot(`${name}-after`);
  // 戻らない: 別の時刻へ行って戻っても見えている値が変わらない
  await seekItem(id, 0); await seekItem(id, frame);
  const reseekVisible = await visible(id);
  const item = findItem(JSON.parse(afterText), id);
  const expectedPose = item ? evaluatedItemTransform(item, frame) : null;
  const beforeItem = findItem(JSON.parse(beforeText), id);
  // undo 1 回 → 前の edit / redo → 後の edit
  await evaluate(main, `(() => { document.activeElement?.blur?.(); return true; })()`);
  await key('z', 'KeyZ', 90, 4, ['undo']);
  for (let n = 0; n < 30 && await readEditText() === afterText; n++) await sleep(200);
  await sleep(600);
  const undoneText = await readEditText();
  const undoRestored = JSON.stringify(JSON.parse(undoneText)) === JSON.stringify(JSON.parse(beforeText));
  await key('z', 'KeyZ', 90, 4 | 8, ['redo']);
  for (let n = 0; n < 30 && await readEditText() === undoneText; n++) await sleep(200);
  await sleep(600);
  const redoText = await readEditText();
  const redoRestored = JSON.stringify(JSON.parse(redoText)) === JSON.stringify(JSON.parse(afterText));
  // redo で戻らなかったときは後の edit を書き戻して続ける（外からの書き換え = アプリが読み直す）
  if (!redoRestored) { await writeFile(editPath, afterText); await sleep(2500); }
  const points = realPoints(item);
  const seat = points.find(p => p.t === frame) ?? null;
  return { name, frame, detail, writes, beforeVisible, afterVisible, reseekVisible,
    noRevert: afterVisible && reseekVisible ? Math.hypot(afterVisible.output.x - reseekVisible.output.x, afterVisible.output.y - reseekVisible.output.y) <= 1.5
      && Math.abs(afterVisible.size.w - reseekVisible.size.w) <= 1.5 : null,
    pointAtFrame: seat, pointTimes: points.map(p => p.t),
    staticBefore: beforeItem?.transform ?? null, staticAfter: item?.transform ?? null,
    evaluatedAtFrame: expectedPose, undoRestored, redoRestored };
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
  for (let n = 0; n < 30 && await readEditText() === beforeText; n++) await sleep(200);
  await sleep(900);
  const after = await evaluate(main, `(() => { const b = document.querySelector('[data-akari-ui="inspector-kf-seat:${field}"]');
    return b ? { pressed: b.getAttribute('aria-pressed'), title: b.title } : null; })()`);
  return { pressed, after, writes: await historyCount() - beforeHistory, item: findItem(await readEdit(), id) };
}
async function setInspectorField(id, frame, field, value) {
  await seekItem(id, frame);
  await focusItem(id);
  const beforeHistory = await historyCount();
  const beforeText = await readEditText();
  const changed = await evaluate(main, `(() => {
    const row = document.querySelector('[data-akari-ui="field:inspector-${field}"]');
    const input = row?.matches('input') ? row : row?.querySelector('input:not([type=range])') ?? row?.querySelector('input');
    if (!input) return { found: false };
    input.focus(); input.value = ${JSON.stringify(String(value))};
    input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true }));
    input.dispatchEvent(new Event('blur', { bubbles: true })); input.blur(); return { found: true, type: input.type }; })()`);
  for (let n = 0; n < 30 && await readEditText() === beforeText; n++) await sleep(200);
  await sleep(900);
  return { changed, writes: await historyCount() - beforeHistory, item: findItem(await readEdit(), id) };
}
async function handleCenter(selector) {
  const rect = await stageRect();
  const found = await pv(`(() => { const s = document.getElementById('preview-stage').getBoundingClientRect();
    const e = [...document.querySelectorAll(${JSON.stringify(selector)})].find(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).display !== 'none'; });
    if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x - s.x + r.width / 2, y: r.y - s.y + r.height / 2 }; })()`);
  return found ? { x: rect.x + found.x, y: rect.y + found.y } : null;
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
// 図形を選ぶ（止まったクリック = 書き込みなし）
async function selectOnStage(id) {
  const v = await visible(id);
  if (!v) return false;
  await mouse('mouseMoved', v.page); await mouse('mousePressed', v.page, 1); await sleep(60); await mouse('mouseReleased', v.page);
  await sleep(500);
  return pv(`Boolean(document.querySelector('.akari-interaction-handle.is-se'))`);
}
async function dragBody(id, dx, dy) {
  const v = await visible(id);
  const rect = await stageRect();
  const move = await handleCenter('.akari-interaction-action.is-move');
  const start = move ?? v.page;
  await drag(start, { x: start.x + dx * rect.w / 1920, y: start.y + dy * rect.h / 1080 });
}

const results = {};
async function scenario(name, fn) {
  try { results[name] = await fn(); } catch (e) { results[name] = { error: clean(e?.stack ?? e).slice(0, 1600) }; }
}
async function runScenarios() {
  report.inspectorOpen = await command('akari.inspector.open'); await sleep(900);

  // ---- A: 位置が動きを持つ図形で、キーフレームの無い時刻の操作 ----
  await scenario('A', async () => {
    const id = 'shape-a';
    const seat = await pressSeat(id, 120, 'transform-x');
    await seekItem(id, 20); await selectOnStage(id);
    const firstDrag = await operation(id, 'a-drag-20', 20, async () => dragBody(id, 300, 120));
    const ops = [];
    ops.push(await operation(id, 'a-resize-60', 60, async () => {
      await selectOnStage(id);
      const se = await handleCenter('.akari-interaction-handle.is-se');
      if (!se) return { handle: null };
      const rect = await stageRect();
      await drag(se, { x: se.x + 90 * rect.w / 1920, y: se.y + 90 * rect.h / 1080 });
      return { handle: 'is-se' };
    }));
    ops.push(await operation(id, 'a-rotate-90', 90, async () => {
      await selectOnStage(id);
      const v = await visible(id);
      const handle = await handleCenter('.akari-interaction-action.is-rotate');
      if (!handle || !v) return { handle: null };
      const cx = v.page.x, cy = v.page.y;
      const r0 = Math.hypot(handle.x - cx, handle.y - cy), a0 = Math.atan2(handle.y - cy, handle.x - cx);
      await drag(handle, u => ({ x: cx + r0 * Math.cos(a0 - u * Math.PI / 6), y: cy + r0 * Math.sin(a0 - u * Math.PI / 6) }), 16);
      return { handle: 'is-rotate', degrees: -30 };
    }));
    ops.push(await operation(id, 'a-nudge-45', 45, async () => {
      await selectOnStage(id);
      for (let n = 0; n < 3; n++) { await key('ArrowRight', 'ArrowRight', 39); await sleep(60); }
      for (let n = 0; n < 2; n++) { await key('ArrowDown', 'ArrowDown', 40); await sleep(60); }
      await sleep(700); // 400ms のまとめ書き
      return { keys: 'ArrowRight×3 ArrowDown×2', expectedDelta: { x: 3, y: 2 } };
    }));
    // コンテキストバー（バーの run() と同じ入口 = akari.contextBar.run）
    const bar = async (request) => command('akari.contextBar.run', { editUri, ...request });
    ops.push(await operation(id, 'a-bar-align-100', 100, async () => {
      await focusItem(id);
      return { request: { action: 'nudge', dx: 40, dy: -30 }, result: await bar({ action: 'nudge', dx: 40, dy: -30 }) };
    }));
    ops.push(await operation(id, 'a-bar-x-110', 110, async () => {
      await focusItem(id);
      return { request: { action: 'write', path: 'transform.x', value: -150 },
        result: await bar({ action: 'write', path: 'transform.x', value: -150 }) };
    }));
    ops.push(await operation(id, 'a-bar-resize-130', 130, async () => {
      await focusItem(id);
      return { request: { action: 'resize', width: 300, keepRatio: true },
        result: await bar({ action: 'resize', width: 300, keepRatio: true }) };
    }));
    const final = findItem(await readEdit(), id);
    return { seat: { ...seat, item: undefined, points: realPoints(seat.item) }, firstDrag, ops,
      finalPoints: realPoints(final), finalStatic: final.transform,
      everyPointHasXY: realPoints(final).filter(p => p.transform).every(p => Number.isFinite(p.transform.x) && Number.isFinite(p.transform.y)) };
  });

  // ---- B: 大きさ・不透明度のまとまり、タイムラインの点の削除 ----
  await scenario('B', async () => {
    const id = 'shape-b';
    const sizeSeat = await pressSeat(id, 10, 'transform-scale');
    const opacitySeat = await pressSeat(id, 10, 'opacity');
    const scale = await setInspectorField(id, 100, 'transform-scale', 150);
    const opacity = await setInspectorField(id, 100, 'opacity', 30);
    const samples = [];
    for (const frame of [0, 10, 55, 100, 140]) {
      await seekItem(id, frame);
      const v = await visible(id);
      const item = findItem(await readEdit(), id);
      samples.push({ frame, visible: v, evaluated: { scale: evaluatedItemTransform(item, frame).scale, opacity: evaluatedItemOpacity(item, frame) } });
      await stageShot(`b-${frame}`);
    }
    const beforeDelete = findItem(await readEdit(), id);
    // タイムラインの点の削除: インスペクターの「…」→ タイムラインのキーフレーム行を開く → t=100 の◆を選んで Delete
    await seekItem(id, 100); await focusItem(id);
    const reveal = await evaluate(main, `(async () => { const more = document.querySelector('[data-akari-ui="inspector-kf-more:transform-scale"]');
      if (!more) return { more: false }; more.click(); await new Promise(r => setTimeout(r, 400));
      const jump = document.querySelector('[data-akari-ui="inspector-kf-jump:transform-scale"]'); if (!jump) return { more: true, jump: false };
      jump.click(); await new Promise(r => setTimeout(r, 1200)); return { more: true, jump: true }; })()`);
    const diamonds = await evaluate(main, `(() => [...document.querySelectorAll('[data-akari-keyframe-item="${id}"]')].map(e => ({ t: e.dataset.akariKeyframeT, property: e.dataset.akariKeyframeProperty, endpoint: e.dataset.akariKeyframeEndpoint })))()`);
    const clicked = await evaluate(main, `(() => { const e = [...document.querySelectorAll('[data-akari-keyframe-item="${id}"][data-akari-keyframe-t="100"]')].find(e => e.getBoundingClientRect().width > 0);
      if (!e) return false; e.scrollIntoView({ block: 'nearest' }); const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, property: e.dataset.akariKeyframeProperty }; })()`);
    const beforeHistory = await historyCount();
    const beforeText = await readEditText();
    if (clicked) {
      await mouse('mouseMoved', clicked); await mouse('mousePressed', clicked, 1); await sleep(60); await mouse('mouseReleased', clicked); await sleep(500);
      await key('Delete', 'Delete', 46);
    }
    for (let n = 0; n < 30 && await readEditText() === beforeText; n++) await sleep(200);
    await sleep(900);
    const afterDelete = findItem(await readEdit(), id);
    const deleteWrites = await historyCount() - beforeHistory;
    await seekItem(id, 100);
    const visibleAfterDelete = await visible(id);
    // タイムラインの注目範囲から出る
    await evaluate(main, `(() => { document.activeElement?.blur?.(); return true; })()`);
    await key('Escape', 'Escape', 27);
    return { sizeSeat: { ...sizeSeat, item: undefined, points: realPoints(sizeSeat.item), static: sizeSeat.item.transform },
      opacitySeat: { ...opacitySeat, item: undefined, points: realPoints(opacitySeat.item), static: opacitySeat.item.opacity },
      scale: { ...scale, item: undefined, points: realPoints(scale.item) },
      opacity: { ...opacity, item: undefined, points: realPoints(opacity.item) }, samples,
      timelineDelete: { reveal, diamonds, clicked, writes: deleteWrites,
        pointsBefore: realPoints(beforeDelete), pointsAfter: realPoints(afterDelete), keyframesAfter: afterDelete.keyframes ?? null,
        staticAfter: { transform: afterDelete.transform, opacity: afterDelete.opacity }, visibleAfterDelete } };
  });

  // ---- C: 点が 1 つ（+ 空の相方）の図形。プレビューを撮って --export で OSR と比べる ----
  await scenario('C', async () => {
    const id = 'shape-c';
    const seat = await pressSeat(id, 50, 'transform-x');
    await seekItem(id, 50); await selectOnStage(id);
    const moved = await operation(id, 'c-drag-50', 50, async () => dragBody(id, 260, -140));
    const item = findItem(await readEdit(), id);
    // 選択の枠を外してから撮る
    await pv(`(() => { window.akari?.clearPreviewSelection?.(); return true; })()`).catch(() => {});
    await evaluate(main, `(() => { document.activeElement?.blur?.(); return true; })()`);
    await key('Escape', 'Escape', 27); await sleep(400);
    const frames = [];
    for (const frame of C_FRAMES) {
      await seekItem(id, frame);
      frames.push({ frame, visible: await visible(id), evaluated: evaluatedItemTransform(item, frame) });
      await stageShot(`c-preview-${frame}`);
    }
    return { seat: { ...seat, item: undefined, keyframes: seat.item.keyframes }, moved, keyframes: item.keyframes, static: item.transform, frames };
  });
  results.finalEdit = await readEdit();
}
async function reopenedFrames() {
  const rows = [];
  await pv(`(() => { window.akari?.clearPreviewSelection?.(); return true; })()`).catch(() => {});
  for (const frame of C_FRAMES) {
    await seekItem('shape-c', frame);
    await sleep(800);
    rows.push({ frame, visible: await visible('shape-c') });
    await stageShot(`c-reopen-${frame}`);
  }
  return rows;
}

// ---- launch --------------------------------------------------------------------------------
const report = { label, port };
const reopen = process.argv.includes('--reopen');
try {
  await mkdir(outDir, { recursive: true });
  try { await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1000) });
    throw new Error(`CDP port ${port} already occupied`); } catch (error) { if (String(error).includes('already occupied')) throw error; }
  await makeFixture();
  if (reopen) await writeFile(editPath, await readFile(path.join(outDir, `${label}-final-edit.json`), 'utf8'));
  const profile = path.join(scratch, 'profile'), config = path.join(scratch, 'config'), home = path.join(scratch, 'akari-home');
  await Promise.all([mkdir(profile), mkdir(config), mkdir(home)]);
  child = spawn(electron, [shellDir, project, `--remote-debugging-port=${port}`, '--hostname=127.0.0.1', '--port=48961',
    `--user-data-dir=${profile}`, '--no-sandbox'], { cwd: shellDir, env: { ...process.env, THEIA_CONFIG_DIR: config, AKARI_HOME: home }, stdio: 'ignore', detached: true });
  const isShell = v => v.type === 'page' && v.url && !v.url.startsWith('devtools:');
  const target = (await waitForJson(`http://127.0.0.1:${port}/json/list`, v => v.find(isShell))).find(isShell);
  main = new CDP(target.webSocketDebuggerUrl); await main.connect(); track(main); await main.send('Runtime.enable'); await main.send('Page.enable');
  const version = await waitForJson(`http://127.0.0.1:${port}/json/version`, v => v.webSocketDebuggerUrl);
  browser = new CDP(version.webSocketDebuggerUrl); await browser.connect(); track(browser);
  await browser.send('Target.setDiscoverTargets', { discover: true }).catch(() => {});
  try { const { windowId } = await browser.send('Browser.getWindowForTarget', { targetId: target.id });
    await browser.send('Browser.setWindowBounds', { windowId, bounds: { left: 0, top: 0, width: 1680, height: 1040, windowState: 'normal' } }); } catch {}
  await sleep(9000);
  const openOnly = () => evaluate(main, `(() => { const b = [...document.querySelectorAll('button')].find(e => ['開くだけ', '後で'].includes(e.textContent?.trim())); if (b) b.click(); return !!b; })()`);
  const soft = (id, value) => Promise.race([command(id, value).catch(e => ({ ok: false, error: String(e) })), sleep(5000).then(() => ({ ok: false, error: 'pending' }))]);
  for (let i = 0; i < 50; i++) { await openOnly().catch(() => {}); report.timelineOpen = await soft('akari.annotations.open'); if (report.timelineOpen.ok) break; await sleep(1600); }
  for (let i = 0; i < 40 && !view; i++) { await openOnly().catch(() => {}); await soft('akari.preview.ensureVisible', { editUri }); await sleep(2600); view = await findPreview(12000); }
  if (!view) throw new Error('preview not found');
  for (let i = 0; i < 40; i++) { if (await pv(`Number(document.getElementById('seek')?.max || 0) >= 14`).catch(() => false)) break; await sleep(500); }
  if (reopen) results.reopened = await reopenedFrames();
  else await runScenarios();
} catch (e) { report.error = clean(e?.stack ?? e); }
finally {
  main?.close(); browser?.close();
  if (child?.pid) { try { process.kill(-child.pid, 'SIGTERM'); } catch {} await sleep(1800); try { process.kill(-child.pid, 'SIGKILL'); } catch {} }
  const owned = spawnSync('ps', ['-axo', 'pid=,command='], { encoding: 'utf8' }).stdout ?? '';
  for (const line of owned.split('\n')) {
    if (!line.includes(scratch) || !line.includes('Electron Helper')) continue;
    const pid = Number(line.trim().split(/\s+/)[0]);
    if (Number.isInteger(pid) && pid > 0) try { process.kill(pid, 'SIGKILL'); } catch {}
  }
}
report.results = results;
report.consoleErrors = [...new Set(consoleErrors.map(clean))].slice(-20);
if (results.finalEdit) { await writeFile(path.join(outDir, `${label}-final-edit.json`), `${JSON.stringify(results.finalEdit, null, 2)}\n`); delete results.finalEdit; }
await writeFile(path.join(outDir, reopen ? `${label}-reopened.json` : `${label}.json`), `${clean(JSON.stringify(report, null, 2))}\n`);
if (!process.argv.includes('--keep')) await rm(scratch, { recursive: true, force: true });
console.log(JSON.stringify({ label, reopen, error: report.error ?? null, scenarios: Object.keys(results) }));
