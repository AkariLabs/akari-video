#!/usr/bin/env node
// 字幕・置いた文字・断片オーバーレイの文字入力を、合成プロジェクトと実 Electron（CDP の実キー・実マウス）で記録する。
// 使い方: node run-l1.mjs --label before|after [--shell <apps/shell>] [--port 9625] [--skip-osr] [--only a,b]
// 出力: <label>.json と <label>-*.png（このディレクトリ）。一時ディレクトリ・専用の userData / AKARI_HOME / THEIA_CONFIG_DIR を使い、
// 起動した Electron は自分のプロセスグループだけを止める。システムのクリップボード（文字）は開始時に退避し終了時に戻す。
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : fallback; };
const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../../../../..');
const shellDir = path.resolve(arg('shell', path.join(repo, 'apps/shell')));
const label = arg('label', 'after');
const outDir = path.resolve(arg('out', here));
const only = (arg('only', '') || '').split(',').filter(Boolean);
const port = Number(arg('port', '9625'));
const httpPort = Number(arg('http-port', '49625'));
const electron = path.join(shellDir, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
const ffmpeg = process.env.FFMPEG ?? 'ffmpeg';

const scratch = await realpath(await mkdtemp('/tmp/caption-text-entry-l1-'));
const project = path.join(scratch, 'project');
const editPath = path.join(project, 'edit.json');
const captionsPath = path.join(project, 'captions.json');
const editUri = pathToFileURL(editPath).href;
const clean = v => String(v).replaceAll(repo, '<repo>').replaceAll(scratch, '<scratch>').replace(/\/Users\/[^\s"')]+/g, '<local>')
  .replace(/\/(private\/)?(tmp|var)\/[^\s"')]+/g, '<tmp>');
const run = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 1 << 28, ...opts });

// ---- fixture ----------------------------------------------------------------------------------------------
// 1920×1080 / 30fps / 12 秒。字幕 2 本（改行あり・1 行）+ 置いた文字 1 本 + 断片オーバーレイ（素の HTML の文字）+ 図形 1 つ。
const EDIT = {
  version: 2,
  output: { width: 1920, height: 1080, fps: 30 },
  sources: [{ id: 'base', path: 'assets/base.mp4' }],
  tracks: [
    { id: 'v-main', lane: 'visual', name: '本編', items: [{ id: 'cut-1', at: 0, duration: 360, source: { kind: 'media', src: 'base', in: 0, out: 12 } }] },
    { id: 'v-box', lane: 'visual', name: 'box-a', items: [{ id: 'box-a', at: 0, duration: 360, transform: { x: 1500, y: 260 },
      source: { kind: 'shape', shape: 'rect', params: { width: 240, height: 160, fill: '#3b82f6' } } }] },
    { id: 'v-html', lane: 'visual', name: 'html', items: [{ id: 'ov-plain', at: 0, duration: 360, transform: { x: 0, y: 0 },
      source: { kind: 'html', path: 'overlays/plain.html' } }] },
    { id: 'v-text', lane: 'visual', name: 'text', items: [{ id: 'captions', name: '字幕', at: 0, duration: 360, source: { kind: 'captions', path: 'captions.json' }, items: [] }] }
  ]
};
const CAPTIONS = { captions: [
  { id: 'c-0001', start: 0, end: 4, time_domain: 'output', text: '一行目の字幕\n二行目の字幕', speaker: null, sourceRef: null, edited: true },
  { id: 'c-0002', start: 4, end: 8, time_domain: 'output', text: '一行だけの字幕', speaker: null, sourceRef: null, edited: true },
  { id: 'c-0101', start: 8, end: 12, time_domain: 'output', text: '置いた文字', speaker: null, sourceRef: null, edited: true,
    text_style: { position: { x: 0.45, y: 0.45 }, text_anchor: 'mc' } }
] };
const OVERLAY = '<div style="position:absolute;left:120px;top:90px;color:#fff;font:64px sans-serif;white-space:pre">断片の文字</div>\n';

async function makeFixture() {
  await mkdir(path.join(project, 'assets'), { recursive: true });
  await mkdir(path.join(project, 'overlays'), { recursive: true });
  await mkdir(path.join(project, '.akari'), { recursive: true });
  const r = run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-f', 'lavfi', '-i', 'color=c=0x44403c:s=1920x1080:d=12:r=30',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-g', '30', path.join(project, 'assets', 'base.mp4')]);
  if (r.status !== 0) throw new Error(`ffmpeg base: ${r.stderr}`);
  await writeFile(path.join(project, 'overlays', 'plain.html'), OVERLAY);
  await writeFile(editPath, `${JSON.stringify(EDIT, null, 2)}\n`);
  await writeFile(captionsPath, `${JSON.stringify(CAPTIONS, null, 2)}\n`);
  await writeFile(path.join(project, 'review.json'), '{ "version": 0, "annotations": [] }\n');
  await writeFile(path.join(project, '.akari', 'lint.json'), '{"version":1,"verdict":"pass"}\n');
  for (const a of [['init', '-q'], ['config', 'user.email', 'l1@localhost'], ['config', 'user.name', 'l1'], ['add', '-A'], ['commit', '-q', '-m', 'fixture']]) {
    const g = run('/usr/bin/git', a, { cwd: project });
    if (g.status !== 0) throw new Error(`git ${a[0]}: ${g.stderr}`);
  }
}

// ---- 書き込みの数え方（15ms 毎に中身を見て、変わった回数を数える）--------------------------------------------
const lastTexts = new Map();
const writes = [];
let watcher;
function startWatch() {
  for (const f of [editPath, captionsPath]) lastTexts.set(f, readFileSync(f, 'utf8'));
  watcher = setInterval(() => {
    for (const f of [editPath, captionsPath]) {
      let t; try { t = readFileSync(f, 'utf8'); } catch { continue; }
      if (t && t !== lastTexts.get(f)) { lastTexts.set(f, t); writes.push({ at: Date.now(), file: path.basename(f) }); }
    }
  }, 15);
}
const mark = () => writes.length;
const changes = since => writes.slice(since).map(({ file }) => file);

// ---- CDP ---------------------------------------------------------------------------------------------------
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
async function waitForJson(url, pred, ms = 180000) {
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
const pv = async expr => { try { return await evaluate(browser, expr, view.contextId, view.sessionId); } catch (error) { if (!/Cannot find context|Session with given id not found/.test(String(error))) throw error; view = await findPreview(20000); if (!view) throw error; return evaluate(browser, expr, view.contextId, view.sessionId); } };
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
async function outerOffset() {
  return mw(`(() => { const f = [...document.querySelectorAll('iframe')].filter(f => /webview/.test(f.src || '')).map(f => f.getBoundingClientRect()).filter(r => r.width > 100 && r.height > 100).sort((a, b) => b.width * b.height - a.width * a.height)[0]; return f ? { x: f.x, y: f.y, w: f.width, h: f.height } : null; })()`);
}
let outer;
async function mouse(type, x, y, buttons, extra = {}) {
  await main.send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' && !buttons ? 'none' : 'left',
    buttons: buttons ?? (type === 'mousePressed' ? 1 : 0), clickCount: type === 'mouseMoved' ? 0 : 1, ...extra });
}
const vp = p => ({ x: outer.x + p.x, y: outer.y + p.y });
async function clickAt(pt) { await mouse('mouseMoved', pt.x, pt.y); await mouse('mousePressed', pt.x, pt.y); await sleep(60); await mouse('mouseReleased', pt.x, pt.y); await sleep(700); }
async function dblAt(pt) {
  await mouse('mouseMoved', pt.x, pt.y);
  await main.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pt.x, y: pt.y, button: 'left', buttons: 1, clickCount: 1 });
  await main.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pt.x, y: pt.y, button: 'left', buttons: 0, clickCount: 1 });
  await sleep(80);
  await main.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pt.x, y: pt.y, button: 'left', buttons: 1, clickCount: 2 });
  await main.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pt.x, y: pt.y, button: 'left', buttons: 0, clickCount: 2 });
  await sleep(600);
}
// 修飾: Alt=1 Ctrl=2 Meta=4 Shift=8。text がある打鍵は既定の入力（改行など）を起こす。commands は mac の編集コマンド。
const MOD = { alt: 1, ctrl: 2, meta: 4, shift: 8 };
const KEYS = {
  Enter: { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' },
  Escape: { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 },
  Backspace: { key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8, commands: ['deleteBackward'] },
  Delete: { key: 'Delete', code: 'Delete', windowsVirtualKeyCode: 46, commands: ['deleteForward'] },
  ArrowLeft: { key: 'ArrowLeft', code: 'ArrowLeft', windowsVirtualKeyCode: 37, commands: ['moveLeft'] },
  a: { key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, commands: ['selectAll'] },
  c: { key: 'c', code: 'KeyC', windowsVirtualKeyCode: 67, commands: ['copy'] },
  v: { key: 'v', code: 'KeyV', windowsVirtualKeyCode: 86, commands: ['paste'] },
  x: { key: 'x', code: 'KeyX', windowsVirtualKeyCode: 88, commands: ['cut'] },
  d: { key: 'd', code: 'KeyD', windowsVirtualKeyCode: 68 }
};
async function press(name, mods = []) {
  const k = KEYS[name]; const modifiers = mods.reduce((s, m) => s | MOD[m], 0);
  const withText = k.text && !(modifiers & (MOD.meta | MOD.ctrl)) ? { text: k.text, unmodifiedText: k.text } : {};
  const cmds = modifiers & (MOD.meta | MOD.ctrl) ? (['a', 'c', 'v', 'x'].includes(name) ? k.commands : undefined) : (['a', 'c', 'v', 'x'].includes(name) ? undefined : k.commands);
  await main.send('Input.dispatchKeyEvent', { type: withText.text ? 'keyDown' : 'rawKeyDown', key: k.key, code: k.code, windowsVirtualKeyCode: k.windowsVirtualKeyCode, modifiers, ...withText, ...(cmds ? { commands: cmds } : {}) });
  await main.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k.key, code: k.code, windowsVirtualKeyCode: k.windowsVirtualKeyCode, modifiers });
  await sleep(450);
}
async function shot(name) {
  const { data } = await main.send('Page.captureScreenshot', { format: 'png' });
  const file = `${label}-${name}.png`;
  await writeFile(path.join(outDir, file), Buffer.from(data, 'base64'));
  return file;
}

const readEditText = () => readFile(editPath, 'utf8');
const readCaptionsText = () => readFile(captionsPath, 'utf8');
const headOf = name => run('/usr/bin/git', ['show', `HEAD:${name}`], { cwd: project }).stdout;
async function resetToHead() {
  let touched = false;
  for (const name of ['edit.json', 'captions.json', 'overlays/plain.html', 'review.json']) {
    const f = path.join(project, name); const head = headOf(name);
    if ((await readFile(f, 'utf8')) !== head) { await writeFile(f, head); touched = true; }
  }
  if (touched) await sleep(2500);
}
// ファイルの要約: 字幕の本文と id、edit.json の item 数、断片の文字
async function files() {
  const caps = JSON.parse(await readCaptionsText()).captions;
  const edit = JSON.parse(await readEditText());
  const items = []; const walk = list => { for (const it of list ?? []) { items.push(it.id); walk(it.items); } };
  for (const t of edit.tracks) walk(t.items);
  const html = await readFile(path.join(project, 'overlays/plain.html'), 'utf8');
  return { captions: caps.map(c => ({ id: c.id, text: c.text })), itemCount: items.length, items, overlayHtml: html.trim().slice(0, 200) };
}
const captionState = () => pv(`(() => {
  const ed = document.querySelector('[data-akari-caption-editing="true"]');
  const host = ed?.closest('.caption-row-plate') ?? [...document.querySelectorAll('.caption-row-plate')].find(e => e.getClientRects().length && e.querySelector('.akari-caption__plate'));
  const block = host?.querySelector('.akari-caption__block') ?? host?.querySelector('.akari-caption__line');
  const r = e => { if (!e) return null; const a = e.getBoundingClientRect(); return { left: a.left, top: a.top, width: a.width, height: a.height, cx: a.left + a.width / 2, cy: a.top + a.height / 2 }; };
  const hint = [...document.querySelectorAll('body *')].filter(e => e.getClientRects().length && e.children.length === 0 && /(⌘|Ctrl)\\s*\\+?\\s*Enter|Esc/.test(e.textContent || '')).map(e => (e.textContent || '').trim()).slice(0, 3);
  return { editing: !!ed, editorText: ed ? ed.innerText : null, editorHtml: ed ? ed.innerHTML.slice(0, 300) : null,
    activeIsEditor: !!ed && document.activeElement === ed, selected: !!host?.hasAttribute('data-selected'),
    hostText: host ? [...host.querySelectorAll('.akari-caption__line')].map(e => e.textContent).join('\\n') : null,
    block: r(ed ?? block), selectBox: (() => { const b = document.getElementById('caption-select-box'); return b && getComputedStyle(b).display !== 'none' && b.getClientRects().length ? r(b) : null; })(),
    hint, seek: Number(document.getElementById('seek')?.value) };
})()`);
const overlayState = () => pv(`(() => {
  const ed = document.querySelector('[data-akari-interaction-editing]');
  const node = document.querySelector('[data-overlay-id="ov-plain"]');
  const text = node && [...node.querySelectorAll('*')].find(e => [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()));
  const r = e => { if (!e) return null; const a = e.getBoundingClientRect(); return { left: a.left, top: a.top, width: a.width, height: a.height, cx: a.left + a.width / 2, cy: a.top + a.height / 2 }; };
  return { editing: !!ed, editorText: ed ? ed.innerText : null, editorHtml: ed ? ed.innerHTML.slice(0, 300) : null, textRect: r(text), text: text?.textContent ?? null,
    selected: node?.getAttribute('data-akari-interaction-selected') ?? null };
})()`);
// 編集要素の中のキャレット位置を決める（where: 'end' | 'start' | 'line2')
const placeCaret = where => pv(`(() => {
  const ed = document.querySelector('[data-akari-caption-editing="true"]') ?? document.querySelector('[data-akari-interaction-editing]');
  if (!ed) return false; ed.focus();
  const texts = []; const w = document.createTreeWalker(ed, NodeFilter.SHOW_TEXT); while (w.nextNode()) texts.push(w.currentNode);
  const range = document.createRange();
  if (${JSON.stringify(where)} === 'start') { range.setStart(texts[0] ?? ed, 0); }
  else if (${JSON.stringify(where)} === 'line2') { const br = ed.querySelector('br'); const next = br?.nextSibling; if (next && next.nodeType === 3) range.setStart(next, 0); else if (br) range.setStartAfter(br); else return 'no-br'; }
  else { range.selectNodeContents(ed); range.collapse(false); }
  range.collapse(true); const s = getSelection(); s.removeAllRanges(); s.addRange(range); return true;
})()`);
// タイムライン側の選択と、ホスト側で観測したキー（捕捉のみ・消費しない）
async function installHostProbe() {
  await mw(`(() => { if (window.__cteProbe) return true; window.__cteProbe = [];
    for (const type of ['keydown']) window.addEventListener(type, e => window.__cteProbe.push({ type, key: e.key, meta: e.metaKey, ctrl: e.ctrlKey, trusted: e.isTrusted, target: (e.target?.tagName || '') + (e.target?.className ? '.' + String(e.target.className).slice(0, 40) : '') }), true);
    return true; })()`);
}
const hostKeys = async () => mw(`(() => { const v = window.__cteProbe.splice(0); return v; })()`);
const hostSelected = () => mw(`[...document.querySelectorAll('.akari-annotations-selected, [aria-selected="true"]')].map(e => e.getAttribute('data-akari-ui') || e.textContent?.trim().slice(0, 30)).slice(0, 5)`);

async function editCaptionAt(seconds) {
  await seek(seconds);
  let s = await captionState(); if (!s.block) throw new Error('caption absent');
  await clickAt(vp({ x: s.block.cx, y: s.block.cy }));
  for (let attempt = 0; attempt < 4; attempt++) {
    s = await captionState();
    if (s.editing) return s;
    if (!s.block) throw new Error('caption absent');
    await dblAt(vp({ x: s.block.cx, y: s.block.cy }));
    await sleep(400 * (attempt + 1));
  }
  s = await captionState();
  if (!s.editing) throw new Error('caption edit did not start');
  return s;
}
async function leaveEditing() {
  if ((await captionState()).editing) await press('Escape');
  if ((await overlayState()).editing) await press('Escape');
  await clickAt({ x: outer.x + 12, y: outer.y + 12 });
}
const results = {};
async function scenario(name, fn) {
  if (only.length && !only.includes(name)) return;
  const m = mark();
  try { results[name] = await fn(); } catch (e) { results[name] = { error: clean(e?.stack ?? e).slice(0, 1200) }; }
  results[name].writeEvents = changes(m);
  try { await leaveEditing(); } catch {}
  await resetToHead();
  await hostKeys().catch(() => []);
}

// (a) 確定・改行のキー。各キーの前に「X」を打ち、キーの後の編集状態・本文・ファイルを記録
async function keyMatrix(prefix, seconds, captionIndex) {
  const rows = [];
  const cases = [['enter', 'Enter', []], ['shift-enter', 'Enter', ['shift']], ['ctrl-enter', 'Enter', ['ctrl']], ['meta-enter', 'Enter', ['meta']], ['escape', 'Escape', []], ['outside-click', null, []], ['enter-then-meta-enter', 'Enter', []]];
  for (const [name, keyName, mods] of cases) {
    if (only.length && !only.includes(`${prefix}-${name}`) && !only.includes(prefix)) continue;
    const m = mark();
    const row = { name };
    try {
      row.start = await editCaptionAt(seconds);
      await placeCaret('end');
      await main.send('Input.insertText', { text: 'X' }); await sleep(250);
      row.typed = await captionState();
      if (name === 'meta-enter' || name === 'ctrl-enter') row.shotEditing = await shot(`${prefix}-editing-hint`);
      if (keyName) await press(keyName, mods); else await clickAt({ x: outer.x + 12, y: outer.y + 12 });
      await sleep(600);
      if (name === 'enter-then-meta-enter') { row.afterEnter = await captionState(); await press('Enter', ['meta']); await sleep(900); }
      row.after = await captionState();
      row.shot = await shot(`${prefix}-${name}`);
      // まだ編集中なら続けて Y を打ち、改行として入ったかを確かめてから Esc で抜ける
      if (row.after.editing) { await main.send('Input.insertText', { text: 'Y' }); await sleep(200); row.afterY = await captionState(); }
      row.fileText = JSON.parse(await readCaptionsText()).captions[captionIndex].text;
    } catch (e) { row.error = clean(e?.stack ?? e).slice(0, 800); }
    row.writeEvents = changes(m);
    try { await leaveEditing(); } catch {}
    await resetToHead();
    rows.push(row);
  }
  return { rows };
}
// (b) 入力中のキー
async function editingKeys() {
  const rows = [];
  const cases = [
    ['backspace-line-start', 'start', 'Backspace', []], ['backspace-after-newline', 'line2', 'Backspace', []], ['delete-end', 'end', 'Delete', []],
    ['select-all-backspace', 'selectall', 'Backspace', []], ['meta-a', 'end', 'a', ['meta']], ['meta-c', 'selectall', 'c', ['meta']],
    ['meta-x', 'selectall', 'x', ['meta']], ['meta-v', 'end', 'v', ['meta']], ['meta-d', 'end', 'd', ['meta']], ['arrow-left', 'end', 'ArrowLeft', []]
  ];
  for (const [name, where, keyName, mods] of cases) {
    if (only.length && !only.includes(`b-${name}`) && !only.includes('b')) continue;
    const m = mark(); const row = { name };
    try {
      const before = await files();
      if (name === 'meta-v') {
        // 図形を選んで ⌘C（item のクリップボードを作る）→ 字幕の編集中に ⌘V
        await seek(1); const box = await pv(`(() => { const n = document.querySelector('[data-overlay-id="box-a"], [data-item-id="box-a"], [data-akari-layer-id="box-a"]'); const s = n?.querySelector('svg') ?? n; if (!s) return null; const r = s.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
        if (box) { await clickAt(vp(box)); await press('c', ['meta']); await sleep(600); }
        row.clipboardBefore = run('/usr/bin/pbpaste', []).stdout.slice(0, 120);
      }
      row.start = await editCaptionAt(1);
      if (where === 'selectall') await pv(`(() => { const ed = document.querySelector('[data-akari-caption-editing="true"]'); ed.focus(); const r = document.createRange(); r.selectNodeContents(ed); const s = getSelection(); s.removeAllRanges(); s.addRange(r); return true; })()`);
      else await placeCaret(where);
      await hostKeys();
      const seekBefore = (await captionState()).seek;
      await press(keyName, mods);
      await sleep(500);
      row.after = await captionState();
      row.seekDelta = row.after.seek - seekBefore;
      row.hostKeys = await hostKeys();
      row.shot = await shot(`b-${name}`);
      row.files = await files();
      row.itemCountDelta = row.files.itemCount - before.itemCount;
      row.captionCountDelta = row.files.captions.length - before.captions.length;
      if (['meta-c', 'meta-x'].includes(name)) row.clipboard = run('/usr/bin/pbpaste', []).stdout.slice(0, 160);
      row.hostSelected = await hostSelected();
    } catch (e) { row.error = clean(e?.stack ?? e).slice(0, 800); }
    row.writeEvents = changes(m);
    try { await leaveEditing(); } catch {}
    await resetToHead();
    rows.push(row);
  }
  return { rows };
}

function osrFrame(name) {
  const osrPath = path.join(scratch, `${name}.mp4`);
  const osrRun = run(process.execPath, [path.join(repo, 'packages/osr-export/bin/akari-osr-export.mjs'),
    project, '--out', osrPath, '--duration', '1', '--frames', '30', '--width', '1920', '--height', '1080'],
    { timeout: 300000, env: { ...process.env, AKARI_EXPORT_ALLOW_DESKTOP: '0', TMPDIR: scratch } });
  const out = { status: osrRun.status, error: osrRun.status === 0 ? null : clean(osrRun.stderr).slice(-900), fallbackWarning: /フォールバック/.test(osrRun.stderr + osrRun.stdout) };
  if (osrRun.status === 0) {
    const frame = path.join(outDir, `${label}-${name}.png`);
    const extract = run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-ss', '0.5', '-i', osrPath, '-frames:v', '1', frame]);
    out.frame = extract.status === 0 ? path.basename(frame) : null;
    const probe = run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=width,height', '-of', 'json', osrPath]);
    try { out.probe = JSON.parse(probe.stdout); } catch {}
  }
  return out;
}
async function scenarios() {
  await scenario('a', () => keyMatrix('a', 1, 0));
  await scenario('b', () => editingKeys());
  await scenario('c', async () => {
    const out = {};
    out.start = await editCaptionAt(1);
    await placeCaret('end');
    await main.send('Input.insertText', { text: 'X' }); await sleep(200);
    await press('Enter'); await sleep(700);
    out.afterEnter = await captionState();
    out.shotAfterEnter = await shot('c-after-enter');
    const before = await files();
    await hostKeys();
    await press('Backspace'); await sleep(1200);
    out.afterBackspace = await captionState();
    out.hostKeys = await hostKeys();
    out.shot = await shot('c-after-backspace');
    out.files = await files();
    out.captionCountDelta = out.files.captions.length - before.captions.length;
    out.itemCountDelta = out.files.itemCount - before.itemCount;
    return out;
  });
  await scenario('d', async () => {
    const out = {};
    await seek(1);
    const s = await captionState();
    await clickAt(vp({ x: s.block.cx, y: s.block.cy }));
    await sleep(800);
    const fieldQ = `((f => f && (f.matches('textarea, input') ? f : f.querySelector('textarea, input')))(document.querySelector('[data-akari-ui="field:inspector-caption-text"]') ?? document.querySelector('[data-akari-field="caption-text"]')))`;
    out.field = await mw(`(() => { const i = ${fieldQ}; if (!i) return { found: false, fields: [...document.querySelectorAll('[data-akari-ui^="field:inspector-"]')].map(e => e.getAttribute('data-akari-ui')).slice(0, 30) };
      i.scrollIntoView({ block: 'center' }); const r = i.getBoundingClientRect(); const cs = getComputedStyle(i);
      return { found: true, tag: i.tagName, type: i.type ?? null, value: i.value, rows: i.rows ?? null, x: r.x, y: r.y, w: r.width, h: r.height, lineHeight: cs.lineHeight, overflowY: cs.overflowY }; })()`);
    out.shotSelected = await shot('d-inspector-selected');
    if (!out.field.found) return out;
    const before = await readCaptionsText();
    const m = mark();
    await clickAt({ x: out.field.x + 20, y: out.field.y + out.field.h / 2 });
    out.focused = await mw(`(() => { const a = document.activeElement; return { tag: a?.tagName, value: a?.value ?? null }; })()`);
    out.shotFocused = await shot('d-inspector-focused');
    // 何も打たずに外（インスペクターの見出し付近）をクリック
    const away = await mw(`(() => { const p = document.querySelector('[data-akari-ui="panel:inspector"]'); const h = p?.querySelector('.akari-inspector-selection-header') ?? p; const r = h.getBoundingClientRect(); return { x: r.x + 10, y: r.y + 8 }; })()`);
    await clickAt(away); await sleep(1500);
    out.afterBlurActive = await mw(`document.activeElement?.tagName ?? null`);
    out.writeEventsBlur = changes(m);
    const after = await readCaptionsText();
    out.textBefore = JSON.parse(before).captions[0].text;
    out.textAfter = JSON.parse(after).captions[0].text;
    out.fileChanged = before !== after;
    out.shot = await shot('d-inspector-after-blur');
    if (label.startsWith('after')) {
      // 改行を足して ⌘Enter で確定 → captions.json に \n で入る
      await resetToHead(); await seek(1);
      const s2 = await captionState(); await clickAt(vp({ x: s2.block.cx, y: s2.block.cy })); await sleep(800);
      const f2 = await mw(`(() => { const i = ${fieldQ}; i.scrollIntoView({ block: 'center' }); const r = i.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`);
      await clickAt({ x: f2.x + 20, y: f2.y + f2.h / 2 });
      await mw(`(() => { const i = document.activeElement; i.setSelectionRange(i.value.length, i.value.length); return true; })()`);
      const m2 = mark();
      await press('Enter'); await main.send('Input.insertText', { text: '三行目' }); await sleep(300);
      out.typedValue = await mw(`document.activeElement?.value ?? null`);
      out.typedHeight = await mw(`document.activeElement?.getBoundingClientRect().height ?? null`);
      out.shotTyped = await shot('d-inspector-typed');
      out.writesAfterEnterInField = changes(m2);
      await press('Enter', ['meta']); await sleep(1500);
      out.commitWrites = changes(m2);
      out.committedText = JSON.parse(await readCaptionsText()).captions[0].text;
      for (let i = 0; i < 20; i++) { out.previewAfterCommit = await captionState(); if ((out.previewAfterCommit.hostText || '').split('\n').length >= 3) break; await sleep(500); }
      // (f) UI で改行を足して確定した本文をそのまま OSR で書き出す
      out.osrAfterUiNewline = osrFrame('f-osr-ui-newline');
      out.shotCommitted = await shot('d-inspector-committed');
      // Esc で戻す
      await resetToHead(); await seek(1);
      const s3 = await captionState(); await clickAt(vp({ x: s3.block.cx, y: s3.block.cy })); await sleep(800);
      const f3 = await mw(`(() => { const i = ${fieldQ}; const r = i.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`);
      await clickAt({ x: f3.x + 20, y: f3.y + f3.h / 2 });
      const m3 = mark();
      await main.send('Input.insertText', { text: 'ZZZ' }); await press('Escape'); await sleep(1200);
      out.escapeWrites = changes(m3);
      out.escapeValue = await mw(`(() => { const i = ${fieldQ}; return i?.value ?? null; })()`);
    }
    return out;
  });
  await scenario('e-placed', () => keyMatrix('e-placed', 9, 2));
  await scenario('e-overlay', async () => {
    const rows = [];
    for (const [name, keyName, mods] of [['enter', 'Enter', []], ['shift-enter', 'Enter', ['shift']], ['meta-enter', 'Enter', ['meta']], ['escape', 'Escape', []]]) {
      const m = mark(); const row = { name };
      try {
        await seek(1);
        let o = await overlayState(); if (!o.textRect) throw new Error('overlay text absent');
        await clickAt(vp({ x: o.textRect.cx, y: o.textRect.cy }));
        for (let attempt = 0; attempt < 4 && !(await overlayState()).editing; attempt++) { await dblAt(vp({ x: o.textRect.cx, y: o.textRect.cy })); await sleep(400 * (attempt + 1)); }
        row.start = await overlayState();
        if (!row.start.editing) throw new Error('overlay edit did not start');
        await placeCaret('end');
        await main.send('Input.insertText', { text: 'X' }); await sleep(250);
        row.typed = await overlayState();
        await press(keyName, mods); await sleep(900);
        row.after = await overlayState();
        row.shot = await shot(`e-overlay-${name}`);
        row.files = (await files()).overlayHtml;
      } catch (e) { row.error = clean(e?.stack ?? e).slice(0, 800); }
      row.writeEvents = changes(m);
      try { await leaveEditing(); } catch {}
      await resetToHead();
      rows.push(row);
    }
    return { rows };
  });
}

// ---- 起動 -----------------------------------------------------------------------------------------------------
const report = { label, port };
const clipboardSaved = run('/usr/bin/pbpaste', []).stdout;
try {
  await mkdir(outDir, { recursive: true });
  await makeFixture();
  // (f) 改行入りの字幕を OSR で書き出し、0.5 秒のフレームを撮る
  if (!process.argv.includes('--skip-osr')) {
    const osrPath = path.join(scratch, 'osr.mp4');
    const osrRun = run(process.execPath, [path.join(repo, 'packages/osr-export/bin/akari-osr-export.mjs'),
      project, '--out', osrPath, '--duration', '1', '--frames', '30', '--width', '1920', '--height', '1080'],
      { timeout: 300000, env: { ...process.env, AKARI_EXPORT_ALLOW_DESKTOP: '0', TMPDIR: scratch } });
    report.osr = { status: osrRun.status, error: osrRun.status === 0 ? null : clean(osrRun.stderr).slice(-900),
      fallbackWarning: /フォールバック/.test(osrRun.stderr + osrRun.stdout) };
    for (const f of ['render.json']) {
      const p = path.join(scratch, f); if (existsSync(p)) report.osr.receipt = JSON.parse(await readFile(p, 'utf8'))?.provenance?.osr ?? null;
    }
    if (osrRun.status === 0) {
      const frame = path.join(outDir, `${label}-f-osr-newline.png`);
      const extract = run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-ss', '0.5', '-i', osrPath, '-frames:v', '1', frame]);
      report.osr.frame = extract.status === 0 ? path.basename(frame) : null;
      if (extract.status === 0) report.osr.sha256 = createHash('sha256').update(await readFile(frame)).digest('hex');
      report.osr.stdoutTail = clean(osrRun.stdout).slice(-600);
    }
  }
  if (!process.argv.includes('--osr-only')) {
    const profile = path.join(scratch, 'profile'), config = path.join(scratch, 'config'), home = path.join(scratch, 'akari-home');
    await Promise.all([mkdir(profile), mkdir(config), mkdir(home)]);
    child = spawn(electron, [shellDir, project, `--remote-debugging-port=${port}`, '--hostname=127.0.0.1', `--port=${httpPort}`,
      `--user-data-dir=${profile}`, '--no-sandbox', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding'],
      { cwd: shellDir, env: { ...process.env, THEIA_CONFIG_DIR: config, AKARI_HOME: home }, stdio: 'ignore', detached: true });
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
    const softCommand = (id, value, ms = 30000) => Promise.race([
      command(id, value).catch(e => ({ ok: false, error: String(e?.message ?? e) })),
      sleep(ms).then(() => ({ ok: false, error: 'pending' }))]);
    for (let i = 0; i < 90; i++) {
      await clickOpenOnly().catch(() => {});
      report.timelineOpen = await softCommand('akari.annotations.open');
      if (report.timelineOpen.ok) break;
      await sleep(2000);
    }
    await sleep(5000);
    const end = Date.now() + 240000;
    while (!view && Date.now() < end) {
      await clickOpenOnly().catch(() => {});
      const r = await softCommand('akari.preview.ensureVisible', { editUri });
      if (!r.ok && r.error !== 'pending') { await sleep(3000); continue; }
      await sleep(4000);
      view = await findPreview(15000);
    }
    if (!view) throw new Error('preview not found');
    for (let i = 0; i < 90; i++) { if (await pv(`Number(document.getElementById('seek')?.max || 0) >= 11`).catch(() => false)) break; await sleep(500); }
    report.inspectorOpen = await command('akari.inspector.open');
    await sleep(1500);
    await clickOpenOnly();
    for (let i = 0; i < 90; i++) { outer = await outerOffset(); if (outer && outer.h > 250 && outer.w > 350) break; await sleep(1000); }
    // 負荷が高いとコマンドの再発行でダイアログ（タイムラインを作成 等）が残ることがある。キャンセルで閉じる
    report.dialogsClosed = await mw(`(() => { let n = 0; for (const b of [...document.querySelectorAll('.dialogOverlay button, [aria-modal="true"] button')]) if (/キャンセル/.test(b.textContent || '')) { b.click(); n++; } return n; })()`);
    await sleep(800);
    await seek(1);
    outer = await outerOffset();
    report.outer = outer;
    report.windowShot = await shot('window');
    await installHostProbe();
    startWatch();
    await scenarios();
  }
} catch (e) { report.error = clean(e?.stack ?? e); }
finally {
  clearInterval(watcher);
  main?.close(); browser?.close();
  if (child?.pid) { try { process.kill(-child.pid, 'SIGTERM'); } catch {} await sleep(2000); try { process.kill(-child.pid, 'SIGKILL'); } catch {} }
  for (const line of run('/bin/ps', ['-axo', 'pid=,command=']).stdout.split('\n')) {
    const m = line.trim().match(/^(\d+)\s+(.*)$/);
    if (m && m[2].includes(scratch)) { try { process.kill(Number(m[1]), 'SIGKILL'); } catch {} }
  }
  run('/usr/bin/pbcopy', [], { input: clipboardSaved });
}
report.results = results;
report.allConsoleErrors = [...new Set(consoleErrors.map(clean))].slice(-25);
await writeFile(path.join(outDir, `${label}.json`), `${clean(JSON.stringify(report, null, 2))}\n`);
await rm(scratch, { recursive: true, force: true });
console.log(clean(JSON.stringify({ error: report.error, osr: report.osr, keys: Object.keys(results) })).slice(0, 3000));
