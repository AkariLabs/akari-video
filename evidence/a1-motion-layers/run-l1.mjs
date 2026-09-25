#!/usr/bin/env node
// L1（検証専用・ラッパー作成）: 動きの 3 系統の重ね方を本物の Electron シェルと書き出し（osr / gpu）で確かめる。
//   a. 位置のキーフレーム（左 → 右）+ 登場「下からスライド」→ 登場の間は下から来つつ左 → 右（足し算）
//   b. 不透明度 0.5 + フェード → 最大 0.5（掛け算）
//   c. キャンバスに「拡大」の動き → 中の全部が一緒に
//   d. 再生して止めても edit.json が変わらない（ハッシュ比較）
//   e. 動きが効いている要素をドラッグして離しても跳ねない
//   f. 動きを描く → X・Y のキーフレームができる → 書き出しとプレビューが一致・undo 1 回
// 使い方: node evidence/a1-motion-layers/run-l1.mjs --shell <apps/shell> --out <dir> [--label after]
// 呼び出し側が heavy-slot の枠を持つこと。一時ディレクトリ・ポートはこの票専用。
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : fallback; };
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const shellDir = path.resolve(arg('shell', path.join(repo, 'apps/shell')));
const outDir = path.resolve(arg('out', path.join(repo, 'evidence/a1-motion-layers/after')));
const label = arg('label', 'after');
const only = (arg('only', '') || '').split(',').filter(Boolean);
const port = Number(process.env.AKARI_CDP_PORT ?? 9559);
const electron = path.join(shellDir, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
const ffmpeg = process.env.FFMPEG ?? 'ffmpeg';
const W = 640, H = 360, FPS = 30;

const scratch = await realpath(await mkdtemp('/tmp/libcanvas-a1-motion-layers-l1-'));
const project = path.join(scratch, 'project');
const editPath = path.join(project, 'edit.json');
const editUri = pathToFileURL(editPath).href;
const clean = v => String(v).replaceAll(repo, '<repo>').replaceAll(scratch, '<scratch>').replace(/\/Users\/[^\s"')]+/g, '<local>')
  .replace(/\/(private\/)?(tmp|var)\/[^\s"')]+/g, '<tmp>');
const run = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 1 << 28, ...opts });

// ---- fixture -----------------------------------------------------------------------------
// 色の決まった正方形の写真 4 枚 + 暗い下地。座標は出力 px（中心が 0）。
const COLORS = { bg: '0x202020', red: '0xff0000', green: '0x00ff00', blue: '0x0000ff', yellow: '0xffff00' };
const EDIT = {
  version: 2,
  output: { width: W, height: H, fps: FPS },
  sources: [
    { id: 'bg', path: 'assets/bg.png' }, { id: 'red', path: 'assets/red.png' }, { id: 'green', path: 'assets/green.png' },
    { id: 'blue', path: 'assets/blue.png' }, { id: 'yellow', path: 'assets/yellow.png' }
  ],
  tracks: [
    { id: 'v-bg', lane: 'visual', name: 'Base', items: [
      { id: 'bg', at: 0, duration: 12 * FPS, source: { kind: 'media', src: 'bg', in: 0, out: 12 } }] },
    { id: 'v-a', lane: 'visual', name: 'V1', items: [
      // a: 位置のキーフレーム 左 → 右（0〜4 秒）+ 登場「下からスライド」1 秒・量 100
      { id: 'a-red', at: 0, duration: 4 * FPS, source: { kind: 'media', src: 'red', in: 0, out: 4 },
        transform: { x: -200, y: 0, scale: 0.25 },
        keyframes: [{ t: 0, transform: { x: -200 } }, { t: 4 * FPS, transform: { x: 200 } }],
        motion: { in: { preset: 'slide-up', duration: FPS, amount: 100 } } },
      // b: 不透明度 0.5 + フェード 1 秒（4〜8 秒）
      { id: 'b-green', at: 4 * FPS, duration: 4 * FPS, source: { kind: 'media', src: 'green', in: 0, out: 4 },
        transform: { x: -150, y: 0, scale: 0.25 }, opacity: 0.5,
        motion: { in: { preset: 'fade', duration: FPS } } },
      // c: キャンバス（8〜12 秒）に「拡大」（scale）の登場 1 秒・量 0.5。中に 2 枚
      { id: 'c-canvas', name: 'キャンバス 1', at: 8 * FPS, duration: 4 * FPS,
        source: { kind: 'group', canvas: { origin: 'user', durationMode: 'fixed' } },
        motion: { in: { preset: 'scale', duration: FPS, amount: 0.5 } },
        items: [
          { id: 'c-blue', at: 0, duration: 4 * FPS, source: { kind: 'media', src: 'blue', in: 0, out: 4 }, transform: { x: -120, y: 0, scale: 0.25 } },
          { id: 'c-yellow', at: 0, duration: 4 * FPS, source: { kind: 'media', src: 'yellow', in: 0, out: 4 }, transform: { x: 120, y: 0, scale: 0.25 } }
        ] }
    ] }
  ]
};

async function makeFixture() {
  await mkdir(path.join(project, 'assets'), { recursive: true });
  await mkdir(path.join(project, '.akari'), { recursive: true });
  for (const [name, color] of Object.entries(COLORS)) {
    const size = name === 'bg' ? `${W}x${H}` : '360x360';
    const r = run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-f', 'lavfi', '-i', `color=c=${color}:s=${size}:d=1`,
      '-frames:v', '1', path.join(project, 'assets', `${name}.png`)]);
    if (r.status !== 0) throw new Error(`ffmpeg ${name}: ${r.stderr}`);
  }
  await writeFile(editPath, `${JSON.stringify(EDIT, null, 2)}\n`);
  await writeFile(path.join(project, '.akari', 'lint.json'), '{"version":1,"verdict":"pass"}\n');
  for (const a of [['init', '-q'], ['config', 'user.email', 'l1@localhost'], ['config', 'user.name', 'l1'], ['add', '-A'], ['commit', '-q', '-m', 'fixture']]) {
    const r = run('/usr/bin/git', a, { cwd: project });
    if (r.status !== 0) throw new Error(`git ${a[0]}: ${r.stderr}`);
  }
}

// ---- 画素の計測（PNG / 動画のフレーム → 出力 px の rgb24）------------------------------------
function rgbOf(file, seconds) {
  const input = seconds === undefined ? ['-i', file] : ['-ss', String(seconds), '-i', file, '-frames:v', '1'];
  const r = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', ...input, '-vf', `scale=${W}:${H}:flags=area`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'],
    { maxBuffer: W * H * 4 });
  if (r.status !== 0 || r.stdout.length !== W * H * 3) throw new Error(`decode ${path.basename(file)} ${seconds ?? ''}: ${r.stderr}`);
  return r.stdout;
}
// プレビューの撮影は画面の色空間（Display P3）に変換されて R・B が持ち上がるので、差で判定する（書き出しの sRGB でも同じ判定で通る）
const MATCH = {
  red: ([r, g, b]) => r > 110 && g < 70 && b < 70,
  green: ([r, g, b]) => g > 70 && g - r > 40 && g - b > 40,
  blue: ([r, g, b]) => b > 110 && r < 70 && g < 70,
  yellow: ([r, g, b]) => r > 110 && g > 110 && b < 110 && r - b > 60
};
function measure(buf, color) {
  let n = 0, sx = 0, sy = 0, x0 = W, y0 = H, x1 = -1, y1 = -1, gs = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 3, p = [buf[i], buf[i + 1], buf[i + 2]];
    if (!MATCH[color](p)) continue;
    n++; sx += x; sy += y; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    if (color === 'green') gs.push(p[1]);
  }
  if (!n) return null;
  const r2 = v => Math.round(v * 100) / 100;
  gs.sort((a, b) => a - b);
  return { pixels: n, center: { x: r2(sx / n + 0.5 - W / 2), y: r2(sy / n + 0.5 - H / 2) },
    box: { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 },
    ...(color === 'green' ? { medianG: gs[gs.length >> 1], alphaEstimate: r2((gs[gs.length >> 1] - 0x20) / (255 - 0x20)) } : {}) };
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
      const timer = setTimeout(() => { if (this.pending.delete(id)) reject(new Error(`CDP ${method} timed out`)); }, 30000);
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
const sha = text => createHash('sha256').update(text).digest('hex');
const readEditText = () => readFile(editPath, 'utf8');
const findItem = (edit, id) => { const walk = items => { for (const it of items ?? []) { if (it.id === id) return it; const c = walk(it.items); if (c) return c; } }; for (const t of edit.tracks) { const f = walk(t.items); if (f) return f; } };
const INSPECTOR = `document.querySelector('[data-akari-ui="panel:inspector"]')`;
async function undoOnce() {
  const before = await readEditText();
  await evaluate(main, `(() => { const e = document.activeElement; if (e && e !== document.body) e.blur(); return true; })()`);
  await main.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90, modifiers: 4, commands: ['undo'] });
  await main.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90, modifiers: 4 });
  for (let i = 0; i < 30 && (await readEditText()) === before; i++) await sleep(200);
  await sleep(800);
}
const headText = () => run('/usr/bin/git', ['show', 'HEAD:edit.json'], { cwd: project }).stdout;

const results = {};
async function scenario(name, fn) {
  if (only.length && !only.includes(name)) return;
  try { results[name] = await fn(); } catch (e) { results[name] = { error: clean(e?.stack ?? e).slice(0, 1500) }; }
}
// 期待値（契約の式: 位置 = キーフレーム + 登場のずれ、不透明度 = 静的 × フェード、キャンバスの拡縮 = 子の位置と大きさに掛かる）
const expectA = t => { const u = Math.min(1, t / 1); return { x: -200 + 400 * (t / 4), y: (1 - u) * 100 }; };
const TIMES = { a: [0.25, 0.5, 2], b: [4.25, 4.5, 6], c: [8.25, 8.5, 10] };

async function previewScenarios() {
  await scenario('a-keyframes-plus-slide', async () => {
    const rows = [];
    for (const t of TIMES.a) { await seek(t); const shot = await stageShot(`a-${t}`); rows.push({ t, expected: expectA(t), measured: measure(rgbOf(shot), 'red')?.center }); }
    return rows;
  });
  await scenario('b-opacity-times-fade', async () => {
    const rows = [];
    for (const t of TIMES.b) { await seek(t); const shot = await stageShot(`b-${t}`); const m = measure(rgbOf(shot), 'green');
      rows.push({ t, expectedAlpha: 0.5 * Math.min(1, (t - 4) / 1), measuredAlpha: m?.alphaEstimate ?? 0, medianG: m?.medianG ?? null }); }
    return rows;
  });
  await scenario('c-canvas-scale', async () => {
    const rows = [];
    for (const t of TIMES.c) { await seek(t); const shot = await stageShot(`c-${t}`); const buf = rgbOf(shot);
      const s = 1 - 0.5 * (1 - Math.min(1, (t - 8) / 1));
      rows.push({ t, expectedScale: s, expectedCenters: { blue: -120 * s, yellow: 120 * s },
        blue: measure(buf, 'blue'), yellow: measure(buf, 'yellow') }); }
    return rows;
  });
  await scenario('d-playback-no-write', async () => {
    const before = sha(await readEditText());
    await seek(0);
    const play = await command('akari.preview.play', { editUri });
    await sleep(3000);
    const playing = await pv(`Number(document.getElementById('seek')?.value)`);
    const pause = await command('akari.preview.pause', { editUri });
    await sleep(800);
    for (const t of [9, 1, 5.5, 8.4]) await seek(t);
    await sleep(1500);
    const after = sha(await readEditText());
    return { play, pause, playheadAfter3s: playing, before, after, unchanged: before === after, equalHead: (await readEditText()) === headText() };
  });
  await scenario('e-drag-no-jump', async () => {
    const t = Number(process.env.L1_DRAG_T ?? 0.5);
    await seek(t);
    const shot0 = await stageShot('e-before');
    const m0 = measure(rgbOf(shot0), 'red');
    const rect = await stageRect();
    const start = toPage(rect, m0.center), dx = 80;
    await mouse('mouseMoved', start); await sleep(100);
    await mouse('mousePressed', start, 1); await sleep(150);
    for (let i = 1; i <= 10; i++) { await mouse('mouseMoved', toPage(rect, { x: m0.center.x + dx * i / 10, y: m0.center.y }), 1); await sleep(40); }
    await sleep(400);
    const midShot = await stageShot('e-during-drag');
    const mid = measure(rgbOf(midShot), 'red');
    const textBefore = await readEditText();
    await mouse('mouseReleased', toPage(rect, { x: m0.center.x + dx, y: m0.center.y }));
    for (let i = 0; i < 30 && (await readEditText()) === textBefore; i++) await sleep(200);
    await sleep(1500);
    const shot1 = await stageShot('e-after-release');
    const m1 = measure(rgbOf(shot1), 'red');
    const written = findItem(JSON.parse(await readEditText()), 'a-red');
    // 同じ時刻で見直す（書いた後にもう一度シーク）
    await seek(t);
    const m2 = measure(rgbOf(await stageShot('e-after-reseek')), 'red');
    await undoOnce();
    const undoEqualHead = (await readEditText()) === headText();
    return { t, before: m0.center, duringDrag: mid?.center, afterRelease: m1?.center, afterReseek: m2?.center,
      expectedAfter: { x: m0.center.x + dx, y: m0.center.y },
      jumpOnRelease: mid && m1 ? { x: m1.center.x - mid.center.x, y: m1.center.y - mid.center.y } : null,
      writtenTransform: written?.transform, writtenKeyframes: written?.keyframes, undoEqualHead };
  });
  await scenario('f-draw-motion', async () => {
    const t = 5;
    await seek(t);
    const shot0 = await stageShot('f-before');
    const m0 = measure(rgbOf(shot0), 'green');
    const focus = await command('akari.timeline.focusItem', { itemId: 'b-green', reveal: true });
    await sleep(1500);
    const inspectorOpen = await command('akari.inspector.open');
    await sleep(1200);
    const tab = await evaluate(main, `(() => { const b = ${INSPECTOR}?.querySelector('[data-akari-ui="tab:inspector-motion"]'); if (!b || b.disabled) return false; b.click(); return true; })()`);
    await sleep(1000);
    const shelf = await evaluate(main, `(() => { const root = ${INSPECTOR}; if (!root) return null; const text = n => (n?.textContent ?? '').replace(/\\s+/g, ' ').trim();
      return { sections: [...root.querySelectorAll('[data-akari-ui^="section:inspector-"]')].map(s => ({ ui: s.getAttribute('data-akari-ui'), text: text(s).slice(0, 80) })),
        fields: [...root.querySelectorAll('[data-akari-field]')].map(r => ({ field: r.getAttribute('data-akari-field'), label: text(r.querySelector('.akari-inspector-row-label')),
          options: [...(r.querySelector('select')?.options ?? [])].map(o => o.textContent) })) }; })()`);
    await (async () => { const r = await evaluate(main, `(() => { const root = ${INSPECTOR}; const x = root?.getBoundingClientRect(); return x ? { x: x.x, y: x.y, w: x.width, h: Math.min(x.height, 1000) } : null; })()`);
      if (r) { const { data } = await main.send('Page.captureScreenshot', { format: 'png', clip: { x: r.x, y: r.y, width: r.w, height: r.h, scale: 1 } }); await writeFile(path.join(outDir, `${label}-f-inspector-motion-tab.png`), Buffer.from(data, 'base64')); } })();
    const pressed = await evaluate(main, `(() => { const row = ${INSPECTOR}?.querySelector('[data-akari-field="motion-draw"]'); const b = row?.querySelector('button'); if (!b) return false; b.click(); return true; })()`);
    await sleep(1200);
    const rect = await stageRect();
    const path0 = m0.center;
    const pts = Array.from({ length: 16 }, (_, i) => ({ x: path0.x + 200 * i / 15, y: path0.y + 60 * Math.sin(Math.PI * i / 15) }));
    const textBefore = await readEditText();
    // 診断: 離した瞬間の pointerup がどこまで届くか（window の capture・document・対象）を記録する
    await pv(`(() => { window.__l1Up = []; const log = where => e => window.__l1Up.push({ where, type: e.type, id: e.pointerId, trusted: e.isTrusted,
      target: e.target?.id || e.target?.tagName || String(e.target) });
      window.addEventListener('pointerup', log('window-capture'), true); document.addEventListener('pointerup', log('document-bubble'));
      window.addEventListener('lostpointercapture', log('lostcapture'), true); window.addEventListener('pointercancel', log('cancel'), true);
      window.addEventListener('pointerdown', log('down-window-capture'), true); return true; })()`).catch(() => false);
    await mouse('mouseMoved', toPage(rect, pts[0])); await sleep(100);
    await mouse('mousePressed', toPage(rect, pts[0]), 1); await sleep(80);
    for (const p of pts.slice(1)) { await mouse('mouseMoved', toPage(rect, p), 1); await sleep(90); }
    const drawingShot = await stageShot('f-while-drawing');
    const banner = await pv(`[...document.querySelectorAll('body *')].filter(e => e.children.length === 0 && /置き換え|描/.test(e.textContent || '') && e.getBoundingClientRect().width > 0).map(e => e.textContent.trim()).slice(0, 4)`);
    await mouse('mouseReleased', toPage(rect, pts.at(-1)));
    // 人の操作と同じく、離した後にポインタが少し動く（離したことの取りこぼしを補う確定の経路も通る）
    await sleep(150);
    const nudged = process.env.L1_NO_NUDGE ? null : await mouse('mouseMoved', toPage(rect, { x: pts.at(-1).x + 4, y: pts.at(-1).y + 4 }));
    for (let i = 0; i < 30 && (await readEditText()) === textBefore; i++) await sleep(200);
    await sleep(1500);
    const upLog = await pv(`window.__l1Up || null`).catch(e => String(e));
    const item = findItem(JSON.parse(await readEditText()), 'b-green');
    const xy = (item?.keyframes ?? []).filter(k => k.transform?.x !== undefined && k.transform?.y !== undefined);
    // 描いた後のプレビューを数時刻で撮る（書き出しと比べる）
    const preview = {};
    for (const s of [5, 5.5, 6, 7]) { await seek(s); preview[s] = measure(rgbOf(await stageShot(`f-preview-${s}`)), 'green'); }
    const drawnText = await readEditText();
    await undoOnce();
    const undoEqualHead = (await readEditText()) === headText();
    return { undoEqualHead, upLog, focus, inspectorOpen, tab, shelf, pressed, before: m0.center, drawnPath: pts, banner, drawingShot: path.basename(drawingShot),
      keyframes: item?.keyframes ?? null, xyCount: xy.length, preview, drawnSha: sha(drawnText), drawnText };
  });
}

// ---- 起動 --------------------------------------------------------------------------------
const report = { label, port, times: TIMES };
try {
  await mkdir(outDir, { recursive: true });
  await makeFixture();
  const profile = path.join(scratch, 'profile'), config = path.join(scratch, 'config'), home = path.join(scratch, 'akari-home');
  await Promise.all([mkdir(profile), mkdir(config), mkdir(home)]);
  child = spawn(electron, [shellDir, project, `--remote-debugging-port=${port}`, '--hostname=127.0.0.1', '--port=48901',
    `--user-data-dir=${profile}`, '--no-sandbox'], { cwd: shellDir, env: { ...process.env, THEIA_CONFIG_DIR: config, AKARI_HOME: home }, stdio: 'ignore', detached: true });
  report.pid = child.pid;
  const isShell = v => v.type === 'page' && v.url && !v.url.startsWith('devtools:');
  const target = (await waitForJson(`http://127.0.0.1:${port}/json/list`, v => v.find(isShell))).find(isShell);
  main = new CDP(target.webSocketDebuggerUrl); await main.connect(); track(main); await main.send('Runtime.enable'); await main.send('Page.enable');
  const version = await waitForJson(`http://127.0.0.1:${port}/json/version`, v => v.webSocketDebuggerUrl);
  browser = new CDP(version.webSocketDebuggerUrl); await browser.connect(); track(browser);
  await browser.send('Target.setDiscoverTargets', { discover: true }).catch(() => {});
  try { const { windowId } = await browser.send('Browser.getWindowForTarget', { targetId: target.id });
    await browser.send('Browser.setWindowBounds', { windowId, bounds: { left: 0, top: 0, width: 1680, height: 1040, windowState: 'normal' } }); } catch {}
  await sleep(10000);
  const clickOpenOnly = () => evaluate(main, `(() => { const b = [...document.querySelectorAll('button')].find(x => ['開くだけ', '後で'].includes(x.textContent?.trim())); if (b) b.click(); return !!b; })()`);
  // 起動直後は登録簿が未準備・「開くだけ」の確認待ちでコマンドが返らないことがある → 短い締切で投げ、確認を押しながら待つ
  const softCommand = (id, value, ms = 4000) => Promise.race([
    command(id, value).catch(e => ({ ok: false, error: String(e?.message ?? e) })),
    sleep(ms).then(() => ({ ok: false, error: 'pending' }))]);
  for (let i = 0; i < 60; i++) {
    await clickOpenOnly().catch(() => {});
    report.timelineOpen = await softCommand('akari.annotations.open');
    if (report.timelineOpen.ok) break;
    await sleep(2000);
  }
  await sleep(5000);
  const end = Date.now() + 180000;
  while (!view && Date.now() < end) {
    await clickOpenOnly().catch(() => {});
    const r = await softCommand('akari.preview.ensureVisible', { editUri });
    if (!r.ok && r.error !== 'pending') { await sleep(3000); continue; }
    await sleep(4000);
    view = await findPreview(15000);
  }
  if (!view) throw new Error('preview not found');
  for (let i = 0; i < 60; i++) { if (await pv(`Number(document.getElementById('seek')?.max || 0) >= 11`).catch(() => false)) break; await sleep(500); }
  report.inspectorOpen = await command('akari.inspector.open');
  await sleep(1500);
  await clickOpenOnly();
  await previewScenarios();
} catch (e) { report.error = clean(e?.stack ?? e); }
finally {
  main?.close(); browser?.close();
  if (child?.pid) { try { process.kill(-child.pid, 'SIGTERM'); } catch {} await sleep(2000); try { process.kill(-child.pid, 'SIGKILL'); } catch {} }
}

// ---- 書き出し（osr / gpu）と比べる ---------------------------------------------------------
if (!report.error && !only.length || only.includes('export')) {
  const exp = {};
  const drawn = results['f-draw-motion']?.drawnText;
  if (drawn) await writeFile(editPath, drawn);
  exp.usesDrawnEdit = Boolean(drawn);
  for (const engine of ['osr', 'gpu']) {
    const mp4 = path.join(scratch, `${engine}.mp4`);
    const cli = path.join(repo, `packages/${engine}-export/bin/akari-${engine}-export.mjs`);
    const r = run(process.execPath, [cli, project, '--out', mp4, '--duration', '12', '--frames', String(12 * FPS), '--width', String(W), '--height', String(H), '--fps', String(FPS), '--soft'],
      { cwd: repo, env: { ...process.env, AKARI_HOME: path.join(scratch, 'akari-home') } });
    exp[engine] = { code: r.status, stderr: clean(r.stderr ?? '').slice(-1500) };
    if (r.status !== 0) continue;
    const rows = {};
    const push = (key, t, color) => { try { const m = measure(rgbOf(mp4, t), color); (rows[key] ??= []).push({ t, center: m?.center ?? null, box: m?.box ?? null, alpha: m?.alphaEstimate }); } catch (e) { (rows[key] ??= []).push({ t, error: clean(e.message) }); } };
    for (const t of TIMES.a) push('a', t, 'red');
    for (const t of TIMES.b) push('b', t, 'green');
    for (const t of TIMES.c) { push('c-blue', t, 'blue'); push('c-yellow', t, 'yellow'); }
    for (const t of [5, 5.5, 6, 7]) push('f', t, 'green');
    for (const t of [5, 6]) { const png = path.join(outDir, `${label}-${engine}-${t}.png`); run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-ss', String(t), '-i', mp4, '-frames:v', '1', png]); }
    exp[engine].rows = rows;
  }
  report.export = exp;
}
report.results = results;
report.consoleErrors = [...new Set(consoleErrors.map(clean))].filter(l => /motion|TypeError|ReferenceError|itemMotion|stroke/i.test(l)).slice(-15);
report.allConsoleErrors = [...new Set(consoleErrors.map(clean))].slice(-25);
if (results['f-draw-motion']?.drawnText) { await writeFile(path.join(outDir, `${label}-f-edit-after-draw.json`), results['f-draw-motion'].drawnText); delete results['f-draw-motion'].drawnText; }
await writeFile(path.join(outDir, `${label}.json`), `${clean(JSON.stringify(report, null, 2))}\n`);
await rm(scratch, { recursive: true, force: true });
console.log(clean(JSON.stringify(report, null, 1)).slice(0, 6000));
