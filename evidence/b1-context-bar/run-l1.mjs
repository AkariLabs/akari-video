#!/usr/bin/env node

// L1（検証専用）: 上のバー・要素の上の小さなメニュー・⋯・コピー / 貼り付け・スタイルをコピー・ロックを
// 本物の Electron シェルで操作して、スクショと数値（edit.json に書き戻った値・DOM・クリップボードの中身）を残す。
//
// 使い方:
//   node evidence/b1-context-bar/run-l1.mjs --shell <apps/shell> --label before|after --out <出力 dir>
//     [--project b1|b1-other] [--only a,b] [--theme dark|light]
// 環境変数 AKARI_CDP_PORT（既定 9563）。一時ディレクトリの名前には libcanvas-b1-context-bar を含める。
// OS のクリップボードを使うので、始める前の中身（文字）を退避して最後に戻す。

import { spawn, spawnSync } from 'node:child_process';
import { copyFile, cp, mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../..');
function argument(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}
const shellDir = path.resolve(argument('shell', path.join(repo, 'apps/shell')));
const label = argument('label', 'run');
const outDir = path.resolve(argument('out', path.join(here, label)));
const projectName = argument('project', 'b1');
const only = (argument('only', '') || '').split(',').filter(Boolean);
const theme = argument('theme', 'dark');
const port = Number(process.env.AKARI_CDP_PORT ?? 9563);
const electron = path.join(shellDir, 'node_modules', 'electron', 'dist', 'Electron.app', 'Contents', 'MacOS', 'Electron');

const scratch = await realpath(await mkdtemp(path.join(os.tmpdir(), `libcanvas-b1-context-bar-${label}-`)));
const project = path.join(scratch, 'project');
const profile = path.join(scratch, 'profile');
const config = path.join(scratch, 'config');
const akariHome = path.join(scratch, 'akari-home');
// --attach <hold の json>: --hold で起動して待っているアプリへつなぐ（起動直後の読み直しを避けて筋書きだけ流す）
const attachInfo = argument('attach') ? JSON.parse(await readFile(argument('attach'), 'utf8')) : null;
const editPath = attachInfo?.editPath ?? path.join(project, 'edit.json');
const editUri = pathToFileURL(editPath).href;

const pb = (args, input) => spawnSync(args[0], args.slice(1), { input, encoding: 'utf8' });
const savedClipboard = pb(['pbpaste']).stdout ?? '';

await stat(electron);
await mkdir(outDir, { recursive: true });
if (!attachInfo) {
await cp(path.join(repo, 'templates/project-default'), project, { recursive: true });
await Promise.all([mkdir(profile), mkdir(config), mkdir(akariHome, { recursive: true }),
  mkdir(path.join(project, 'assets'), { recursive: true }), mkdir(outDir, { recursive: true })]);
await copyFile(path.join(here, 'fixtures', `${projectName}.json`), editPath);
await copyFile(path.join(here, 'fixtures', 'b1.captions.json'), path.join(project, 'captions.json'));
await copyFile(path.join(repo, 'templates/kaisetsu-short/sample-project/assets/dummy-shot.png'), path.join(project, 'assets', 'photo.png'));
await mkdir(path.join(project, '.akari'), { recursive: true });
await writeFile(path.join(project, '.akari', 'lint.json'), '{"version":1,"verdict":"pass"}\n');
// 下の素材（単色の 10 秒の動画）。ffmpeg は実機の検証にだけ使う（テストでは使わない）
const encoded = spawnSync(process.env.FFMPEG ?? 'ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
  '-f', 'lavfi', '-i', 'color=c=0x9ca3af:s=1920x1080:d=10:r=30', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-g', '30',
  path.join(project, 'assets', 'base.mp4')], { encoding: 'utf8' });
if (encoded.status !== 0) throw new Error(`ffmpeg failed: ${encoded.stderr}`);
}

class CDP {
  constructor(url) { this.url = url; this.id = 0; this.pending = new Map(); this.listeners = new Map(); }
  async connect() {
    this.socket = new WebSocket(this.url);
    await new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve, { once: true });
      this.socket.addEventListener('error', reject, { once: true });
    });
    this.socket.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      if (message.id && this.pending.has(message.id)) {
        const pending = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(JSON.stringify(message.error)));
        else pending.resolve(message.result);
      } else if (message.method) {
        for (const listener of this.listeners.get(message.method) ?? []) listener(message.params, message.sessionId);
      }
    });
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending.has(id)) { this.pending.delete(id); reject(new Error(`CDP ${method} timed out`)); }
      }, 90000);
      this.pending.set(id, {
        resolve: value => { clearTimeout(timer); resolve(value); },
        reject: error => { clearTimeout(timer); reject(error); },
      });
      this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }
  on(method, listener) { this.listeners.set(method, [...(this.listeners.get(method) ?? []), listener]); }
  close() { this.socket?.close(); }
}

async function evaluate(cdp, expression, contextId, sessionId) {
  if (cdp === browser && sessionId !== undefined && view && sessionId === view.sessionId) {
    try { return await evaluateRaw(cdp, expression, contextId, sessionId); } catch (error) {
      if (!/Session with given id not found|Cannot find context|context/i.test(String(error))) throw error;
      view = await findPreviewView(browser, 20000);
      outer = await frameOffset();
      return evaluateRaw(cdp, expression, view.contextId, view.sessionId);
    }
  }
  return evaluateRaw(cdp, expression, contextId, sessionId);
}
async function evaluateRaw(cdp, expression, contextId, sessionId) {
  const response = await cdp.send('Runtime.evaluate', {
    expression, returnByValue: true, awaitPromise: true,
    ...(contextId === undefined ? {} : { contextId }),
  }, sessionId);
  if (response.exceptionDetails) throw new Error(JSON.stringify(response.exceptionDetails).slice(0, 800));
  return response.result.value;
}

async function waitForJson(url, predicate, timeoutMs = 90000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const value = await (await fetch(url)).json();
      if (predicate(value)) return value;
    } catch { /* not ready */ }
    await sleep(250);
  }
  throw new Error(`timed out waiting for ${url}`);
}

const consoleErrors = [];
const mainWorldContexts = new Map();
function trackContexts(cdp) {
  cdp.on('Runtime.executionContextCreated', (params, sessionId) => {
    if (!params?.context?.auxData?.isDefault) return;
    const list = mainWorldContexts.get(sessionId) ?? [];
    list.push(params.context.id);
    mainWorldContexts.set(sessionId, list);
  });
  cdp.on('Runtime.executionContextsCleared', (_params, sessionId) => mainWorldContexts.delete(sessionId));
}
function trackErrors(cdp) {
  cdp.on('Runtime.consoleAPICalled', params => {
    if (params.type !== 'error' && params.type !== 'warning') return;
    consoleErrors.push(params.args.map(arg => arg.value ?? arg.description ?? arg.type).join(' ').slice(0, 600));
  });
  cdp.on('Runtime.exceptionThrown', params => {
    consoleErrors.push(String(params.exceptionDetails?.exception?.description
      ?? params.exceptionDetails?.text ?? '').slice(0, 600));
  });
}

async function findPreviewView(browser, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const all = await browser.send('Target.getTargets').catch(() => undefined);
    for (const info of all?.targetInfos ?? []) {
      if (!['iframe', 'page', 'webview'].includes(info.type)) continue;
      if (!String(info.url ?? '').includes('webview')) continue;
      try {
        const { sessionId } = await browser.send('Target.attachToTarget', { targetId: info.targetId, flatten: true });
        mainWorldContexts.delete(sessionId);
        await browser.send('Page.enable', {}, sessionId).catch(() => undefined);
        await browser.send('Runtime.enable', {}, sessionId).catch(() => undefined);
        await sleep(300);
        for (const contextId of mainWorldContexts.get(sessionId) ?? []) {
          try {
            const hit = await evaluate(browser,
              `Boolean(document.getElementById('preview-layers') && document.getElementById('play-toggle'))`,
              contextId, sessionId);
            if (hit) return { sessionId, contextId };
          } catch { /* context gone */ }
        }
      } catch { /* target changed */ }
    }
    await sleep(500);
  }
  return undefined;
}

const S = JSON.stringify;
const FIND = names => `[...window.theia.container._bindingDictionary._map.keys()].find(k=>typeof k==='function'&&${names.map(n => `typeof k.prototype?.${n}==='function'`).join('&&')})`;
async function executeCommand(main, command, argumentValue) {
  return evaluate(main, `(async () => {
    try {
      const C = ${FIND(['executeCommand', 'registerCommand'])};
      const r = await window.theia.container.get(C).executeCommand(${S(command)}${argumentValue === undefined ? '' : `, ${S(argumentValue)}`});
      let value = null;
      try { value = r === undefined ? null : JSON.parse(JSON.stringify(r)); } catch { value = typeof r; }
      return { ok: true, value };
    } catch (error) { return { ok: false, error: error?.message ?? String(error) }; }
  })()`);
}
async function setTheme(main, id) {
  await evaluate(main, `(() => { window.theia.container.get(${FIND(['setCurrentTheme', 'getCurrentTheme'])}).setCurrentTheme(${S(id)}, true); return true; })()`);
  await sleep(1500);
}

let main;
let browser;
let view;
let outer;
const MOD = { alt: 1, ctrl: 2, meta: 4, shift: 8 };
const modifierBits = list => (list ?? []).reduce((bits, name) => bits | MOD[name], 0);

async function frameOffset() {
  return evaluate(main, `(() => {
    const frames = [...document.querySelectorAll('iframe')].map(f => ({ f, r: f.getBoundingClientRect() })).filter(x => x.r.width > 0 && x.r.height > 0 && x.f.closest('[id*="webview"], .theia-webview, .p-Widget'));
    frames.sort((a, b) => b.r.width * b.r.height - a.r.width * a.r.height);
    const rect = frames[0]?.r ?? { x: 0, y: 0 };
    return { x: rect.x, y: rect.y };
  })()`);
}
async function screenshot(name, clip) {
  const shot = await main.send('Page.captureScreenshot', {
    format: 'png', fromSurface: true, ...(clip ? { clip: { ...clip, scale: 1 } } : {}),
  });
  await writeFile(path.join(outDir, `${label}-${name}.png`), Buffer.from(shot.data, 'base64'));
  return `${label}-${name}.png`;
}
/** 出力プレビューのタブ全体（とインスペクター）を撮る。 */
async function previewShot(name) {
  const rect = await evaluate(main, `(() => {
    const frames = [...document.querySelectorAll('iframe')].filter(f => f.getBoundingClientRect().width > 0);
    frames.sort((a, b) => b.getBoundingClientRect().width * b.getBoundingClientRect().height - a.getBoundingClientRect().width * a.getBoundingClientRect().height);
    const frame = frames[0];
    const panel = frame?.closest('.theia-webview') ?? frame?.parentElement ?? frame;
    const b = (panel ?? document.body).getBoundingClientRect();
    return { x: Math.max(0, b.x - 4), y: Math.max(0, b.y - 4), width: Math.min(innerWidth, b.width + 8), height: Math.min(innerHeight, b.height + 8) };
  })()`);
  return screenshot(name, rect);
}
async function windowShot(name) { return screenshot(name); }

// webview の中の座標（view px）→ 本体の座標で押す
async function mouse(type, x, y, modifiers, buttons, button = 'left') {
  await main.send('Input.dispatchMouseEvent', {
    type, x, y, button: type === 'mouseMoved' && !buttons ? 'none' : button,
    buttons: buttons ?? (type === 'mousePressed' ? (button === 'right' ? 2 : 1) : 0), clickCount: 1, modifiers: modifierBits(modifiers),
  });
}
async function hostClick(x, y, modifiers) {
  await mouse('mouseMoved', x, y, modifiers);
  await mouse('mousePressed', x, y, modifiers);
  await sleep(60);
  await mouse('mouseReleased', x, y, modifiers);
  await sleep(600);
}
async function viewClick(x, y, modifiers) { return hostClick(outer.x + x, outer.y + y, modifiers); }
async function key(keyName, code, keyCode, modifiers = [], text) {
  const bits = modifierBits(modifiers);
  await main.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: keyName, code, windowsVirtualKeyCode: keyCode, modifiers: bits,
    ...(modifiers.includes('meta') ? { commands: [] } : {}) });
  if (text) await main.send('Input.dispatchKeyEvent', { type: 'char', key: keyName, text, modifiers: bits });
  await main.send('Input.dispatchKeyEvent', { type: 'keyUp', key: keyName, code, windowsVirtualKeyCode: keyCode, modifiers: bits });
  await sleep(700);
}

async function readEdit() { return JSON.parse(await readFile(editPath, 'utf8')); }
function findItem(edit, id) {
  const walk = items => { for (const item of items ?? []) { if (item.id === id) return item; const hit = walk(item.items); if (hit) return hit; } return undefined; };
  for (const track of edit.tracks ?? []) { const hit = walk(track.items); if (hit) return hit; }
  return undefined;
}
function allItems(edit) {
  const out = [];
  const walk = (items, trackId) => { for (const item of items ?? []) { out.push({ id: item.id, trackId }); walk(item.items, trackId); } };
  for (const track of edit.tracks ?? []) walk(track.items, track.id);
  return out;
}
async function waitEditChange(previousText, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const text = await readFile(editPath, 'utf8');
    if (text !== previousText) return true;
    await sleep(200);
  }
  return false;
}

async function itemBox(id) {
  return evaluate(browser, `(() => {
    const node = document.querySelector('[data-overlay-id=' + ${S(S(id))} + ']');
    if (!node) return null;
    const painted = [...node.querySelectorAll('svg path, svg rect, svg ellipse, svg circle, svg line, svg polygon, svg polyline, img, video, canvas')]
      .map(n => n.getBoundingClientRect()).filter(r => r.width > 0 || r.height > 0);
    if (!painted.length) painted.push(node.getBoundingClientRect());
    const l = Math.min(...painted.map(r => r.left)), t = Math.min(...painted.map(r => r.top));
    const b = { left: l, top: t, width: Math.max(...painted.map(r => r.right)) - l, height: Math.max(...painted.map(r => r.bottom)) - t };
    return { left: b.left, top: b.top, width: b.width, height: b.height, cx: b.left + b.width / 2, cy: b.top + b.height / 2 };
  })()`, view.contextId, view.sessionId);
}
async function stageBox() {
  return evaluate(browser, `(() => { const b = document.getElementById('preview-layers').getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height }; })()`,
    view.contextId, view.sessionId);
}
async function selectItem(id) {
  let box = await itemBox(id);
  if (!box) {
    // 写真などの overlay でないものは、出力の座標から押す
    const edit = await readEdit();
    const item = findItem(edit, id);
    const stage = await stageBox();
    const k = stage.width / (edit.output?.width ?? 1920);
    const t = item?.transform ?? {};
    box = { cx: stage.x + ((t.x ?? 0) + 960 + 60) * k, cy: stage.y + ((t.y ?? 0) + 540 + 40) * k };
  }
  await viewClick(box.cx, box.cy);
  await sleep(700);
  return box;
}
/** 本体（Theia）の DOM の観測: 上のバー・小さなメニュー・窓 */
async function chrome() {
  return evaluate(main, `(() => {
    const vis = n => !!n && n.getClientRects().length > 0 && getComputedStyle(n).visibility !== 'hidden' && getComputedStyle(n).display !== 'none';
    const r = n => { const b = n.getBoundingClientRect(); return { left: +b.left.toFixed(1), top: +b.top.toFixed(1), width: +b.width.toFixed(1), height: +b.height.toFixed(1) }; };
    const bar = document.querySelector('[data-akari-ui="preview-context-bar"]');
    const menu = document.querySelector('[data-akari-ui="preview-element-menu"]');
    const pop = document.querySelector('[data-akari-ui="preview-context-window"]');
    const more = document.querySelector('[data-akari-ui="preview-element-more"]');
    const items = n => vis(n) ? [...n.querySelectorAll('[data-akari-bar-item], [data-akari-menu-item]')].filter(vis).map(b => ({
      key: b.getAttribute('data-akari-bar-item') ?? b.getAttribute('data-akari-menu-item'), label: b.getAttribute('aria-label') ?? b.textContent.trim(),
      disabled: b.disabled === true || b.getAttribute('aria-disabled') === 'true', pressed: b.getAttribute('aria-pressed') ?? b.getAttribute('aria-expanded') })) : [];
    const panel = document.querySelector('[data-akari-ui="panel:inspector"]');
    return {
      bar: vis(bar) ? { rect: r(bar), items: items(bar), bg: getComputedStyle(bar).backgroundColor, radius: getComputedStyle(bar).borderTopLeftRadius } : null,
      menu: vis(menu) ? { rect: r(menu), items: items(menu) } : null,
      window: vis(pop) ? { rect: r(pop), kind: pop.getAttribute('data-akari-window'), text: pop.textContent.replace(/\\s+/g, ' ').trim().slice(0, 300) } : null,
      more: vis(more) ? { rect: r(more), items: items(more) } : null,
      styleCopy: document.body.getAttribute('data-akari-style-copy'),
      frame: (() => { const f = document.querySelector('iframe'); return f ? r(f) : null; })(),
      inspectorColorPanel: !!document.querySelector('[data-akari-ui="panel:inspector-color"]'),
      inspectorText: panel ? panel.textContent.replace(/\\s+/g, ' ').trim().slice(0, 400) : null,
    };
  })()`);
}
async function webviewHandles() {
  return evaluate(browser, `(() => {
    const vis = n => n.getClientRects().length > 0 && getComputedStyle(n).display !== 'none' && getComputedStyle(n).visibility !== 'hidden' && !n.hidden;
    const frame = document.querySelector('.akari-interaction-selection-frame');
    return { frame: frame && vis(frame) ? { cls: String(frame.className) } : null,
      handles: [...document.querySelectorAll('.akari-interaction-handle')].filter(vis).map(n => String(n.className).replace('akari-interaction-handle', '').trim()) };
  })()`, view.contextId, view.sessionId);
}
async function hostButton(selector) {
  return evaluate(main, `(() => { const b = document.querySelector(${S(selector)}); if (!b) return null; b.scrollIntoView({ block: 'nearest' }); const r = b.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, disabled: b.disabled === true }; })()`);
}
async function pressHost(selector) {
  const target = await hostButton(selector);
  if (!target) throw new Error(`not found: ${selector}`);
  await hostClick(target.x, target.y);
  return target;
}

// ---- シナリオ ----------------------------------------------------------------------------

const results = {};
/** 画面が読み直されていたら（負荷が高いと起きる）、戻るのを待って出力プレビューの webview を探し直す。 */
async function ensureView() {
  const alive = view ? await evaluateRaw(browser, `Boolean(document.getElementById('preview-layers'))`, view.contextId, view.sessionId).catch(() => false) : false;
  if (alive) return;
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    const ok = await evaluate(main, `Boolean(window.theia?.container && !document.querySelector('.theia-preload:not([style*="none"])'))`).catch(() => false);
    if (ok) break;
    await sleep(1000);
  }
  await sleep(3000);
  await executeCommand(main, 'akari.annotations.open').catch(() => undefined);
  await executeCommand(main, 'akari.preview.ensureVisible', { editUri }).catch(() => undefined);
  await sleep(3000);
  await evaluate(main, `(async () => {
    const shell = window.theia.container.get(${FIND(['revealWidget', 'closeWidget', 'getWidgets'])});
    const all = ['main', 'bottom', 'left', 'right'].flatMap(area => shell.getWidgets(area));
    for (const w of all) if (w.title.label === 'ホーム') w.close();
    const preview = all.find(w => w.title.label === '出力プレビュー');
    if (preview) await shell.revealWidget(preview.id);
    return true; })()`).catch(() => undefined);
  await sleep(2000);
  while (Date.now() < deadline) {
    view = await findPreviewView(browser, 20000);
    const mounted = view ? await evaluateRaw(browser, `document.querySelectorAll('[data-overlay-id]').length`, view.contextId, view.sessionId).catch(() => 0) : 0;
    if (mounted >= 3) break;
    await sleep(2000);
  }
  outer = await frameOffset();
  reloads.push(new Date().toISOString());
}
const reloads = [];

async function scenario(name, run) {
  if (only.length && !only.includes(name)) return;
  try {
    await ensureView();
    await key('Escape', 'Escape', 27);
    await sleep(300);
    results[name] = await run();
  } catch (error) {
    results[name] = { error: String(error?.stack ?? error).slice(0, 1200) };
  }
}

const scenarios = (await import(pathToFileURL(path.join(here, 'scenarios.mjs')).href)).default;

// ---- 起動 -------------------------------------------------------------------------------

let child;
const report = { label, port, project: projectName, theme };
try {
  if (!attachInfo) child = spawn(electron, [shellDir, project, `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`, '--no-sandbox'], {
    cwd: shellDir,
    env: { ...process.env, THEIA_CONFIG_DIR: config, AKARI_HOME: akariHome },
    stdio: 'ignore',
    detached: true,
  });
  report.pid = child?.pid ?? null;
  const isShellPage = value => value.type === 'page' && value.url && !value.url.startsWith('devtools:');
  const targets = await waitForJson(`http://127.0.0.1:${port}/json/list`, values => values.find(isShellPage));
  const target = targets.find(isShellPage);
  main = new CDP(target.webSocketDebuggerUrl);
  await main.connect();
  trackErrors(main);
  await main.send('Runtime.enable');
  const version = await waitForJson(`http://127.0.0.1:${port}/json/version`, value => value.webSocketDebuggerUrl);
  browser = new CDP(version.webSocketDebuggerUrl);
  await browser.connect();
  trackContexts(browser);
  trackErrors(browser);
  await browser.send('Target.setDiscoverTargets', { discover: true }).catch(() => undefined);
  try {
    const { windowId } = await browser.send('Browser.getWindowForTarget', { targetId: target.id });
    await browser.send('Browser.setWindowBounds',
      { windowId, bounds: { left: 0, top: 0, width: 1680, height: 1040, windowState: 'normal' } });
  } catch { /* best-effort */ }
  await main.send('Browser.grantPermissions', { permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'] }).catch(() => undefined);
  await browser.send('Browser.grantPermissions', { permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'] }).catch(() => undefined);

  const ready = Date.now() + 120000;
  if (attachInfo) {
    view = await findPreviewView(browser, 30000);
    report.previewBuilt = Boolean(view);
  } else while (Date.now() < ready) {
    const ok = await evaluate(main, `Boolean(window.theia?.container && !document.querySelector('.theia-preload:not([style*="none"])'))`).catch(() => false);
    if (ok) break;
    await sleep(500);
  }
  if (!attachInfo) {
  await sleep(4000);
  await evaluate(main, `(() => { const b=[...document.querySelectorAll('button')].find(x=>x.textContent?.trim()==='開くだけ'); if(b)b.click(); return true; })()`);
  // 起動中に画面が読み直されることがある（負荷が高いとき）。開けるまで待って再試行する
  const openDeadline = Date.now() + 120000;
  do {
    await evaluate(main, `(() => { const b=[...document.querySelectorAll('button')].find(x=>x.textContent?.trim()==='開くだけ'); if(b)b.click(); return true; })()`).catch(() => false);
    report.timelineOpen = await executeCommand(main, 'akari.annotations.open').catch(error => ({ ok: false, error: String(error) }));
    if (report.timelineOpen?.ok) break;
    await sleep(3000);
  } while (Date.now() < openDeadline);
  await sleep(5000);
  const deadline = Date.now() + 120000;
  while (!view && Date.now() < deadline) {
    await evaluate(main, `(() => { const b=[...document.querySelectorAll('button')].find(x=>x.textContent?.trim()==='開くだけ'); if(b)b.click(); return true; })()`);
    const opened = await executeCommand(main, 'akari.preview.ensureVisible', { editUri });
    if (!opened.ok) { await sleep(3000); continue; }
    await sleep(4000);
    view = await findPreviewView(browser, 15000);
  }
  report.previewBuilt = Boolean(view);
  report.inspectorOpen = await executeCommand(main, 'akari.inspector.open', {});
  await sleep(1500);
  if (theme !== 'dark') await setTheme(main, theme);
  await sleep(3000);
  report.activated = await evaluate(main, `(async () => {
    const later = [...document.querySelectorAll('button')].find(x => x.textContent?.trim() === '後で'); if (later) later.click();
    const shell = window.theia.container.get(${FIND(['revealWidget', 'closeWidget', 'getWidgets'])});
    const all = ['main', 'bottom', 'left', 'right'].flatMap(area => shell.getWidgets(area));
    for (const w of all) if (w.title.label === 'ホーム') w.close();
    const preview = all.find(w => w.title.label === '出力プレビュー');
    if (preview) await shell.revealWidget(preview.id);
    return all.map(w => w.title.label).slice(0, 20); })()`);
  await sleep(2500);
  // ホームのタブが後から開き直ることがあるので、もう一度閉じて出力プレビューを前へ
  report.activated2 = await evaluate(main, `(async () => {
    const shell = window.theia.container.get(${FIND(['revealWidget', 'closeWidget', 'getWidgets'])});
    const all = ['main', 'bottom', 'left', 'right'].flatMap(area => shell.getWidgets(area));
    for (const w of all) if (w.title.label === 'ホーム') w.close();
    const preview = all.find(w => w.title.label === '出力プレビュー');
    if (preview) await shell.revealWidget(preview.id);
    return all.map(w => w.title.label).slice(0, 20); })()`).catch(error => String(error));
  await sleep(2000);
  const ready2 = Date.now() + 90000;
  while (Date.now() < ready2) {
    view = await findPreviewView(browser, 20000) ?? view;
    const mounted = view ? await evaluateRaw(browser, `document.querySelectorAll('[data-overlay-id]').length`, view.contextId, view.sessionId).catch(() => 0) : 0;
    report.mounted = mounted;
    if (mounted >= 3) break;
    await sleep(2000);
  }
  } else if (theme !== 'dark') await setTheme(main, theme);
  if (view) {
    await evaluate(browser, `(() => { window.postMessage({type:'akari-preview-seek',time:1}, '*'); return true; })()`,
      view.contextId, view.sessionId);
    await sleep(1500);
    outer = await frameOffset();
    const api = { main, browser, get view() { return view; }, get outer() { return outer; }, editPath, editUri, outDir, label, S,
      evaluate, executeCommand, setTheme, screenshot, previewShot, windowShot, hostClick, viewClick, key, mouse, readEdit, findItem, allItems,
      waitEditChange, itemBox, stageBox, selectItem, chrome, webviewHandles, hostButton, pressHost, scenario, sleep, pb,
      refreshView: async () => { view = await findPreviewView(browser, 20000); outer = await frameOffset(); } };
    if (argument('hold')) { await writeFile('/tmp/libcanvas-b1-context-bar-hold.json', JSON.stringify({ view, outer, editPath })); await sleep(Number(argument('hold')) * 1000); }
    else await scenarios(api);
    report.results = results;
    report.reloadsRecovered = reloads.length;
  }
  report.windowShot = await windowShot('window');
} catch (error) {
  report.error = String(error?.stack ?? error?.message ?? error?.type ?? error);
} finally {
  main?.close();
  browser?.close();
  if (child?.pid) {
    try { process.kill(-child.pid, 'SIGTERM'); } catch { /* exited */ }
    await sleep(1500);
    try { process.kill(-child.pid, 'SIGKILL'); } catch { /* exited */ }
  }
  await sleep(500);
  try { report.finalEdit = JSON.parse(await readFile(editPath, 'utf8')); } catch { /* none */ }
  await rm(scratch, { recursive: true, force: true });
  if (!process.argv.includes('--keep-clipboard')) pb(['pbcopy'], savedClipboard);
}

const scrub = line => line.replace(/file:\/\/\/[^\s)"]+/g, '<file>').replace(/\/(?:private|tmp|Users|var)\/[^\s):"]+/g, '<path>')
  .replace(/https?:\/\/[0-9a-z.-]*localhost[^\s"]*/gi, '<local>');
report.consoleErrors = [...new Set(consoleErrors.filter(line => /TypeError|ReferenceError|context|bar|clipboard|preview|overlay/i.test(line))
  .map(line => scrub(line).replace(/^\S+Z /, '')))].slice(-15);
if (report.error) report.error = scrub(report.error);
const text = scrub(JSON.stringify(report, null, 2));
await writeFile(path.join(outDir, `${label}.json`), `${text}\n`);
console.log(text.slice(0, 3000));
