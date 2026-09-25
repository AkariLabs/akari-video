#!/usr/bin/env node
// L1（検証専用・ラッパー作成）: KF-2b（ライブの連動の残り）を本物の Electron シェルで確かめる。
// KF-2 の検証スクリプト（evidence/kf2-inspector-live/run-l1.mjs）を元に、次を足した:
//   z-flicker. X → Tab の最中の scrollTop（setter のフック・scroll イベント・毎フレームの読み取り）の全部の値
//   s-shape.   図形のつまみ（線の太さ・角丸・しっぽ・塗りの色）のスクラブ / 色パネルの最中のプレビュー（svg・画素）と
//              確定後の見た目との画素の差・書き込み回数・undo・Esc
//   p-photo.   写真の調整（露出以外）のスクラブ中の写真の平均の色
//   t-caption. 字幕の行間・字間・縁取りの太さのスライダー中の見た目
// 以下は KF-2 の回帰（そのまま）:
//   a. インスペクターを下までスクロール → プレビューで図形を動かす / インスペクターの数値を変える → scrollTop
//      別の item を選ぶ → 先頭へ
//   b. プレビューでドラッグ中のインスペクターの x・y（と つまみ = 大きさ・回転）の数値の推移
//   c. インスペクターの数値のスクラブ・スライダーの最中のプレビューの見た目（DOM の矩形 + スクショ）・edit.json の書き込み回数
//      Esc で取り消す・undo 1 回で元へ
//   d. H-1 のつまみ・FX-4 の写真の選択・F-0 の消しゴムの回帰（最小）
// 使い方: node evidence/kf2b-live-more/run-l1.mjs --shell <apps/shell> --out <dir> --label before|after [--only a,b]
// 呼び出し側が heavy-slot の枠を持つこと。一時ディレクトリ・ポートはこの票専用。
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : fallback; };
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const shellDir = path.resolve(arg('shell', path.join(repo, 'apps/shell')));
const label = arg('label', 'after');
const outDir = path.resolve(arg('out', path.join(repo, 'evidence/kf2b-live-more', label)));
const only = (arg('only', '') || '').split(',').filter(Boolean);
const port = Number(process.env.AKARI_CDP_PORT ?? 9573);
const httpPort = Number(process.env.AKARI_HTTP_PORT ?? 48981);
const electron = path.join(shellDir, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
const ffmpeg = process.env.FFMPEG ?? 'ffmpeg';

const scratch = await realpath(await mkdtemp('/tmp/2026-09-26-libcanvas-kf2b-live-more-l1-'));
const project = path.join(scratch, 'project');
const editPath = path.join(project, 'edit.json');
const captionsPath = path.join(project, 'captions.json');
const editUri = pathToFileURL(editPath).href;
const clean = v => String(v).replaceAll(repo, '<repo>').replaceAll(scratch, '<scratch>').replace(/\/Users\/[^\s"')]+/g, '<local>')
  .replace(/\/(private\/)?(tmp|var)\/[^\s"')]+/g, '<tmp>');
const run = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 1 << 28, ...opts });

// ---- fixture -----------------------------------------------------------------------------
// 1920×1080 / 30fps。下地の動画 + 図形 2 つ + 写真 1 枚 + 文字（字幕）1 つ。box-kf は位置のキーフレーム付き。
const EDIT = {
  version: 2,
  output: { width: 1920, height: 1080, fps: 30 },
  sources: [{ id: 'base', path: 'assets/base.mp4' }, { id: 'photo', path: 'assets/photo.png' }],
  tracks: [
    { id: 'v-main', lane: 'visual', name: '本編', items: [{ id: 'cut-1', at: 0, duration: 300, source: { kind: 'media', src: 'base', in: 0, out: 10 } }] },
    { id: 'v-photo', lane: 'visual', name: 'photo', items: [{ id: 'photo-a', at: 0, duration: 300, transform: { x: 450, y: -180, scale: 0.6 },
      source: { kind: 'media', src: 'photo', in: 0, out: 10 } }] },
    { id: 'v-box-a', lane: 'visual', name: 'box-a', items: [{ id: 'box-a', at: 0, duration: 300, transform: { x: 300, y: 200 },
      source: { kind: 'shape', shape: 'rect', params: { width: 300, height: 200, fill: '#3b82f6', stroke: '#111827', strokeWidth: 6 } } }] },
    { id: 'v-box-b', lane: 'visual', name: 'box-b', items: [{ id: 'box-b', at: 0, duration: 300, transform: { x: 300, y: 620 },
      source: { kind: 'shape', shape: 'rect', params: { width: 240, height: 160, fill: '#ef4444' } } }] },
    { id: 'v-box-kf', lane: 'visual', name: 'box-kf', items: [{ id: 'box-kf', at: 0, duration: 300, transform: { x: 800, y: 780 },
      keyframes: [{ t: 0, transform: { x: 700 } }, { t: 300, transform: { x: 1300 } }],
      source: { kind: 'shape', shape: 'rect', params: { width: 200, height: 120, fill: '#10b981' } } }] },
    { id: 'v-round', lane: 'visual', name: 'round-a', items: [{ id: 'round-a', at: 0, duration: 300, transform: { x: 980, y: 540 },
      source: { kind: 'shape', shape: 'rounded-rect', params: { width: 300, height: 200, fill: '#f59e0b', cornerRadius: 10 } } }] },
    { id: 'v-bubble', lane: 'visual', name: 'bubble-a', items: [{ id: 'bubble-a', at: 0, duration: 300, transform: { x: 1440, y: 540 },
      source: { kind: 'shape', shape: 'bubble', params: { width: 360, height: 220, tailAngle: 180, tailLength: 30, tailWidth: 20 } } }] },
    { id: 'v-text', lane: 'visual', name: 'text', items: [{ id: 'captions', name: '字幕', at: 0, duration: 300, source: { kind: 'captions', path: 'captions.json' }, items: [] }] }
  ]
};
const CAPTIONS = { captions: [{ id: 'c-0001', start: 0, end: 10, time_domain: 'output', text: 'ライブの連動の確かめ 二行目になるくらい長い字幕の文章', speaker: null, sourceRef: null, edited: true }] };

async function makeFixture() {
  await mkdir(path.join(project, 'assets'), { recursive: true });
  await mkdir(path.join(project, '.akari'), { recursive: true });
  let r = run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-f', 'lavfi', '-i', 'color=c=0xe7e5e4:s=1920x1080:d=10:r=30',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-g', '30', path.join(project, 'assets', 'base.mp4')]);
  if (r.status !== 0) throw new Error(`ffmpeg base: ${r.stderr}`);
  r = run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=640x360:d=1', '-frames:v', '1',
    path.join(project, 'assets', 'photo.png')]);
  if (r.status !== 0) throw new Error(`ffmpeg photo: ${r.stderr}`);
  await writeFile(editPath, `${JSON.stringify(EDIT, null, 2)}\n`);
  await writeFile(captionsPath, `${JSON.stringify(CAPTIONS, null, 2)}\n`);
  await writeFile(path.join(project, '.akari', 'lint.json'), '{"version":1,"verdict":"pass"}\n');
  for (const a of [['init', '-q'], ['config', 'user.email', 'l1@localhost'], ['config', 'user.name', 'l1'], ['add', '-A'], ['commit', '-q', '-m', 'fixture']]) {
    const g = run('/usr/bin/git', a, { cwd: project });
    if (g.status !== 0) throw new Error(`git ${a[0]}: ${g.stderr}`);
  }
}

// ---- edit.json の書き込みの数え方（15ms 毎に中身を見て、変わった回数を数える）---------------------
// edit.json と captions.json（文字の値はこちらへ書かれる）の両方を数える
const lastTexts = new Map();
let writes = [];
let watcher;
function startWatch() {
  for (const f of [editPath, captionsPath]) lastTexts.set(f, readFileSync(f, 'utf8'));
  watcher = setInterval(() => {
    for (const f of [editPath, captionsPath]) {
      let t; try { t = readFileSync(f, 'utf8'); } catch { continue; }
      if (t && t !== lastTexts.get(f)) {
        lastTexts.set(f, t);
        let boxA = null; try { if (f === editPath) boxA = findItem(JSON.parse(t), 'box-a')?.transform ?? null; } catch {}
        writes.push({ at: Date.now(), file: path.basename(f), boxA });
      }
    }
  }, 15);
}
const writeMark = () => writes.length;
const writesSince = mark => writes.length - mark;

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
          try { if (await evaluate(browser, `Boolean(document.getElementById('preview-layers') && document.getElementById('seek'))`, contextId, sessionId)) return { sessionId, contextId }; } catch {}
        }
      } catch {}
    }
    await sleep(500);
  }
  return undefined;
}
const pv = expr => evaluate(browser, expr, view.contextId, view.sessionId);
const mw = expr => evaluate(main, expr);
async function command(id, value) {
  return mw(`(async () => { try {
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
    await sleep(700);
    const actual = await pv(`Number(document.getElementById('seek')?.value)`).catch(() => NaN);
    if (Math.abs(actual - seconds) < 0.04) { await sleep(400); return actual; }
  }
  return pv(`Number(document.getElementById('seek')?.value)`);
}
// 本体ページ上の webview（プレビュー）の左上
async function outerOffset() {
  return mw(`(() => { const f = [...document.querySelectorAll('iframe')].filter(f => /webview/.test(f.src || '')).map(f => f.getBoundingClientRect()).filter(r => r.width > 100 && r.height > 100).sort((a, b) => b.width * b.height - a.width * a.height)[0]; return f ? { x: f.x, y: f.y, w: f.width, h: f.height } : null; })()`);
}
let outer;
// プレビューの中の item の矩形（webview の座標）。図形は svg、写真はレイヤー
async function itemRects(ids) {
  return pv(`(() => { const out = {}; const stage = document.getElementById('preview-layers').getBoundingClientRect();
    for (const id of ${JSON.stringify(ids)}) {
      const node = document.querySelector('[data-overlay-id=' + JSON.stringify(id) + ']') ?? document.querySelector('[data-item-id=' + JSON.stringify(id) + ']') ?? document.querySelector('[data-akari-layer-id=' + JSON.stringify(id) + ']');
      const cap = !node && id === 'captions' ? [...document.querySelectorAll('body *')].find(e => e.children.length === 0 && (e.textContent || '').includes('ライブの連動') && e.getBoundingClientRect().width > 0) : null;
      const shape = cap ?? node?.querySelector('svg') ?? node;
      if (!shape) { out[id] = null; continue; }
      const b = shape.getBoundingClientRect();
      out[id] = { left: +b.left.toFixed(1), top: +b.top.toFixed(1), width: +b.width.toFixed(1), height: +b.height.toFixed(1), cx: +(b.left + b.width / 2).toFixed(1), cy: +(b.top + b.height / 2).toFixed(1),
        transform: ((node ?? cap).style?.transform || '').slice(0, 120), opacity: getComputedStyle(node ?? cap).opacity,
        filter: getComputedStyle(node ?? cap).filter.slice(0, 120), fontSize: getComputedStyle(cap ?? shape).fontSize };
    }
    const frame = document.querySelector('.akari-interaction-selection-frame');
    const fr = frame && getComputedStyle(frame).display !== 'none' ? frame.getBoundingClientRect() : null;
    return { stage: { x: stage.x, y: stage.y, width: stage.width, height: stage.height }, items: out,
      frame: fr ? { left: +fr.left.toFixed(1), top: +fr.top.toFixed(1), width: +fr.width.toFixed(1), height: +fr.height.toFixed(1) } : null }; })()`);
}
async function mouse(type, x, y, buttons, extra = {}) {
  await main.send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' && !buttons ? 'none' : 'left',
    buttons: buttons ?? (type === 'mousePressed' ? 1 : 0), clickCount: type === 'mouseMoved' ? 0 : 1, ...extra });
}
const vp = p => ({ x: outer.x + p.x, y: outer.y + p.y }); // webview → 本体ページ
async function clickAt(pt) { await mouse('mouseMoved', pt.x, pt.y); await mouse('mousePressed', pt.x, pt.y); await sleep(60); await mouse('mouseReleased', pt.x, pt.y); await sleep(700); }
async function key(keyName, code, keyCode, modifiers = 0, commands) {
  await main.send('Input.dispatchKeyEvent', { type: 'keyDown', key: keyName, code, windowsVirtualKeyCode: keyCode, modifiers, ...(commands ? { commands } : {}) });
  await main.send('Input.dispatchKeyEvent', { type: 'keyUp', key: keyName, code, windowsVirtualKeyCode: keyCode, modifiers });
}
async function shot(name, clip) {
  const { data } = await main.send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip: { ...clip, scale: 1 } } : {}) });
  const file = `${label}-${name}.png`;
  await writeFile(path.join(outDir, file), Buffer.from(data, 'base64'));
  return file;
}
// 本体ページの矩形: プレビュー + インスペクターが入るように、ウィンドウ全体を撮る（縮小なし）
const windowShot = name => shot(name);

const readEditText = () => readFile(editPath, 'utf8');
const headText = () => run('/usr/bin/git', ['show', 'HEAD:edit.json'], { cwd: project }).stdout;
const findItem = (edit, id) => { const walk = items => { for (const it of items ?? []) { if (it.id === id) return it; const c = walk(it.items); if (c) return c; } }; for (const t of edit.tracks) { const f = walk(t.items); if (f) return f; } };
const INSPECTOR = `document.querySelector('[data-akari-ui="panel:inspector"]')`;
async function undoOnce() {
  const before = await readEditText();
  await mw(`(() => { const e = document.activeElement; if (e && e !== document.body) e.blur(); return true; })()`);
  await key('z', 'KeyZ', 90, 4, ['undo']);
  for (let i = 0; i < 30 && (await readEditText()) === before; i++) await sleep(200);
  await sleep(800);
}
async function resetToHead() {
  // シナリオどうしの干渉を避ける: undo で戻し切れなかった時だけ、ファイルを HEAD に戻して読み直させる
  let touched = false;
  for (const [f, name] of [[editPath, 'edit.json'], [captionsPath, 'captions.json']]) {
    const head = run('/usr/bin/git', ['show', `HEAD:${name}`], { cwd: project }).stdout;
    if ((await readFile(f, 'utf8')) !== head) { await writeFile(f, head); touched = true; }
  }
  if (touched) { await sleep(2500); view = (await findPreview(20000)) ?? view; outer = await outerOffset(); }
}
const readCaptionsText = () => readFile(captionsPath, 'utf8');
// 本体ページの矩形を撮って平均の明るさ（0..255）を出す（プレビューの写真の色の変化を数で見る）
async function meanLuma(clip) {
  const { data } = await main.send('Page.captureScreenshot', { format: 'png', clip: { ...clip, scale: 1 } });
  const tmp = path.join(scratch, 'luma.png');
  await writeFile(tmp, Buffer.from(data, 'base64'));
  const r = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-i', tmp, '-vf', 'scale=32:18,format=gray', '-f', 'rawvideo', '-'], { maxBuffer: 1 << 20 });
  if (r.status !== 0 || !r.stdout.length) return null;
  let sum = 0; for (const b of r.stdout) sum += b; return +(sum / r.stdout.length).toFixed(2);
}

// インスペクターの様子: scrollTop・タブ・欄の値・フォーカス
const inspectorState = () => mw(`(() => { const root = ${INSPECTOR}; if (!root) return null;
  const text = n => (n?.textContent ?? '').replace(/\\s+/g, ' ').trim();
  const val = name => { const f = root.querySelector('[data-akari-ui="field:inspector-' + name + '"]'); const i = f?.querySelector('input'); return i ? i.value : null; };
  const tabs = [...root.querySelectorAll('[data-akari-ui^="tab:inspector-"]')].map(t => ({ ui: t.getAttribute('data-akari-ui'), selected: t.getAttribute('aria-selected') ?? t.getAttribute('aria-pressed') ?? (t.classList.contains('is-active') ? 'true' : null) }));
  const ae = document.activeElement;
  return { scrollTop: Math.round(root.scrollTop), scrollHeight: root.scrollHeight, clientHeight: root.clientHeight,
    header: text(root.querySelector('.akari-inspector-selection-header, [data-akari-ui="inspector-selection-header"]')).slice(0, 60),
    x: val('transform-x'), y: val('transform-y'), scale: val('transform-scale'), rotate: val('transform-rotate'), opacity: val('opacity'),
    tabs, activeTab: (tabs.find(t => t.selected === 'true') ?? {}).ui ?? null,
    focus: ae && root.contains(ae) ? { tag: ae.tagName, aria: ae.getAttribute('aria-label'), field: ae.closest('[data-akari-ui^="field:"]')?.getAttribute('data-akari-ui') ?? null, selStart: ae.selectionStart ?? null } : null }; })()`);
const clickTab = async id => { const r = await mw(`(() => { const b = ${INSPECTOR}?.querySelector('[data-akari-ui="tab:inspector-${id}"]'); if (!b || b.disabled) return false; b.click(); return true; })()`); await sleep(600); return r; };
const scrollInspector = top => mw(`(() => { const r = ${INSPECTOR}; r.scrollTop = ${top === 'bottom' ? 'r.scrollHeight' : top}; return Math.round(r.scrollTop); })()`);
// インスペクターの欄の本体ページ上の矩形
const fieldRect = (name, sel) => mw(`(() => { const f = ${INSPECTOR}?.querySelector('[data-akari-ui="field:inspector-${name}"]'); const e = ${sel ? `f?.querySelector(${JSON.stringify(sel)})` : 'f'};
  if (!e) return null; const b = e.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height, cx: b.x + b.width / 2, cy: b.y + b.height / 2 }; })()`);

async function selectInPreview(id) {
  const o = await itemRects([id]);
  const b = o.items[id];
  if (!b) throw new Error(`item ${id} not mounted`);
  await clickAt(vp({ x: b.cx, y: b.cy }));
  await sleep(900);
  return b;
}

// ---- KF-2b: 画素・図形・欄の道具 -------------------------------------------------------------
// 本体ページの矩形を撮って RGB の生の画素へ（大きさは clip の CSS px に揃える = 比べられる）
async function clipPixels(clip) {
  const c = { x: Math.round(clip.x), y: Math.round(clip.y), width: Math.max(8, Math.round(clip.width)), height: Math.max(8, Math.round(clip.height)) };
  const { data } = await main.send('Page.captureScreenshot', { format: 'png', clip: { ...c, scale: 1 } });
  const tmp = path.join(scratch, 'px.png');
  await writeFile(tmp, Buffer.from(data, 'base64'));
  const r = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-i', tmp, '-vf', `scale=${c.width}:${c.height}:flags=area,format=rgb24`, '-f', 'rawvideo', '-'], { maxBuffer: 1 << 26 });
  if (r.status !== 0 || !r.stdout.length) return null;
  return { buf: r.stdout, w: c.width, h: c.height };
}
function pixelStats(p) {
  if (!p) return null;
  let r = 0, g = 0, b = 0; const n = p.buf.length / 3;
  for (let i = 0; i < p.buf.length; i += 3) { r += p.buf[i]; g += p.buf[i + 1]; b += p.buf[i + 2]; }
  return { r: +(r / n).toFixed(2), g: +(g / n).toFixed(2), b: +(b / n).toFixed(2), luma: +((0.2126 * r + 0.7152 * g + 0.0722 * b) / n).toFixed(2) };
}
// 平均の差（0..255）と、どれかの色が 32 以上ずれた画素の割合（%）
function pixelDiff(a, b) {
  if (!a || !b || a.buf.length !== b.buf.length) return null;
  let sum = 0, over = 0; const n = a.buf.length / 3;
  for (let i = 0; i < a.buf.length; i += 3) {
    const d0 = Math.abs(a.buf[i] - b.buf[i]), d1 = Math.abs(a.buf[i + 1] - b.buf[i + 1]), d2 = Math.abs(a.buf[i + 2] - b.buf[i + 2]);
    sum += d0 + d1 + d2; if (Math.max(d0, d1, d2) >= 32) over++;
  }
  return { meanAbs: +(sum / (n * 3)).toFixed(3), changedPct: +(over / n * 100).toFixed(3) };
}
// プレビューの図形の svg の様子（塗り・線・太さ・形の先頭・全体のハッシュ）
const shapeState = id => pv(`(() => { const node = document.querySelector('[data-overlay-id=' + JSON.stringify(${JSON.stringify(id)}) + ']') ?? document.querySelector('[data-item-id=' + JSON.stringify(${JSON.stringify(id)}) + ']');
  const svg = node?.querySelector('svg'); if (!svg) return null; const html = svg.outerHTML; let h = 5381; for (let i = 0; i < html.length; i++) h = ((h << 5) + h + html.charCodeAt(i)) | 0;
  const els = [...svg.querySelectorAll('path, rect, ellipse, circle, polygon, line')].slice(0, 4).map(e => ({ tag: e.tagName, fill: e.getAttribute('fill') ?? e.style.fill ?? null, stroke: e.getAttribute('stroke'), sw: e.getAttribute('stroke-width'), rx: e.getAttribute('rx'), d: (e.getAttribute('d') ?? '').slice(0, 70) }));
  return { hash: (h >>> 0).toString(16), len: html.length, els, live: node.getAttribute('data-akari-live-override') }; })()`);
// 欄を探す（見えていなければタブを順に開く・閉じた details を開く）。見つかったら中央へスクロール
async function revealField(name) {
  const find = () => mw(`(() => { const root = ${INSPECTOR}; if (!root) return 'no-root'; const f = root.querySelector('[data-akari-ui="field:inspector-${name}"]'); if (!f) return 'none';
    let d = f.closest('details'); while (d) { if (!d.open) d.open = true; d = d.parentElement?.closest('details'); }
    f.scrollIntoView({ block: 'center' }); return f.getClientRects().length ? 'ok' : 'hidden'; })()`);
  let r = await find();
  if (r === 'ok') { await sleep(300); return true; }
  const tabs = await mw(`[...(${INSPECTOR}?.querySelectorAll('[data-akari-ui^="tab:inspector-"]') ?? [])].filter(t => !t.disabled).map(t => t.getAttribute('data-akari-ui').slice(14))`);
  for (const t of tabs ?? []) { await clickTab(t); r = await find(); if (r === 'ok') { await sleep(300); return t; } }
  return false;
}
async function dragHandle(name, stepPx, steps, onStep) {
  const h = await fieldRect(name, '.akari-inspector-number-handle');
  if (!h) return null;
  await mouse('mouseMoved', h.cx, h.cy); await mouse('mousePressed', h.cx, h.cy); await sleep(80);
  for (let i = 1; i <= steps; i++) { await mouse('mouseMoved', h.cx + stepPx * i, h.cy, 1); await sleep(300); await onStep?.(i); }
  return { release: async () => { await mouse('mouseReleased', h.cx + stepPx * steps, h.cy); }, h };
}
const fieldValue = name => mw(`(() => { const f = ${INSPECTOR}?.querySelector('[data-akari-ui="field:inspector-${name}"]'); return f?.querySelector('input')?.value ?? null; })()`);
const clipAround = (r, m) => ({ x: outer.x + r.left - m, y: outer.y + r.top - m, width: r.width + m * 2, height: r.height + m * 2 });
const bothText = async () => (await readEditText()) + (await readCaptionsText());

const results = {};
async function scenario(name, fn) {
  if (only.length && !only.includes(name)) return;
  const started = Date.now();
  try { results[name] = await fn(); } catch (e) { results[name] = { error: clean(e?.stack ?? e).slice(0, 1500) }; }
  results[name].ms = Date.now() - started;
  await mw(`(() => { const e = document.activeElement; if (e && e !== document.body) e.blur(); return true; })()`).catch(() => {});
  await key('Escape', 'Escape', 27).catch(() => {});
  await resetToHead().catch(() => {});
}

async function scenarios() {
  // 構造を控える（どの欄・タブ・スライダーがあるか）
  await scenario('discover', async () => {
    const out = {};
    for (const id of ['box-a', 'photo-a']) {
      await selectInPreview(id);
      out[id] = await mw(`(() => { const root = ${INSPECTOR}; if (!root) return null; const text = n => (n?.textContent ?? '').replace(/\\s+/g, ' ').trim();
        return { tabs: [...root.querySelectorAll('[data-akari-ui^="tab:inspector-"]')].map(t => t.getAttribute('data-akari-ui') + (t.disabled ? '(disabled)' : '')),
          fields: [...root.querySelectorAll('[data-akari-ui^="field:inspector-"]')].map(f => f.getAttribute('data-akari-ui').slice(16)),
          rows: [...root.querySelectorAll('[data-akari-field]')].map(r => r.getAttribute('data-akari-field')),
          ranges: [...root.querySelectorAll('input[type=range]')].map(r => r.getAttribute('aria-label') + '@' + (r.closest('[data-akari-field]')?.getAttribute('data-akari-field') ?? r.closest('[data-akari-ui]')?.getAttribute('data-akari-ui'))),
          scrollHeight: root.scrollHeight, clientHeight: root.clientHeight }; })()`);
      out[`${id}-shot`] = await windowShot(`discover-${id}`);
    }
    return out;
  });

  // z. 診断: スクロールが先頭へ戻る時に、インスペクターの器が作り直されたのか・誰が scrollTop を書いたのか
  await scenario('z-diag', async () => {
    const out = {};
    await selectInPreview('box-a');
    // X の欄が見えている位置（隠れた欄へ focus するとブラウザ自身がスクロールするため）
    await scrollInspector(120); await sleep(300);
    out.setup = await mw(`(() => { const root = ${INSPECTOR}; root.setAttribute('data-l1-mark', '1'); window.__l1Scroll = [];
      const t0 = performance.now(); const log = (what, extra) => window.__l1Scroll.push({ t: Math.round(performance.now() - t0), what, top: Math.round(root.scrollTop), h: root.scrollHeight,
        head: (root.querySelector('.akari-inspector-selection-header, [data-akari-ui="inspector-selection-header"]')?.textContent ?? root.textContent ?? '').replace(/\\s+/g, ' ').trim().slice(0, 24), ...extra });
      root.addEventListener('scroll', () => log('scroll'));
      const d = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop');
      Object.defineProperty(root, 'scrollTop', { configurable: true, get() { return d.get.call(this); }, set(v) { log('set', { v, stack: new Error().stack.split('\\n').slice(2, 7).map(x => x.trim().slice(0, 140)) }); d.set.call(this, v); } });
      const oScroll = root.scrollTo?.bind(root); root.scrollTo = (...a) => { log('scrollTo', { a: JSON.stringify(a).slice(0, 80), stack: new Error().stack.split('\\n').slice(2, 7).map(x => x.trim().slice(0, 140)) }); return oScroll(...a); };
      const body = root.firstElementChild; const mo = new MutationObserver(ms => log('mutation', { n: ms.length, bodyH: Math.round(body.getBoundingClientRect().height), kids: body.children.length })); mo.observe(body, { childList: true });
      window.__l1Mo = mo; return { top: root.scrollTop }; })()`);
    const xr = await fieldRect('transform-x', 'input');
    out.xVisible = xr;
    await mw(`(() => { const i = ${INSPECTOR}.querySelector('[data-akari-ui="field:inspector-transform-x"] input'); i.focus(); i.select(); return document.activeElement === i; })()`);
    await main.send('Input.insertText', { text: '333' });
    await key('Tab', 'Tab', 9);
    await sleep(2000);
    out.after = await mw(`(() => { const root = ${INSPECTOR}; return { sameNode: root.getAttribute('data-l1-mark') === '1', top: root.scrollTop, panels: document.querySelectorAll('[data-akari-ui="panel:inspector"]').length,
      active: document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.tagName, log: (window.__l1Scroll || []).slice(0, 40) }; })()`);
    return out;
  });

  // z-flicker. X → Tab の最中の scrollTop（3 回）。setter のフック・scroll イベント・毎フレームの読み取りの全部の値
  await scenario('z-flicker', async () => {
    const out = { trials: [] };
    await selectInPreview('box-a');
    await clickTab('video');
    for (let trial = 0; trial < 3; trial++) {
      await scrollInspector(120); await sleep(500);
      const start = await mw(`Math.round(${INSPECTOR}.scrollTop)`);
      await mw(`(() => { const root = ${INSPECTOR}; window.__zf = []; window.__zfStop = false; const t0 = performance.now();
        const log = (what, v) => window.__zf.push({ t: Math.round(performance.now() - t0), what, v: Math.round(v) });
        root.__zfScroll = () => log('scroll', root.scrollTop); root.addEventListener('scroll', root.__zfScroll);
        const d = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop');
        Object.defineProperty(root, 'scrollTop', { configurable: true, get() { return d.get.call(this); }, set(v) { log('pre', d.get.call(this)); log('set', v); d.set.call(this, v); log('post', d.get.call(this)); } });
        const frame = () => { if (window.__zfStop) return; log('frame', d.get.call(root)); requestAnimationFrame(frame); }; requestAnimationFrame(frame);
        return true; })()`);
      await mw(`(() => { const i = ${INSPECTOR}.querySelector('[data-akari-ui="field:inspector-transform-x"] input'); i.focus(); i.select(); return document.activeElement === i; })()`);
      const mark = writeMark();
      await main.send('Input.insertText', { text: String(311 + trial * 7) });
      await key('Tab', 'Tab', 9);
      await sleep(2500);
      const log = await mw(`(() => { const root = ${INSPECTOR}; window.__zfStop = true; root.removeEventListener('scroll', root.__zfScroll); delete root.scrollTop; return window.__zf; })()`);
      const vals = log.map(e => e.v);
      const dev = vals.length ? Math.max(...vals.map(v => Math.abs(v - start))) : null;
      const s = await inspectorState();
      out.trials.push({ trial, start, min: Math.min(...vals), max: Math.max(...vals), maxDeviation: dev, samples: log.length, frames: log.filter(e => e.what === 'frame').length,
        offending: log.filter(e => Math.abs(e.v - start) > 4).slice(0, 12), final: s.scrollTop, focus: s.focus?.field ?? null, writes: writesSince(mark) });
      await undoOnce();
    }
    return out;
  });

  // s-shape. 図形のつまみのスクラブ中のプレビュー。ライブの最後のフレームと確定後の見た目の画素の差
  await scenario('s-shape', async () => {
    const out = { knobs: [] };
    const knobs = [
      ['box-a', 'shape-strokeWidth', 10], ['round-a', 'shape-cornerRadius', 25],
      ['bubble-a', 'shape-tailAngle', 40], ['bubble-a', 'shape-tailLength', 20], ['bubble-a', 'shape-tailWidth', 20],
      ['bubble-a', 'shape-strokeWidth', 6]
    ];
    for (const [id, name, stepPx] of knobs) {
      const row = { id, name };
      try {
        await selectInPreview(id);
        row.tab = await revealField(name);
        if (!row.tab) { row.skipped = 'field not found'; out.knobs.push(row); continue; }
        const r0 = (await itemRects([id])).items[id];
        const clip = clipAround(r0, 30);
        const head = await bothText();
        row.before = { value: await fieldValue(name), svg: await shapeState(id), px: pixelStats(await clipPixels(clip)) };
        const p0 = await clipPixels(clip);
        const mark = writeMark();
        const series = [];
        let lastPx;
        const d = await dragHandle(name, stepPx, 3, async i => {
          lastPx = await clipPixels(clip);
          series.push({ step: i, value: await fieldValue(name), svg: await shapeState(id), diffFromStart: pixelDiff(p0, lastPx), writes: writesSince(mark),
            shot: await windowShot(`s-${id}-${name}-${i}`) });
        });
        if (!d) { row.skipped = 'no scrub handle'; out.knobs.push(row); continue; }
        await sleep(300); lastPx = await clipPixels(clip);
        await d.release(); await sleep(60);
        // 離した直後（確定の書き込みと読み直しの間）に元の見た目へ一瞬戻っていないか
        const justAfter = []; for (let i = 0; i < 6; i++) { justAfter.push(await clipPixels(clip)); await sleep(90); }
        await sleep(1400);
        const committed = await clipPixels(clip);
        row.justAfterReleaseVsCommitted = justAfter.map(x => pixelDiff(x, committed)?.meanAbs ?? null);
        row.justAfterReleaseVsStart = justAfter.map(x => pixelDiff(x, p0)?.meanAbs ?? null);
        row.series = series;
        row.writesDuring = series.at(-1)?.writes ?? null;
        row.writes = writesSince(mark);
        row.after = { value: await fieldValue(name), svg: await shapeState(id), written: findItem(JSON.parse(await readEditText()), id)?.source?.params };
        row.liveLastVsCommitted = pixelDiff(lastPx, committed);
        row.startVsCommitted = pixelDiff(p0, committed);
        row.committedShot = await windowShot(`s-${id}-${name}-committed`);
        if ((await bothText()) !== head) { await undoOnce(); row.undoEqualsHead = (await bothText()) === head; row.afterUndoVsStart = pixelDiff(p0, await clipPixels(clip)); }
      } catch (e) { row.error = clean(e?.stack ?? e).slice(0, 600); }
      out.knobs.push(row);
      await resetToHead();
    }
    // Esc: 線の太さのスクラブ中に Esc → 元の見た目・書き込み 0
    // focusFirst: 'preview' = プレビューで選んだまま（本体ページの activeElement は webview の iframe）/ 'inspector' = 先に本体側へ戻す
    for (const focusFirst of ['preview', 'inspector']) try {
      await selectInPreview('box-a');
      if (focusFirst === 'inspector') await mw(`(() => { const e = document.activeElement; if (e && e !== document.body) e.blur(); return true; })()`);
      await revealField('shape-strokeWidth');
      const r0 = (await itemRects(['box-a'])).items['box-a'];
      const clip = clipAround(r0, 30);
      const head = await bothText();
      const p0 = await clipPixels(clip); const svg0 = await shapeState('box-a');
      const mark = writeMark();
      const d = await dragHandle('shape-strokeWidth', 12, 3);
      await sleep(300);
      const during = { svg: await shapeState('box-a'), diff: pixelDiff(p0, await clipPixels(clip)), shot: await windowShot(`s-esc-${focusFirst}-during`) };
      const activeBeforeEsc = await mw(`(() => { const e = document.activeElement; return e ? e.tagName + (e.getAttribute('aria-label') ? ':' + e.getAttribute('aria-label') : '') + (e.className ? '.' + String(e.className).slice(0, 40) : '') : null; })()`);
      await key('Escape', 'Escape', 27); await sleep(500);
      const afterEsc = { svg: await shapeState('box-a'), diff: pixelDiff(p0, await clipPixels(clip)), shot: await windowShot(`s-esc-${focusFirst}-after`) };
      await d?.release(); await sleep(1500);
      out[`esc-${focusFirst}`] = { activeBeforeEsc, svg0, during, afterEsc, afterRelease: { svg: await shapeState('box-a'), diff: pixelDiff(p0, await clipPixels(clip)) }, writes: writesSince(mark), unchanged: (await bothText()) === head };
      await resetToHead();
    } catch (e) { out[`esc-${focusFirst}`] = { error: clean(e?.stack ?? e).slice(0, 600) }; await resetToHead(); }
    // 塗りの色: 色パネルのスライダーを動かしている最中
    try {
      const row = {};
      await selectInPreview('box-a');
      row.tab = await revealField('shape-fill');
      const r0 = (await itemRects(['box-a'])).items['box-a'];
      const clip = clipAround(r0, 30);
      const head = await bothText();
      const p0 = await clipPixels(clip);
      row.before = { svg: await shapeState('box-a'), px: pixelStats(p0) };
      row.opened = await mw(`(() => { const f = ${INSPECTOR}.querySelector('[data-akari-ui="field:inspector-shape-fill"]'); const b = f?.querySelector('.akari-inspector-color-swatch, button'); if (!b) return false; b.click(); return true; })()`);
      await sleep(900);
      // 虹色のボタン（[data-cp-action="picker"]）で色の選択を開く
      row.pickerClicked = await mw(`(() => { const p = document.querySelector('[data-akari-ui="panel:inspector-color"]'); if (!p || p.querySelector('[data-cp-drag="hue"]')) return 'already';
        const b = p.querySelector('[data-cp-action="picker"]'); if (!b) return false; b.scrollIntoView({ block: 'center' }); const r = b.getBoundingClientRect(); return { cx: r.x + r.width / 2, cy: r.y + r.height / 2 }; })()`);
      if (row.pickerClicked?.cx) await clickAt({ x: row.pickerClicked.cx, y: row.pickerClicked.cy });
      await sleep(700);
      // 色パネルの色相の帯（[data-cp-drag="hue"]）のつまみを横へ動かす
      row.panel = await mw(`(() => { const p = document.querySelector('[data-akari-ui="panel:inspector-color"]'); if (!p) return null;
        const hue = p.querySelector('[data-cp-drag="hue"]'); hue?.scrollIntoView({ block: 'center' });
        const b = hue?.getBoundingClientRect(); const k = hue?.querySelector('.akari-color-knob')?.getBoundingClientRect();
        return { drags: [...p.querySelectorAll('[data-cp-drag]')].map(e => e.getAttribute('data-cp-drag')), hue: b && b.width > 0 ? { x: b.x, y: b.y, w: b.width, h: b.height, knobX: k ? k.x + k.width / 2 : b.x + 4 } : null }; })()`);
      const rr = row.panel?.hue;
      if (rr) {
        await sleep(300);
        const sx = rr.knobX, sy = rr.y + rr.h / 2;
        const target = sx - rr.x > rr.w / 2 ? rr.x + 6 : rr.x + rr.w - 6;
        const mark = writeMark();
        const series = [];
        let lastPx;
        await mouse('mouseMoved', sx, sy); await mouse('mousePressed', sx, sy); await sleep(80);
        for (let i = 1; i <= 3; i++) {
          await mouse('mouseMoved', sx + (target - sx) * i / 3, sy, 1); await sleep(300);
          lastPx = await clipPixels(clip);
          series.push({ step: i, svg: await shapeState('box-a'), px: pixelStats(lastPx), diffFromStart: pixelDiff(p0, lastPx), writes: writesSince(mark), shot: await windowShot(`s-fill-${i}`) });
        }
        await mouse('mouseReleased', target, sy); await sleep(2000);
        const committed = await clipPixels(clip);
        row.series = series; row.writes = writesSince(mark);
        row.after = { svg: await shapeState('box-a'), px: pixelStats(committed), written: findItem(JSON.parse(await readEditText()), 'box-a')?.source?.params?.fill };
        row.liveLastVsCommitted = pixelDiff(lastPx, committed);
        row.committedShot = await windowShot('s-fill-committed');
      }
      await mw(`(() => { const p = document.querySelector('[data-akari-ui="panel:inspector-color"]'); const b = p && [...p.querySelectorAll('button')].find(x => /戻る|閉じる/.test((x.getAttribute('aria-label') ?? '') + x.textContent)); b?.click(); return !!b; })()`);
      await sleep(600);
      if ((await bothText()) !== head) { await undoOnce(); row.undoEqualsHead = (await bothText()) === head; }
      out.fill = row;
    } catch (e) { out.fill = { error: clean(e?.stack ?? e).slice(0, 600) }; }
    return out;
  });

  // p-photo. 写真の調整（露出以外）のスクラブ中の写真の平均の色
  await scenario('p-photo', async () => {
    const out = { knobs: [] };
    for (const key of ['contrast', 'highlights', 'shadows', 'temperature', 'saturation']) {
      const name = `adjust-basic-${key}`;
      const row = { key };
      try {
        await selectInPreview('photo-a');
        await clickTab('adjust');
        row.tab = await revealField(name);
        if (!row.tab) { row.skipped = 'field not found'; out.knobs.push(row); continue; }
        const r0 = (await itemRects(['photo-a'])).items['photo-a'];
        const clip = { x: outer.x + r0.left + 4, y: outer.y + r0.top + 4, width: r0.width - 8, height: r0.height - 8 };
        const head = await bothText();
        const p0 = await clipPixels(clip);
        row.before = { value: await fieldValue(name), px: pixelStats(p0) };
        const mark = writeMark();
        const series = [];
        let lastPx;
        const stepPx = key === 'saturation' || key === 'contrast' ? -30 : 30;
        const d = await dragHandle(name, stepPx, 3, async i => {
          lastPx = await clipPixels(clip);
          series.push({ step: i, value: await fieldValue(name), px: pixelStats(lastPx), diffFromStart: pixelDiff(p0, lastPx), writes: writesSince(mark), shot: await windowShot(`p-${key}-${i}`) });
        });
        if (!d) { row.skipped = 'no scrub handle'; out.knobs.push(row); continue; }
        await sleep(300); lastPx = await clipPixels(clip);
        await d.release(); await sleep(2000);
        const committed = await clipPixels(clip);
        row.series = series; row.writes = writesSince(mark);
        row.after = { value: await fieldValue(name), px: pixelStats(committed) };
        row.liveLastVsCommitted = pixelDiff(lastPx, committed);
        row.startVsCommitted = pixelDiff(p0, committed);
        if ((await bothText()) !== head) { await undoOnce(); row.undoEqualsHead = (await bothText()) === head; }
      } catch (e) { row.error = clean(e?.stack ?? e).slice(0, 600); }
      out.knobs.push(row);
      await resetToHead();
    }
    // Esc: 彩度のスクラブ中に Esc
    try {
      await selectInPreview('photo-a'); await clickTab('adjust'); await revealField('adjust-basic-saturation');
      const r0 = (await itemRects(['photo-a'])).items['photo-a'];
      const clip = { x: outer.x + r0.left + 4, y: outer.y + r0.top + 4, width: r0.width - 8, height: r0.height - 8 };
      const head = await bothText(); const p0 = await clipPixels(clip); const mark = writeMark();
      const d = await dragHandle('adjust-basic-saturation', -30, 3); await sleep(300);
      const during = pixelDiff(p0, await clipPixels(clip));
      await key('Escape', 'Escape', 27); await sleep(500);
      const afterEsc = pixelDiff(p0, await clipPixels(clip));
      await d?.release(); await sleep(1500);
      out.esc = { during, afterEsc, writes: writesSince(mark), unchanged: (await bothText()) === head };
    } catch (e) { out.esc = { error: clean(e?.stack ?? e).slice(0, 600) }; }
    await resetToHead();
    return out;
  });

  // t-caption. 字幕の行間・字間・縁取りの太さのスライダー中の見た目
  await scenario('t-caption', async () => {
    const out = { sliders: [] };
    const capStyle = () => pv(`(() => { const leaf = [...document.querySelectorAll('body *')].find(e => e.children.length === 0 && (e.textContent || '').includes('ライブの連動') && e.getBoundingClientRect().width > 0);
      if (!leaf) return null; const chain = []; let n = leaf; for (let i = 0; i < 3 && n; i++, n = n.parentElement) { const cs = getComputedStyle(n); const b = n.getBoundingClientRect();
        chain.push({ tag: n.tagName, lineHeight: cs.lineHeight, letterSpacing: cs.letterSpacing, strokeW: cs.webkitTextStrokeWidth, textShadow: cs.textShadow.slice(0, 80), h: +b.height.toFixed(1), w: +b.width.toFixed(1), live: n.getAttribute('data-akari-live-override') }); }
      return chain; })()`);
    const capClip = async () => { const s = (await itemRects(['captions'])).items.captions; const st = (await itemRects(['captions'])).stage;
      return s ? { x: outer.x + st.x, y: outer.y + s.top - 50, width: st.width, height: Math.min(st.height, s.height + 100) } : null; };
    for (const [label, name, toward] of [['行間', 'caption-line-height', 'max'], ['字間', 'caption-letter-spacing', 'max'], ['太さ', 'caption-stroke-width', 'max']]) {
      const row = { name };
      try {
        await selectInPreview('captions');
        await clickTab('text');
        const found = await mw(`(() => { const root = ${INSPECTOR}; const f = root.querySelector('[data-akari-ui="field:inspector-${name}"]');
          const r = f?.querySelector('input[type=range]') ?? [...root.querySelectorAll('input[type=range]')].find(x => x.getAttribute('aria-label') === '${label} スライダー');
          if (!r) return null; r.setAttribute('data-l1-cap', '1'); r.scrollIntoView({ block: 'center' }); return { aria: r.getAttribute('aria-label'), min: r.min, max: r.max, value: r.value }; })()`);
        if (!found) { row.skipped = 'slider not found'; out.sliders.push(row); continue; }
        row.range = found;
        await sleep(300);
        const rr = await mw(`(() => { const b = document.querySelector('[data-l1-cap]').getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; })()`);
        const clip = await capClip();
        const head = await bothText();
        const p0 = await clipPixels(clip);
        row.before = await capStyle();
        const frac = (Number(found.value) - Number(found.min)) / ((Number(found.max) - Number(found.min)) || 1);
        const sx = rr.x + 8 + (rr.w - 16) * frac, sy = rr.y + rr.h / 2;
        const target = rr.x + rr.w - 10;
        const mark = writeMark();
        const series = [];
        let lastPx;
        await mouse('mouseMoved', sx, sy); await mouse('mousePressed', sx, sy); await sleep(80);
        for (let i = 1; i <= 3; i++) {
          await mouse('mouseMoved', sx + (target - sx) * i / 3, sy, 1); await sleep(300);
          lastPx = await clipPixels(clip);
          series.push({ step: i, value: await mw(`document.querySelector('[data-l1-cap]')?.value ?? null`), style: await capStyle(), diffFromStart: pixelDiff(p0, lastPx), writes: writesSince(mark), shot: await windowShot(`t-${name}-${i}`) });
        }
        await mouse('mouseReleased', target, sy); await sleep(2000);
        const committed = await clipPixels(clip);
        row.series = series; row.writes = writesSince(mark);
        row.after = await capStyle();
        row.liveLastVsCommitted = pixelDiff(lastPx, committed);
        row.startVsCommitted = pixelDiff(p0, committed);
        if ((await bothText()) !== head) { await undoOnce(); row.undoEqualsHead = (await bothText()) === head; }
      } catch (e) { row.error = clean(e?.stack ?? e).slice(0, 600); }
      out.sliders.push(row);
      await resetToHead();
    }
    // Esc: 字間のスライダー中に Esc
    try {
      await selectInPreview('captions'); await clickTab('text');
      const rr = await mw(`(() => { const r = [...${INSPECTOR}.querySelectorAll('input[type=range]')].find(x => x.getAttribute('aria-label') === '字間 スライダー'); if (!r) return null; r.scrollIntoView({ block: 'center' }); const b = r.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height, v: r.value, min: r.min, max: r.max }; })()`);
      if (rr) {
        await sleep(300);
        const clip = await capClip(); const head = await bothText(); const p0 = await clipPixels(clip); const mark = writeMark();
        const frac = (Number(rr.v) - Number(rr.min)) / ((Number(rr.max) - Number(rr.min)) || 1);
        const sx = rr.x + 8 + (rr.w - 16) * frac, sy = rr.y + rr.h / 2;
        await mouse('mouseMoved', sx, sy); await mouse('mousePressed', sx, sy); await sleep(80);
        for (let i = 1; i <= 3; i++) { await mouse('mouseMoved', sx + (rr.x + rr.w - 10 - sx) * i / 3, sy, 1); await sleep(200); }
        await sleep(300);
        const during = pixelDiff(p0, await clipPixels(clip));
        await key('Escape', 'Escape', 27); await sleep(500);
        const afterEsc = pixelDiff(p0, await clipPixels(clip));
        await mouse('mouseReleased', rr.x + rr.w - 10, sy); await sleep(1500);
        out.esc = { during, afterEsc, afterRelease: pixelDiff(p0, await clipPixels(clip)), writes: writesSince(mark), unchanged: (await bothText()) === head };
      }
    } catch (e) { out.esc = { error: clean(e?.stack ?? e).slice(0, 600) }; }
    await resetToHead();
    return out;
  });

  // a. スクロールの保持
  await scenario('a-scroll', async () => {
    const out = {};
    await selectInPreview('box-a');
    out.initial = await inspectorState();
    const bottom = await scrollInspector('bottom');
    await sleep(300);
    out.bottom = bottom;
    // a1. プレビューで図形を動かす
    const o = await itemRects(['box-a']);
    const b = o.items['box-a'];
    const start = vp({ x: b.cx, y: b.cy });
    const mark = writeMark();
    await mouse('mouseMoved', start.x, start.y); await mouse('mousePressed', start.x, start.y); await sleep(80);
    for (let i = 1; i <= 12; i++) { await mouse('mouseMoved', start.x + 60 * i / 12, start.y + 30 * i / 12, 1); await sleep(30); }
    await mouse('mouseReleased', start.x + 60, start.y + 30); await sleep(1800);
    out.afterPreviewDrag = await inspectorState();
    out.afterPreviewDragWrites = writesSince(mark);
    out.afterPreviewDragShot = await windowShot('a1-after-preview-drag');
    // a2. 下の方の数値を変える（見えている最後の数値欄）
    await scrollInspector('bottom'); await sleep(300);
    out.bottom2 = await inspectorState();
    const target = await mw(`(() => { const root = ${INSPECTOR}; const rr = root.getBoundingClientRect();
      const inputs = [...root.querySelectorAll('input.akari-inspector-number-input, input[type=number]')].filter(i => { const b = i.getBoundingClientRect(); return b.height > 0 && b.top >= rr.top && b.bottom <= rr.bottom && !i.disabled; });
      const i = inputs.at(-1); if (!i) return null; i.setAttribute('data-l1-target', '1'); const b = i.getBoundingClientRect();
      return { field: i.closest('[data-akari-ui^="field:"]')?.getAttribute('data-akari-ui') ?? i.closest('[data-akari-field]')?.getAttribute('data-akari-field'), aria: i.getAttribute('aria-label'), value: i.value, cx: b.x + b.width / 2, cy: b.y + b.height / 2 }; })()`);
    out.numberTarget = target;
    if (target) {
      const mark2 = writeMark();
      await mw(`(() => { const i = ${INSPECTOR}.querySelector('[data-l1-target]'); i.focus(); i.select?.(); return document.activeElement === i; })()`);
      const next = String(Number(target.value || 0) + 3);
      await main.send('Input.insertText', { text: next });
      await sleep(400);
      out.whileTyping = await inspectorState();
      await key('Enter', 'Enter', 13);
      await sleep(1800);
      out.afterNumberCommit = await inspectorState();
      out.afterNumberWrites = writesSince(mark2);
      out.afterNumberShot = await windowShot('a2-after-number');
    }
    // a3. 同じ item の数値を Tab で次の欄へ（フォーカスの保持）
    await scrollInspector(120); await sleep(200);
    const xr = await fieldRect('transform-x', 'input');
    if (xr) {
      const mark3 = writeMark();
      await clickAt({ x: xr.cx, y: xr.cy });
      await mw(`(() => { const i = document.activeElement; if (i?.select) i.select(); return true; })()`);
      const before = await inspectorState();
      await main.send('Input.insertText', { text: String(Number(before.x || 0) + 5) });
      await key('Tab', 'Tab', 9);
      await sleep(1800);
      out.tabCommit = { before, after: await inspectorState(), writes: writesSince(mark3), writeLog: writes.slice(mark3) };
    }
    // a4. 別の item を選ぶ → 先頭へ
    await scrollInspector('bottom'); await sleep(300);
    out.beforeOtherSelect = await inspectorState();
    await selectInPreview('box-b');
    out.afterOtherSelect = await inspectorState();
    return out;
  });

  // b. プレビューのドラッグ中のインスペクターの数値
  await scenario('b-preview-to-inspector', async () => {
    const out = {};
    await selectInPreview('box-a');
    await scrollInspector(0); await sleep(300);
    out.initial = await inspectorState();
    const o = await itemRects(['box-a']);
    const b = o.items['box-a'];
    const start = vp({ x: b.cx, y: b.cy });
    const mark = writeMark();
    const series = [];
    await mouse('mouseMoved', start.x, start.y); await mouse('mousePressed', start.x, start.y); await sleep(80);
    for (let i = 1; i <= 8; i++) {
      await mouse('mouseMoved', start.x + 100 * i / 8, start.y + 40 * i / 8, 1); await sleep(60);
      const s = await inspectorState();
      series.push({ step: i, dxScreen: +(100 * i / 8).toFixed(1), x: s.x, y: s.y, writes: writesSince(mark) });
      if (i === 4) out.midShot = await windowShot('b-mid-drag');
    }
    out.series = series;
    await mouse('mouseReleased', start.x + 100, start.y + 40);
    await sleep(80);
    out.justAfterRelease = await inspectorState();
    await sleep(1800);
    out.afterRelease = await inspectorState();
    out.writes = writesSince(mark);
    out.written = findItem(JSON.parse(await readEditText()), 'box-a')?.transform;
    // つまみ（右下の角）で大きさ
    const handles = await pv(`(() => { const q = s => { const e = [...document.querySelectorAll(s)].find(n => n.getBoundingClientRect().width > 0 && getComputedStyle(n).display !== 'none'); if (!e) return null; const b = e.getBoundingClientRect(); return { cx: b.left + b.width / 2, cy: b.top + b.height / 2 }; };
      return { se: q('.akari-interaction-handle.is-se'), rotate: q('.akari-interaction-action.is-rotate, .akari-interaction-handle.is-rotate') }; })()`);
    out.handles = handles;
    for (const [kind, h, d] of [['resize', handles.se, { x: 60, y: 40 }], ['rotate', handles.rotate, { x: 80, y: 60 }]]) {
      if (!h) { out[kind] = 'handle not found'; continue; }
      const cur = await pv(`(() => { const q = s => { const e = [...document.querySelectorAll(s)].find(n => n.getBoundingClientRect().width > 0 && getComputedStyle(n).display !== 'none'); if (!e) return null; const b = e.getBoundingClientRect(); return { cx: b.left + b.width / 2, cy: b.top + b.height / 2 }; };
        return ${kind === 'resize' ? `q('.akari-interaction-handle.is-se')` : `q('.akari-interaction-action.is-rotate, .akari-interaction-handle.is-rotate')`}; })()`) ?? h;
      const p = vp({ x: cur.cx, y: cur.cy });
      const m2 = writeMark();
      const s2 = [];
      await mouse('mouseMoved', p.x, p.y); await mouse('mousePressed', p.x, p.y); await sleep(80);
      for (let i = 1; i <= 6; i++) { await mouse('mouseMoved', p.x + d.x * i / 6, p.y + d.y * i / 6, 1); await sleep(60); const s = await inspectorState(); s2.push({ step: i, scale: s.scale, rotate: s.rotate, x: s.x, y: s.y, writes: writesSince(m2) }); }
      if (kind === 'rotate') out.rotateMidShot = await windowShot('b-mid-rotate');
      await mouse('mouseReleased', p.x + d.x, p.y + d.y); await sleep(1800);
      out[kind] = { series: s2, after: await inspectorState(), writes: writesSince(m2) };
    }
    return out;
  });

  // c. インスペクター → プレビュー（数値のスクラブ・スライダー）
  await scenario('c-inspector-to-preview', async () => {
    const out = {};
    await selectInPreview('box-a');
    await scrollInspector(0); await sleep(300);
    const head = await readEditText();
    out.initialRect = (await itemRects(['box-a'])).items['box-a'];
    // c1. x の数値のスクラブ（つまみのアイコンを左右にドラッグ）
    const h = await fieldRect('transform-x', '.akari-inspector-number-handle');
    out.scrubHandle = h;
    if (h) {
      const mark = writeMark();
      const series = [];
      await mouse('mouseMoved', h.cx, h.cy); await mouse('mousePressed', h.cx, h.cy); await sleep(80);
      for (let i = 1; i <= 9; i++) {
        await mouse('mouseMoved', h.cx + 20 * i, h.cy, 1); await sleep(120);
        const r = (await itemRects(['box-a'])).items['box-a'];
        const s = await inspectorState();
        const row = { step: i, dxScrub: 20 * i, inspectorX: s.x, previewLeft: r?.left, writes: writesSince(mark) };
        if (i % 3 === 0) row.shot = await windowShot(`c1-scrub-${i}`);
        series.push(row);
      }
      await mouse('mouseReleased', h.cx + 180, h.cy); await sleep(1800);
      out.scrub = { series, afterRelease: (await itemRects(['box-a'])).items['box-a'], inspector: await inspectorState(), writes: writesSince(mark),
        written: findItem(JSON.parse(await readEditText()), 'box-a')?.transform };
      await undoOnce();
      out.scrub.undoEqualsHead = (await readEditText()) === head;
      out.scrub.afterUndoRect = (await itemRects(['box-a'])).items['box-a'];
    }
    // c2. スクラブ中に Esc → 元の見た目
    const h2 = await fieldRect('transform-y', '.akari-inspector-number-handle');
    if (h2) {
      const mark = writeMark();
      await mouse('mouseMoved', h2.cx, h2.cy); await mouse('mousePressed', h2.cx, h2.cy); await sleep(80);
      for (let i = 1; i <= 6; i++) { await mouse('mouseMoved', h2.cx + 25 * i, h2.cy, 1); await sleep(80); }
      await sleep(300);
      const during = (await itemRects(['box-a'])).items['box-a'];
      const duringShot = await windowShot('c2-esc-during');
      await key('Escape', 'Escape', 27); await sleep(400);
      const afterEsc = (await itemRects(['box-a'])).items['box-a'];
      await mouse('mouseReleased', h2.cx + 150, h2.cy); await sleep(1500);
      out.esc = { during, duringShot, afterEsc, afterRelease: (await itemRects(['box-a'])).items['box-a'], writes: writesSince(mark),
        editUnchanged: (await readEditText()) === head, afterEscShot: await windowShot('c2-esc-after') };
    }
    // c3. 数値の入力中（打ち込み途中）の見た目 → Enter で 1 回
    const xr = await fieldRect('transform-x', 'input');
    if (xr) {
      const mark = writeMark();
      await clickAt({ x: xr.cx, y: xr.cy });
      await mw(`(() => { const i = document.activeElement; if (i?.select) i.select(); return true; })()`);
      await main.send('Input.insertText', { text: '900' }); await sleep(600);
      out.typing = { duringRect: (await itemRects(['box-a'])).items['box-a'], writesDuring: writesSince(mark) };
      await key('Enter', 'Enter', 13); await sleep(1800);
      out.typing.afterRect = (await itemRects(['box-a'])).items['box-a'];
      out.typing.writes = writesSince(mark);
      await undoOnce();
      out.typing.undoEqualsHead = (await readEditText()) === head;
    }
    // c4. スライダー（見つかったもの全部を 1 本ずつ・図形 → 写真）
    out.sliders = [];
    for (const [id, tab] of [['box-a', 'video'], ['photo-a', 'edit'], ['photo-a', 'adjust'], ['captions', 'text']]) {
      await selectInPreview(id);
      await clickTab(tab);
      const ranges = await mw(`(() => { const root = ${INSPECTOR}; return [...root.querySelectorAll('input[type=range]')].filter(r => r.getClientRects().length > 0).map((r, i) => { r.setAttribute('data-l1-range', String(i)); return { i, aria: r.getAttribute('aria-label'), min: r.min, max: r.max, value: r.value, visibleTab: r.getBoundingClientRect().width > 0 }; }); })()`);
      for (const range of ranges.slice(0, 4)) {
        await mw(`(() => { const r = ${INSPECTOR}.querySelector('[data-l1-range="${range.i}"]'); r?.scrollIntoView({ block: 'center' }); return true; })()`);
        await sleep(300);
        const rr = await mw(`(() => { const r = ${INSPECTOR}.querySelector('[data-l1-range="${range.i}"]'); if (!r) return null; const b = r.getBoundingClientRect(); return b.width > 0 ? { x: b.x, y: b.y, w: b.width, h: b.height } : null; })()`);
        if (!rr) { out.sliders.push({ id, tab, ...range, skipped: 'not visible' }); continue; }
        const before = (await readEditText()) + (await readCaptionsText());
        const mark = writeMark();
        const frac = (Number(range.value) - Number(range.min)) / ((Number(range.max) - Number(range.min)) || 1);
        const sx = rr.x + 8 + (rr.w - 16) * frac, sy = rr.y + rr.h / 2;
        const series = [];
        await mouse('mouseMoved', sx, sy); await mouse('mousePressed', sx, sy); await sleep(80);
        const target = frac > 0.5 ? rr.x + 10 : rr.x + rr.w - 10;
        for (let i = 1; i <= 3; i++) {
          await mouse('mouseMoved', sx + (target - sx) * i / 3, sy, 1); await sleep(250);
          const r = (await itemRects([id])).items[id];
          series.push({ step: i, rect: r, writes: writesSince(mark), shot: await windowShot(`c4-${id}-range${range.i}-${i}`) });
        }
        await mouse('mouseReleased', target, sy); await sleep(1800);
        const writesTotal = writesSince(mark);
        const changed = ((await readEditText()) + (await readCaptionsText())) !== before;
        let undoOk = null;
        if (changed) { await undoOnce(); undoOk = ((await readEditText()) + (await readCaptionsText())) === before; }
        out.sliders.push({ id, tab, ...range, series, writes: writesTotal, changed, undoOk });
        await resetToHead();
      }
    }
    // c5. 写真の色の欄（数値のスクラブ）→ プレビューの写真の明るさ
    await key('Escape', 'Escape', 27); await sleep(300);
    await selectInPreview('photo-a');
    out.photoAdjustSelectShot = await windowShot('c5-photo-select');
    out.photoAdjustTabClicked = await clickTab('adjust');
    if (!out.photoAdjustTabClicked) {
      out.photoAdjustFocus = await command('akari.timeline.focusItem', { itemId: 'photo-a', reveal: true }); await sleep(1200);
      out.photoAdjustTabClicked = await clickTab('adjust');
    }
    out.photoAdjustFields = await mw(`(() => { const root = ${INSPECTOR}; return { rows: [...root.querySelectorAll('[data-akari-field]')].filter(f => f.getClientRects().length).map(f => f.getAttribute('data-akari-field')),
      numbers: [...root.querySelectorAll('[data-akari-ui^="field:inspector-"]')].filter(f => f.getClientRects().length).map(f => f.getAttribute('data-akari-ui').slice(16)),
      sections: [...root.querySelectorAll('[data-akari-ui^="section:inspector-"]')].map(x => x.getAttribute('data-akari-ui') + (x.open === false ? '(closed)' : '')),
      handles: root.querySelectorAll('.akari-inspector-number-handle').length, ranges: root.querySelectorAll('input[type=range]').length }; })()`);
    const pick = await mw(`(() => { const root = ${INSPECTOR}; const rows = [...root.querySelectorAll('[data-akari-field], [data-akari-ui^="field:inspector-"]')].filter(f => f.getClientRects().length && f.querySelector('.akari-inspector-number-handle'));
      const r = rows.find(f => /exposure|bright/i.test((f.getAttribute('data-akari-field') ?? '') + (f.getAttribute('data-akari-ui') ?? ''))) ?? rows[0]; if (!r) return null;
      r.setAttribute('data-l1-adjust', '1'); r.scrollIntoView({ block: 'center' }); return r.getAttribute('data-akari-field') ?? r.getAttribute('data-akari-ui'); })()`);
    out.photoAdjustPick = pick ?? null;
    if (pick) {
      await sleep(300);
      const h = await mw(`(() => { const e = ${INSPECTOR}.querySelector('[data-l1-adjust] .akari-inspector-number-handle'); const b = e.getBoundingClientRect(); return { cx: b.x + b.width / 2, cy: b.y + b.height / 2 }; })()`);
      const pr = (await itemRects(['photo-a'])).items['photo-a'];
      const clip = pr ? { x: outer.x + pr.left + 4, y: outer.y + pr.top + 4, width: Math.max(8, pr.width - 8), height: Math.max(8, pr.height - 8) } : null;
      if (h && clip) {
        const before = await readEditText();
        const mark = writeMark();
        const series = [{ step: 0, luma: await meanLuma(clip) }];
        await mouse('mouseMoved', h.cx, h.cy); await mouse('mousePressed', h.cx, h.cy); await sleep(80);
        for (let i = 1; i <= 3; i++) {
          await mouse('mouseMoved', h.cx + 40 * i, h.cy, 1); await sleep(400);
          series.push({ step: i, value: await mw(`${INSPECTOR}.querySelector('[data-l1-adjust] input')?.value ?? null`), luma: await meanLuma(clip), writes: writesSince(mark), shot: await windowShot(`c5-photo-adjust-${i}`) });
        }
        await mouse('mouseReleased', h.cx + 120, h.cy); await sleep(1800);
        const writesTotal = writesSince(mark);
        const changed = (await readEditText()) !== before;
        series.push({ step: 'released', luma: await meanLuma(clip) });
        let undoOk = null;
        if (changed) { await undoOnce(); undoOk = (await readEditText()) === before; }
        out.photoAdjust = { series, writes: writesTotal, changed, undoOk };
        await resetToHead();
      }
    }
    return out;
  });

  // d. 回帰の最小: H-1 のつまみ（大きさ → undo 1 回）/ FX-4 の写真の選択 / F-0 の消しゴム（押して aria-pressed）
  await scenario('d-regression', async () => {
    const out = {};
    const head = await readEditText();
    await selectInPreview('photo-a');
    out.photoSelected = await mw(`(() => { const s = document.querySelector('.akari-annotations-selected'); return s ? (s.getAttribute('data-akari-ui') || s.textContent.trim().slice(0, 40)) : null; })()`);
    out.photoHeader = (await inspectorState())?.header;
    await clickTab('edit');
    const eraser = await mw(`(() => { const b = ${INSPECTOR}?.querySelector('[data-akari-field="photo-brush-start"] button'); if (!b) return null; b.scrollIntoView({ block: 'center' }); b.click(); return b.getAttribute('aria-pressed'); })()`);
    await sleep(600);
    out.eraserPressed = eraser === null ? null : await mw(`${INSPECTOR}?.querySelector('[data-akari-field="photo-brush-start"] button')?.getAttribute('aria-pressed')`);
    if (out.eraserPressed === 'true') {
      const o = await itemRects(['photo-a']);
      const b = o.items['photo-a'];
      const mark = writeMark();
      const p = vp({ x: b.cx - 30, y: b.cy });
      await mouse('mouseMoved', p.x, p.y); await mouse('mousePressed', p.x, p.y); await sleep(60);
      for (let i = 1; i <= 8; i++) { await mouse('mouseMoved', p.x + 8 * i, p.y + 3 * i, 1); await sleep(30); }
      await mouse('mouseReleased', p.x + 64, p.y + 24); await sleep(1800);
      out.eraseWrites = writesSince(mark);
      out.eraseCount = (findItem(JSON.parse(await readEditText()), 'photo-a')?.erase ?? []).length;
      await key('Escape', 'Escape', 27); await sleep(500);
      out.eraserAfterEsc = await mw(`${INSPECTOR}?.querySelector('[data-akari-field="photo-brush-start"] button')?.getAttribute('aria-pressed')`);
      await undoOnce();
      out.eraseUndoEqualsHead = (await readEditText()) === head;
    }
    await resetToHead();
    await selectInPreview('box-b');
    const se = await pv(`(() => { const e = [...document.querySelectorAll('.akari-interaction-handle.is-se')].find(n => n.getBoundingClientRect().width > 0); if (!e) return null; const b = e.getBoundingClientRect(); return { cx: b.left + b.width / 2, cy: b.top + b.height / 2 }; })()`);
    if (se) {
      const before = (await itemRects(['box-b'])).items['box-b'];
      const mark = writeMark();
      const p = vp({ x: se.cx, y: se.cy });
      await mouse('mouseMoved', p.x, p.y); await mouse('mousePressed', p.x, p.y); await sleep(80);
      for (let i = 1; i <= 8; i++) { await mouse('mouseMoved', p.x + 5 * i, p.y + 4 * i, 1); await sleep(30); }
      await mouse('mouseReleased', p.x + 40, p.y + 32); await sleep(1800);
      const after = (await itemRects(['box-b'])).items['box-b'];
      out.handle = { before, after, topLeftDelta: { x: +(after.left - before.left).toFixed(1), y: +(after.top - before.top).toFixed(1) }, writes: writesSince(mark),
        written: findItem(JSON.parse(await readEditText()), 'box-b')?.transform };
      await undoOnce();
      out.handle.undoEqualsHead = (await readEditText()) === head;
    }
    out.shot = await windowShot('d-regression');
    return out;
  });

  // e. キーフレームを持つ item: 再生位置 5 秒で x のスクラブ中のプレビュー
  await scenario('e-keyframed', async () => {
    const out = {};
    await seek(5);
    await selectInPreview('box-kf');
    await scrollInspector(0); await sleep(300);
    out.initial = { inspector: await inspectorState(), rect: (await itemRects(['box-kf'])).items['box-kf'] };
    const h = await fieldRect('transform-x', '.akari-inspector-number-handle');
    if (h) {
      const mark = writeMark();
      await mouse('mouseMoved', h.cx, h.cy); await mouse('mousePressed', h.cx, h.cy); await sleep(80);
      const series = [];
      for (let i = 1; i <= 4; i++) { await mouse('mouseMoved', h.cx + 30 * i, h.cy, 1); await sleep(150); series.push({ step: i, inspectorX: (await inspectorState()).x, rect: (await itemRects(['box-kf'])).items['box-kf'], writes: writesSince(mark) }); }
      out.shot = await windowShot('e-kf-scrub');
      await mouse('mouseReleased', h.cx + 120, h.cy); await sleep(1800);
      out.series = series;
      out.after = { inspector: await inspectorState(), rect: (await itemRects(['box-kf'])).items['box-kf'], writes: writesSince(mark),
        item: findItem(JSON.parse(await readEditText()), 'box-kf') };
    }
    // プレビューでドラッグ中の数値（キーフレーム付き）
    const o = await itemRects(['box-kf']);
    const b = o.items['box-kf'];
    const start = vp({ x: b.cx, y: b.cy });
    await mouse('mouseMoved', start.x, start.y); await mouse('mousePressed', start.x, start.y); await sleep(80);
    const s2 = [];
    for (let i = 1; i <= 4; i++) { await mouse('mouseMoved', start.x + 20 * i, start.y, 1); await sleep(80); s2.push((await inspectorState()).x); }
    await mouse('mouseReleased', start.x + 80, start.y); await sleep(1500);
    out.dragSeries = s2;
    out.afterDrag = (await inspectorState()).x;
    return out;
  });
}

// ---- 起動 --------------------------------------------------------------------------------
const report = { label, port };
try {
  await mkdir(outDir, { recursive: true });
  await makeFixture();
  const profile = path.join(scratch, 'profile'), config = path.join(scratch, 'config'), home = path.join(scratch, 'akari-home');
  await Promise.all([mkdir(profile), mkdir(config), mkdir(home)]);
  child = spawn(electron, [shellDir, project, `--remote-debugging-port=${port}`, '--hostname=127.0.0.1', `--port=${httpPort}`,
    `--user-data-dir=${profile}`, '--no-sandbox'], { cwd: shellDir, env: { ...process.env, THEIA_CONFIG_DIR: config, AKARI_HOME: home }, stdio: 'ignore', detached: true });
  report.pid = child.pid;
  const isShell = v => v.type === 'page' && v.url && !v.url.startsWith('devtools:');
  const target = (await waitForJson(`http://127.0.0.1:${port}/json/list`, v => v.find(isShell))).find(isShell);
  main = new CDP(target.webSocketDebuggerUrl); await main.connect(); track(main); await main.send('Runtime.enable'); await main.send('Page.enable');
  const version = await waitForJson(`http://127.0.0.1:${port}/json/version`, v => v.webSocketDebuggerUrl);
  browser = new CDP(version.webSocketDebuggerUrl); await browser.connect(); track(browser);
  await browser.send('Target.setDiscoverTargets', { discover: true }).catch(() => {});
  try { const { windowId } = await browser.send('Browser.getWindowForTarget', { targetId: target.id });
    await browser.send('Browser.setWindowBounds', { windowId, bounds: { left: 0, top: 0, width: 1680, height: 1000, windowState: 'normal' } }); } catch {}
  await sleep(10000);
  const clickOpenOnly = () => mw(`(() => { const b = [...document.querySelectorAll('button')].find(x => ['開くだけ', '後で'].includes(x.textContent?.trim())); if (b) b.click(); return !!b; })()`);
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
  for (let i = 0; i < 60; i++) { if (await pv(`Number(document.getElementById('seek')?.max || 0) >= 9`).catch(() => false)) break; await sleep(500); }
  report.inspectorOpen = await command('akari.inspector.open');
  await sleep(1500);
  await clickOpenOnly();
  await seek(1);
  outer = await outerOffset();
  report.outer = outer;
  report.windowShot = await windowShot('window');
  startWatch();
  await scenarios();
} catch (e) { report.error = clean(e?.stack ?? e); }
finally {
  clearInterval(watcher);
  main?.close(); browser?.close();
  if (child?.pid) { try { process.kill(-child.pid, 'SIGTERM'); } catch {} await sleep(2000); try { process.kill(-child.pid, 'SIGKILL'); } catch {} }
  // 別のプロセスグループへ抜けたバックエンド（この実行の一時ディレクトリを引数に持つものだけ）も止める
  for (const line of run('/bin/ps', ['-axo', 'pid=,command=']).stdout.split('\n')) {
    const m = line.trim().match(/^(\d+)\s+(.*)$/);
    if (m && m[2].includes(scratch)) { try { process.kill(Number(m[1]), 'SIGKILL'); } catch {} }
  }
}
report.results = results;
report.allConsoleErrors = [...new Set(consoleErrors.map(clean))].slice(-25);
await writeFile(path.join(outDir, `${label}.json`), `${clean(JSON.stringify(report, null, 2))}\n`);
await rm(scratch, { recursive: true, force: true });
console.log(clean(JSON.stringify(report, null, 1)).slice(0, 12000));
