#!/usr/bin/env node

// L1（検証専用）: つまみ・回転 / 移動・マグネット・修飾キーを本物の Electron シェルで操作して
// スクショと数値（edit.json に書き戻った transform・DOM の矩形・ガイドの有無）を残す。
//
// 使い方:
//   node evidence/h1-handles/run-l1.mjs --shell <apps/shell の絶対パス> --fixtures <fixtures dir> \
//     --label before --out <出力 dir> [--selectors <selectors.json>] [--only a,b]
// 環境変数 AKARI_CDP_PORT（既定 9554）・L1_TMP_PREFIX（一時ディレクトリ名の接頭辞）。

import { spawn, spawnSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

function argument(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}
const shellDir = path.resolve(argument('shell'));
const fixtures = path.resolve(argument('fixtures'));
const label = argument('label', 'run');
const outDir = path.resolve(argument('out', '.'));
const only = (argument('only', '') || '').split(',').filter(Boolean);
const port = Number(process.env.AKARI_CDP_PORT ?? 9554);
const electron = path.join(shellDir, 'node_modules', 'electron', 'dist', 'Electron.app', 'Contents', 'MacOS', 'Electron');

// つまみの探し方（BEFORE の既定。AFTER は --selectors で差し替える）。
const selectors = {
  se: '.akari-interaction-handle.is-se',
  nw: '.akari-interaction-handle.is-nw',
  e: '.akari-interaction-handle.is-edge.is-e',
  w: '.akari-interaction-handle.is-edge.is-w',
  n: '.akari-interaction-handle.is-edge.is-n',
  s: '.akari-interaction-handle.is-edge.is-s',
  rotate: '.akari-interaction-action.is-rotate, .akari-interaction-handle.is-rotate',
  move: '.akari-interaction-action.is-move',
  lineStart: '[data-akari-line-handle="start"]',
  lineEnd: '[data-akari-line-handle="end"]',
  frame: '.akari-interaction-selection-frame',
  cutSe: '.akari-cut-handle-se',
  cutNw: '.akari-cut-handle-nw',
  cutRotate: '.akari-cut-handle-rotate',
  guides: '[class*="snap-guide"], [data-akari-guide]',
  hint: '[data-akari-handle-hint]',
  angle: '[data-akari-rotate-angle]',
  ...(argument('selectors') ? JSON.parse(await readFile(path.resolve(argument('selectors')), 'utf8')) : {}),
};

const scratch = await realpath(await mkdtemp(path.join(os.tmpdir(), process.env.L1_TMP_PREFIX ?? 'libcanvas-h1-handles-l1-')));
const project = path.join(scratch, 'project');
const profile = path.join(scratch, 'profile');
const config = path.join(scratch, 'config');
const akariHome = path.join(scratch, 'akari-home');
const editPath = path.join(project, 'edit.json');
const captionsPath = path.join(project, 'captions.json');
const editUri = pathToFileURL(editPath).href;

await stat(electron);
await Promise.all([mkdir(profile), mkdir(config), mkdir(akariHome, { recursive: true }),
  mkdir(path.join(project, '.akari'), { recursive: true }), mkdir(outDir, { recursive: true })]);
await copyFile(path.join(fixtures, 'handles.json'), editPath);
await copyFile(path.join(fixtures, 'handles.captions.json'), captionsPath);
await writeFile(path.join(project, '.akari', 'lint.json'), '{"version":1,"verdict":"pass"}\n');
// 下の素材（単色の 10 秒の動画）。ffmpeg は実機の検証にだけ使う（テストでは使わない）
await mkdir(path.join(project, 'assets'), { recursive: true });
const encoded = spawnSync(process.env.FFMPEG ?? 'ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
  '-f', 'lavfi', '-i', 'color=c=0xe7e5e4:s=1920x1080:d=10:r=30', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-g', '30',
  path.join(project, 'assets', 'base.mp4')], { encoding: 'utf8' });
if (encoded.status !== 0) throw new Error(`ffmpeg failed: ${encoded.stderr}`);

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
      }, 30000);
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

async function executeCommand(main, command, argumentValue) {
  return evaluate(main, `(async () => {
    try {
      const dictionary = window.theia?.container?._bindingDictionary;
      const keys = dictionary?._map ? [...dictionary._map.keys()] : [];
      const CommandClass = keys.find(key => typeof key === 'function' && key.prototype
        && typeof key.prototype.executeCommand === 'function' && typeof key.prototype.registerCommand === 'function');
      if (!CommandClass) return { ok: false, error: 'command registry unavailable' };
      await window.theia.container.get(CommandClass)
        .executeCommand(${JSON.stringify(command)}, ${JSON.stringify(argumentValue)});
      return { ok: true };
    } catch (error) { return { ok: false, error: error?.message ?? String(error) }; }
  })()`);
}

async function activatePreview(main) {
  return evaluate(main, `(() => {
    const label = [...document.querySelectorAll('[class*="TabBar-tabLabel"]')]
      .find(node => node.textContent?.trim() === '出力プレビュー');
    if (!label) return false;
    label.click();
    return true;
  })()`);
}

async function frameOffset(main) {
  return evaluate(main, `(() => {
    const frame = document.querySelector('iframe');
    const rect = frame ? frame.getBoundingClientRect() : { x: 0, y: 0 };
    return { x: rect.x, y: rect.y };
  })()`);
}

async function screenshot(main, name, clip) {
  const shot = await main.send('Page.captureScreenshot', {
    format: 'png', fromSurface: true, ...(clip ? { clip: { ...clip, scale: 2 } } : {}),
  });
  await writeFile(path.join(outDir, `${name}.png`), Buffer.from(shot.data, 'base64'));
  return `${name}.png`;
}

// ---- webview の中で使う観測式 -------------------------------------------------------------

const SEL = JSON.stringify(selectors);
const rectOf = `const r = e => { const b = e.getBoundingClientRect(); return { left: b.left, top: b.top, width: b.width, height: b.height, cx: b.left + b.width / 2, cy: b.top + b.height / 2 }; };`;

function observeExpression(ids) {
  return `(() => {
    ${rectOf}
    const S = ${SEL};
    const stage = document.getElementById('preview-layers').getBoundingClientRect();
    const items = {};
    for (const id of ${JSON.stringify(ids)}) {
      const node = document.querySelector('[data-overlay-id=' + JSON.stringify(id) + ']');
      // 図形は段いっぱいの器の中に svg がある。見えている形（svg）の矩形を主に使う
      const shapeNode = node?.querySelector('svg');
      items[id] = node ? { ...r(shapeNode ?? node), container: r(node) } : null;
    }
    const handleNodes = [...document.querySelectorAll('[data-akari-interaction], [class*="akari-interaction"], [data-akari-handle], [data-akari-line-handle]')]
      .filter(node => node.getBoundingClientRect().width > 0 && getComputedStyle(node).display !== 'none' && getComputedStyle(node).visibility !== 'hidden');
    const handles = handleNodes.map(node => {
      const box = r(node);
      const hit = document.elementFromPoint(box.cx, box.cy);
      const cs = getComputedStyle(node);
      return { cls: String(node.className?.baseVal ?? node.className), data: node.getAttribute('data-akari-interaction') ?? node.getAttribute('data-akari-handle') ?? node.getAttribute('data-akari-line-handle'),
        aria: node.getAttribute('aria-label'), text: (node.textContent ?? '').trim().slice(0, 40), ...box,
        hitSelf: hit === node || node.contains(hit), hitCls: hit ? String(hit.className?.baseVal ?? hit.className).slice(0, 80) : null,
        bg: cs.backgroundColor, border: cs.borderTopColor + ' ' + cs.borderTopWidth, radius: cs.borderTopLeftRadius, shadow: cs.boxShadow.slice(0, 60), zIndex: cs.zIndex, cursor: cs.cursor };
    });
    const named = {};
    for (const [key, selector] of Object.entries(S)) {
      const all = [...document.querySelectorAll(selector)].filter(node => node.getBoundingClientRect().width > 0 && getComputedStyle(node).display !== 'none' && !node.hidden);
      named[key] = all.map(node => ({ ...r(node), text: (node.textContent ?? '').trim().slice(0, 40), style: (node.getAttribute('style') ?? '').slice(0, 160), cls: String(node.className?.baseVal ?? node.className).slice(0, 80) }));
    }
    return { stage: { x: stage.x, y: stage.y, width: stage.width, height: stage.height }, items, handles, named };
  })()`;
}

// ---- 入力 -------------------------------------------------------------------------------

let main;
let browser;
let view;
let outer;
const MOD = { alt: 1, ctrl: 2, meta: 4, shift: 8 };
const modifierBits = list => (list ?? []).reduce((bits, name) => bits | MOD[name], 0);
const KEY = { shift: ['Shift', 'ShiftLeft', 16], meta: ['Meta', 'MetaLeft', 91], alt: ['Alt', 'AltLeft', 18] };

async function keys(type, list) {
  for (const name of list ?? []) {
    const [key, code, keyCode] = KEY[name];
    await main.send('Input.dispatchKeyEvent', { type, key, code, windowsVirtualKeyCode: keyCode, modifiers: modifierBits(list) });
  }
}
async function mouse(type, x, y, modifiers, buttons) {
  await main.send('Input.dispatchMouseEvent', {
    type, x: outer.x + x, y: outer.y + y, button: type === 'mouseMoved' && !buttons ? 'none' : 'left',
    buttons: buttons ?? (type === 'mousePressed' ? 1 : 0), clickCount: 1, modifiers: modifierBits(modifiers),
  });
}
async function click(x, y) {
  await mouse('mouseMoved', x, y);
  await mouse('mousePressed', x, y);
  await sleep(60);
  await mouse('mouseReleased', x, y);
  await sleep(500);
}
// start → end を steps 回に分けて動かし、release の直前に観測する。
async function drag(start, end, { modifiers, steps = 16, midObserve, ids = [], shotName } = {}) {
  await keys('keyDown', modifiers);
  await mouse('mouseMoved', start.x, start.y, modifiers);
  await mouse('mousePressed', start.x, start.y, modifiers);
  await sleep(80);
  for (let i = 1; i <= steps; i += 1) {
    const t = i / steps;
    await mouse('mouseMoved', start.x + (end.x - start.x) * t, start.y + (end.y - start.y) * t, modifiers, 1);
    await sleep(25);
  }
  await sleep(250);
  let mid;
  if (midObserve) {
    mid = await evaluate(browser, observeExpression(ids), view.contextId, view.sessionId);
    if (shotName) mid.shot = await stageShot(shotName, mid.stage);
  }
  await mouse('mouseReleased', end.x, end.y, modifiers);
  await keys('keyUp', modifiers);
  await sleep(1200);
  return mid;
}

async function stageShot(name, stage) {
  return screenshot(main, `${label}-${name}`, { x: outer.x + stage.x - 20, y: outer.y + stage.y - 20, width: stage.width + 40, height: stage.height + 60 });
}
async function observe(ids) { return evaluate(browser, observeExpression(ids), view.contextId, view.sessionId); }

async function readEdit() { return JSON.parse(await readFile(editPath, 'utf8')); }
async function readCaptions() { return JSON.parse(await readFile(captionsPath, 'utf8')); }
function findItem(edit, id) {
  for (const track of edit.tracks ?? []) for (const item of track.items ?? []) if (item.id === id) return item;
  return undefined;
}
function allItemIds(edit) { return (edit.tracks ?? []).flatMap(track => (track.items ?? []).map(item => item.id)); }
async function waitEditChange(previousText, timeoutMs = 6000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const text = await readFile(editPath, 'utf8');
    if (text !== previousText) return true;
    await sleep(200);
  }
  return false;
}

// 出力座標（1920×1080）→ webview の画面座標
function toView(stage, point) {
  const k = stage.width / 1920;
  return { x: stage.x + point.x * k, y: stage.y + point.y * k };
}

// item の transform から出力座標の四隅と辺の中点（回転込み）を出す。x / y は左上・中心で回転（DOM で照合する）。
function poseOf(item) {
  const t = item.transform ?? {};
  const p = item.source?.params ?? {};
  const sx = t.scaleX ?? t.scale ?? 1;
  const sy = t.scaleY ?? t.scale ?? 1;
  const w = (p.width ?? 0) * sx;
  const h = (p.height ?? 0) * sy;
  const cx = (t.x ?? 0) + (p.width ?? 0) / 2;
  const cy = (t.y ?? 0) + (p.height ?? 0) / 2;
  const a = (t.rotate ?? 0) * Math.PI / 180;
  const at = (u, v) => ({ x: +(cx + u * Math.cos(a) - v * Math.sin(a)).toFixed(2), y: +(cy + u * Math.sin(a) + v * Math.cos(a)).toFixed(2) });
  return { transform: t, width: w, height: h, center: { x: cx, y: cy },
    nw: at(-w / 2, -h / 2), se: at(w / 2, h / 2), wMid: at(-w / 2, 0), eMid: at(w / 2, 0) };
}

// ---- シナリオ ----------------------------------------------------------------------------

const results = {};
async function probe() { return evaluate(browser, `window.__h1Probe?.splice(0)`, view.contextId, view.sessionId); }
async function scenario(name, run) {
  if (only.length && !only.includes(name)) return;
  try {
    // 選択を外しておく（Escape → 余白を押す）
    await main.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await main.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await sleep(300);
    results[name] = await run();
  } catch (error) {
    results[name] = { error: String(error?.stack ?? error).slice(0, 1200) };
  }
}

async function selectItem(id, at) {
  const o = await observe([id]);
  const box = o.items[id];
  if (!box) throw new Error(`item ${id} not mounted`);
  const point = at ?? { x: box.cx, y: box.cy };
  await click(point.x, point.y);
  const observed = await observe([id]);
  observed.probe = await probe();
  observed.state = await evaluate(browser, `(() => { const h = document.elementFromPoint(${point.x}, ${point.y});
    const f = document.querySelector('.akari-interaction-selection-frame');
    return { hitTag: h?.tagName, hitId: h?.id, hitCls: String(h?.className).slice(0,80), hitChain: (() => { const a = []; let n = h; while (n && a.length < 6) { a.push((n.id || "") + "." + String(n.className).slice(0, 40)); n = n.parentElement; } return a; })(), hitOverlay: h?.closest('[data-overlay-id]')?.getAttribute('data-overlay-id') ?? null,
      treeLen: (window.akari.state?.summary?.tree ?? []).length, tree: (window.akari.state?.summary?.tree ?? []).slice(0, 12).map(n => n.id + ':' + n.kind),
      frame: f ? { display: getComputedStyle(f).display, hidden: f.hidden, rect: f.getBoundingClientRect().toJSON(), parent: f.parentElement?.id || f.parentElement?.tagName } : null,
      selected: (() => { const v = window.akari.interaction?.selectedId; return typeof v === 'function' ? v() : v ?? null; })(),
      api: Object.keys(window.akari.interaction ?? {}).slice(0, 40) }; })()`, view.contextId, view.sessionId);
  observed.clickPoint = point;
  return observed;
}
const firstNamed = (o, key) => o.named[key]?.[0];

async function runScenarios() {
  const ids = ['box-a', 'box-rot', 'back', 'front', 'line', 'box-b', 'box-r', 'box-g', 'box-m', 'box-alt'];
  results.initial = await observe(ids);
  const k = results.initial.stage.width / 1920;
  results.k = k;
  await stageShot('00-initial', results.initial.stage);
  const pt = h => h ? { x: +h.cx.toFixed(2), y: +h.cy.toFixed(2) } : null;
  const delta = (a, b) => a && b ? { x: +(b.x - a.x).toFixed(2), y: +(b.y - a.y).toFixed(2) } : null;
  const toOut = d => d ? { x: +(d.x / k).toFixed(2), y: +(d.y / k).toFixed(2) } : null;

  // 1. 図形の右下の角 → 左上の角（nw のつまみの中心）が動かないか
  await scenario('corner', async () => {
    const o = await selectItem('box-a');
    await stageShot('01-select-shape', o.stage);
    const se = firstNamed(o, 'se'); const nw = firstNamed(o, 'nw');
    if (!se) return { note: 'se handle not found', handles: o.handles };
    const text = await readFile(editPath, 'utf8');
    const mid = await drag({ x: se.cx, y: se.cy }, { x: se.cx + 60, y: se.cy + 30 }, { midObserve: true, ids: ['box-a'], shotName: '02-corner-drag' });
    const written = await waitEditChange(text);
    const after = await observe(['box-a']);
    return { handles: o.handles, written, hintDuring: mid.named.hint, domBefore: o.items['box-a'], domAfter: after.items['box-a'],
      nwMoveScreenPx: delta(pt(nw), pt(firstNamed(after, 'nw'))),
      aspectBefore: +(o.items['box-a'].width / o.items['box-a'].height).toFixed(4), aspectAfter: +(after.items['box-a'].width / after.items['box-a'].height).toFixed(4),
      transformAfter: findItem(await readEdit(), 'box-a').transform };
  });

  // 1b. 下の動画（カット）の右下の角 → 左上の角
  await scenario('cutCorner', async () => {
    const o0 = await observe([]);
    await click(o0.stage.x + o0.stage.width * 0.93, o0.stage.y + o0.stage.height * 0.55);
    const o = await observe([]);
    await stageShot('03-select-cut', o.stage);
    const se = firstNamed(o, 'cutSe'); const nw = firstNamed(o, 'cutNw');
    if (!se || !nw) return { note: 'cut handles not found', handles: o.handles };
    const text = await readFile(editPath, 'utf8');
    await drag({ x: se.cx, y: se.cy }, { x: se.cx - 40, y: se.cy - 22 });
    const written = await waitEditChange(text);
    const o2 = await observe([]);
    return { handles: o.handles, written, nwMoveScreenPx: delta(pt(nw), pt(firstNamed(o2, 'cutNw'))),
      seMoveScreenPx: delta(pt(se), pt(firstNamed(o2, 'cutSe'))), after: findItem(await readEdit(), 'cut-1').transform ?? null };
  });

  // 2. 30° 回した図形の右の辺 → 左の辺（w のつまみの中心）が動かないか
  await scenario('rotatedEdge', async () => {
    const o = await selectItem('box-rot');
    await stageShot('04-select-rotated', o.stage);
    const e = firstNamed(o, 'e'); const w = firstNamed(o, 'w');
    if (!e || !w) return { note: 'edge handle not found', handles: o.handles };
    const text = await readFile(editPath, 'utf8');
    const ux = (e.cx - w.cx) / Math.hypot(e.cx - w.cx, e.cy - w.cy), uy = (e.cy - w.cy) / Math.hypot(e.cx - w.cx, e.cy - w.cy);
    const mid = await drag({ x: e.cx, y: e.cy }, { x: e.cx + 30 * ux, y: e.cy + 30 * uy }, { midObserve: true, ids: ['box-rot'], shotName: '05-rotated-edge-drag' });
    const written = await waitEditChange(text);
    const o2 = await observe(['box-rot']);
    const n2 = firstNamed(o2, 'n'); const s2 = firstNamed(o2, 's');
    const n = firstNamed(o, 'n'); const s = firstNamed(o, 's');
    return { handles: o.handles, written, hintDuring: mid.named.hint, edgeAngleDeg: +(Math.atan2(uy, ux) * 180 / Math.PI).toFixed(2),
      wMoveScreenPx: delta(pt(w), pt(firstNamed(o2, 'w'))), eMoveScreenPx: delta(pt(e), pt(firstNamed(o2, 'e'))),
      heightBefore: n && s ? +Math.hypot(n.cx - s.cx, n.cy - s.cy).toFixed(2) : null, heightAfter: n2 && s2 ? +Math.hypot(n2.cx - s2.cx, n2.cy - s2.cy).toFixed(2) : null,
      transformAfter: findItem(await readEdit(), 'box-rot').transform };
  });

  // 3. 文字: つまみ（上下の辺が無い）と右の辺 = 折り返し幅
  await scenario('text', async () => {
    const line = await evaluate(browser, `(() => { ${rectOf}
      const n = [...document.querySelectorAll('.akari-caption__line')].filter(x => (x.textContent ?? '').includes('つまみ'));
      return n[0] ? r(n[0]) : null; })()`, view.contextId, view.sessionId);
    if (!line) return { note: 'caption line not found' };
    await click(line.cx, line.cy);
    const o = await observe([]);
    await stageShot('06-select-text', o.stage);
    const e = firstNamed(o, 'textE'); const w = firstNamed(o, 'textW');
    const res = { captionHandles: Object.fromEntries(['textNw', 'textSe', 'textE', 'textW', 'textN', 'textS', 'textRot', 'textMove'].map(key => [key, firstNamed(o, key) ? { w: firstNamed(o, key).width, h: firstNamed(o, key).height } : null])) };
    if (!e) return res;
    const capBefore = await readCaptions();
    const plateLines = async () => evaluate(browser, `(() => { const ls = [...document.querySelectorAll('.akari-caption__line')].filter(x => x.getBoundingClientRect().width > 0);
      return { lines: ls.length, texts: ls.map(l => l.textContent), fontSize: ls[0] ? getComputedStyle(ls[0]).fontSize : null }; })()`, view.contextId, view.sessionId);
    const before = await plateLines();
    const mid = await drag({ x: e.cx, y: e.cy }, { x: e.cx - 45, y: e.cy }, { midObserve: true, shotName: '07-text-edge-drag' });
    await sleep(2500);
    // 書き込みの後に webview の実行文脈が作り直されることがあるので取り直す
    try { await evaluate(browser, '1', view.contextId, view.sessionId); } catch { view = await findPreviewView(browser, 20000); outer = await frameOffset(main); }
    const capAfter = await readCaptions();
    const after = await plateLines();
    const o2 = await observe([]);
    await stageShot('08-text-after', o2.stage);
    return { ...res, hintDuring: mid.named.hint, wMoveScreenPx: delta(pt(w), pt(firstNamed(o2, 'textW'))),
      textStyleBefore: capBefore.captions[0].text_style ?? null, textStyleAfter: capAfter.captions[0].text_style ?? null,
      before, after };
  });

  // 4. ラインの端点: 42° へ → 45° に吸い付く / box-b の中心の近く（画面 3px）へ → 中心に点で吸い付く
  await scenario('line', async () => {
    const o = await selectItem('line');
    await stageShot('09-select-line', o.stage);
    const start = firstNamed(o, 'lineStart'); const end = firstNamed(o, 'lineEnd');
    const res = { handles: o.handles, frame: firstNamed(o, 'frame') };
    if (!start || !end) return res;
    const len = Math.hypot(end.cx - start.cx, end.cy - start.cy);
    const a = 42 * Math.PI / 180;
    let text = await readFile(editPath, 'utf8');
    const mid = await drag({ x: end.cx, y: end.cy }, { x: start.cx + len * Math.cos(a), y: start.cy + len * Math.sin(a) }, { midObserve: true, ids: ['line'], shotName: '10-line-45' });
    await waitEditChange(text);
    const o2 = await observe(['line', 'box-b']);
    const s2 = firstNamed(o2, 'lineStart'); const e2 = firstNamed(o2, 'lineEnd');
    const angle45 = { startMove: delta(pt(start), pt(s2)), angleDeg: +(Math.atan2(e2.cy - s2.cy, e2.cx - s2.cx) * 180 / Math.PI).toFixed(2),
      rotate: findItem(await readEdit(), 'line').transform?.rotate, hintDuring: mid.named.hint, guidesDuring: mid.named.guides };
    const bb = o2.items['box-b'];
    if (!bb) return { ...res, angle45 };
    text = await readFile(editPath, 'utf8');
    const mid2 = await drag({ x: e2.cx, y: e2.cy }, { x: bb.cx - 2, y: bb.cy - 2 }, { midObserve: true, ids: ['line', 'box-b'], shotName: '11-line-point-snap' });
    await waitEditChange(text);
    const o3 = await observe(['line', 'box-b']);
    const e3 = firstNamed(o3, 'lineEnd');
    return { ...res, angle45, pointSnap: { endToBoxCenterScreenPx: delta({ x: o3.items['box-b'].cx, y: o3.items['box-b'].cy }, pt(e3)), guidesDuring: mid2.named.guides } };
  });

  // 5. 下の回転ボタン: 図形の中心の周りに 43° → 45° に吸い付く・角度の数値・図形の中心が動かない
  await scenario('rotate', async () => {
    const o = await selectItem('box-r');
    const button = firstNamed(o, 'rotate');
    const res = { rotate: button, move: firstNamed(o, 'move') };
    if (!button) return res;
    const box = o.items['box-r'];
    const text = await readFile(editPath, 'utf8');
    const radius = Math.hypot(button.cx - box.cx, button.cy - box.cy);
    const a0 = Math.atan2(button.cy - box.cy, button.cx - box.cx);
    const a1 = a0 + 43 * Math.PI / 180;
    const mid = await drag({ x: button.cx, y: button.cy }, { x: box.cx + radius * Math.cos(a1), y: box.cy + radius * Math.sin(a1) }, { midObserve: true, ids: ['box-r'], shotName: '12-rotate-drag', steps: 24 });
    await waitEditChange(text);
    const o2 = await observe(['box-r']);
    const cursors = [...new Set((mid?.handles ?? []).map(h => h.cursor).filter(c => c && c.includes('svg')))].length;
    const visibleDuring = Object.fromEntries(['se', 'e', 'rotate', 'move'].map(key => [key, (mid.named[key] ?? []).length]));
    return { ...res, angleDuring: mid.named.angle, visibleDuring, rotatedCursor: cursors > 0, rotateAfter: findItem(await readEdit(), 'box-r').transform?.rotate,
      centerMoveScreenPx: delta({ x: box.cx, y: box.cy }, { x: o2.items['box-r'].cx, y: o2.items['box-r'].cy }) };
  });

  // 6. 揃える: box-g の左を box-a の左の画面 4px 右へ（点線）→ 画面の中央の 3px 右へ（実線）
  await scenario('guides', async () => {
    const o = await selectItem('box-g', undefined);
    const a = o.items['box-g'];
    const boxA = (await observe(['box-a'])).items['box-a'];
    const text = await readFile(editPath, 'utf8');
    const mid = await drag({ x: a.cx, y: a.cy }, { x: a.cx + (boxA.left + 4 - a.left), y: a.cy }, { midObserve: true, ids: ['box-g', 'box-a'], shotName: '13-guide-items' });
    await waitEditChange(text);
    const o2 = await observe(['box-g', 'box-a']);
    const b = o2.items['box-g'];
    const styles = async () => evaluate(browser, `(() => [...document.querySelectorAll('.akari-interaction-snap-guide')].filter(g => !g.hidden).map(g => { const cs = getComputedStyle(g);
      return { cls: String(g.className), w: g.getBoundingClientRect().width, h: g.getBoundingClientRect().height, bg: cs.backgroundColor, bgImage: cs.backgroundImage.slice(0, 120), border: cs.borderLeftStyle + ' ' + cs.borderLeftWidth + ' ' + cs.borderTopStyle + ' ' + cs.borderTopWidth }; }))()`, view.contextId, view.sessionId);
    const text2 = await readFile(editPath, 'utf8');
    const stageCx = o2.stage.x + o2.stage.width / 2;
    // 途中で止めて見た目を測る
    await keys('keyDown', []);
    await mouse('mouseMoved', b.cx, b.cy); await mouse('mousePressed', b.cx, b.cy); await sleep(80);
    for (let i = 1; i <= 16; i += 1) { await mouse('mouseMoved', b.cx + (stageCx + 3 - b.cx) * i / 16, b.cy, [], 1); await sleep(25); }
    await sleep(250);
    const mid2 = await observe(['box-g']);
    const guideStyles = await styles();
    await stageShot('14-guide-center', mid2.stage);
    await mouse('mouseReleased', stageCx + 3, b.cy); await sleep(1200);
    await waitEditChange(text2);
    const o3 = await observe(['box-g']);
    return { itemGuides: mid.named.guides, leftGapToBoxAScreenPx: +(b.left - boxA.left).toFixed(2),
      centerGuides: mid2.named.guides, guideStyles, centerGapScreenPx: +(o3.items['box-g'].cx - stageCx).toFixed(2) };
  });

  // 7. 修飾キー
  await scenario('modifiers', async () => {
    const out = {};
    // Shift: 右へ 40・下へ 13（画面 px）→ 横だけ
    let o = await selectItem('box-m');
    let m = o.items['box-m'];
    let text = await readFile(editPath, 'utf8');
    await drag({ x: m.cx, y: m.cy }, { x: m.cx + 40, y: m.cy + 13 }, { modifiers: ['shift'] });
    await waitEditChange(text);
    let m2 = (await observe(['box-m'])).items['box-m'];
    out.shift = { moveScreenPx: delta({ x: m.left, y: m.top }, { x: m2.left, y: m2.top }) };
    // ⌘: box-m の左を box-b の左の 3px 右へ → 吸い付かない
    const boxB = (await observe(['box-b'])).items['box-b'];
    text = await readFile(editPath, 'utf8');
    const midMeta = await drag({ x: m2.cx, y: m2.cy }, { x: m2.cx + (boxB.left + 3 - m2.left), y: m2.cy + 30 }, { modifiers: ['meta'], midObserve: true, ids: ['box-m'], shotName: '15-meta-no-snap' });
    await waitEditChange(text);
    const m3 = (await observe(['box-m'])).items['box-m'];
    out.meta = { leftGapToBoxBScreenPx: +(m3.left - boxB.left).toFixed(2), guidesDuring: midMeta.named.guides };
    // ⌘ なしの同じ動き → 吸い付く（比較）
    text = await readFile(editPath, 'utf8');
    await drag({ x: m3.cx, y: m3.cy }, { x: m3.cx + 1, y: m3.cy + 30 });
    await waitEditChange(text);
    const m4 = (await observe(['box-m'])).items['box-m'];
    out.noMeta = { leftGapToBoxBScreenPx: +(m4.left - boxB.left).toFixed(2) };
    // ⌥: 複製して複製を動かす
    o = await selectItem('box-alt');
    const alt = o.items['box-alt'];
    const beforeEdit = await readEdit();
    const raw = await readFile(editPath, 'utf8');
    await drag({ x: alt.cx, y: alt.cy }, { x: alt.cx - 60, y: alt.cy - 25 }, { modifiers: ['alt'] });
    await waitEditChange(raw);
    await sleep(800);
    const afterEdit = await readEdit();
    const newIds = allItemIds(afterEdit).filter(id => !allItemIds(beforeEdit).includes(id));
    const o2 = await observe(['box-alt', ...newIds]);
    await stageShot('16-alt-duplicate', o2.stage);
    out.alt = { itemsBefore: allItemIds(beforeEdit).length, itemsAfter: allItemIds(afterEdit).length, newIds,
      originalMoveScreenPx: delta({ x: alt.left, y: alt.top }, { x: o2.items['box-alt'].left, y: o2.items['box-alt'].top }),
      copies: newIds.map(id => ({ id, moveFromOriginalScreenPx: o2.items[id] ? delta({ x: alt.left, y: alt.top }, { x: o2.items[id].left, y: o2.items[id].top }) : null })) };
    // undo 1 回で複製が消えるか
    if (newIds.length) {
      await main.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90, modifiers: MOD.meta, commands: ['undo'] });
      await main.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90, modifiers: MOD.meta });
      await sleep(2000);
      out.alt.itemsAfterUndo = allItemIds(await readEdit()).length;
    }
    return out;
  });

  // 8. 後ろの要素を選ぶ → つまみが前の要素に隠れない / 枠の中の重なりを押すと前が選ばれる
  await scenario('backSelect', async () => {
    const o = await observe(['back', 'front']);
    await click(o.items.back.left + 8, o.items.back.top + 8);
    const s = await observe(['back', 'front']);
    await stageShot('17-back-selected', s.stage);
    const se = firstNamed(s, 'se');
    const hit = se ? await evaluate(browser, `(() => { const h = document.elementFromPoint(${se.cx}, ${se.cy}); return h ? String(h.className?.baseVal ?? h.className) : null; })()`, view.contextId, view.sessionId) : null;
    const f = s.items.front, b = s.items.back;
    const inside = { x: (Math.max(f.left, b.left) + Math.min(f.left + f.width, b.left + b.width)) / 2, y: (Math.max(f.top, b.top) + Math.min(f.top + f.height, b.top + b.height)) / 2 };
    await click(inside.x, inside.y);
    const after = await observe(['back', 'front']);
    const frame = firstNamed(after, 'frame');
    return { seInsideFront: se ? se.cx > f.left && se.cy > f.top : null, hitAtSe: hit, frameBefore: firstNamed(s, 'frame'),
      frameAfterInsideClick: frame, frontRect: f, selectedFrontAfter: frame ? Math.abs(frame.left - f.left) < 1.5 && Math.abs(frame.top - f.top) < 1.5 : null };
  });

  // 9. 選択の外（段の外の余白）を押す → 解除
  await scenario('deselect', async () => {
    await selectItem('box-a');
    const o = await observe([]);
    const before = Boolean(firstNamed(o, 'frame'));
    await click(o.stage.x + o.stage.width / 2, o.stage.y + o.stage.height + 30);
    const after = await observe([]);
    return { selectedBefore: before, selectedAfter: Boolean(firstNamed(after, 'frame')) };
  });
}

// ---- 起動 -------------------------------------------------------------------------------

let child;
const report = { label, port };
try {
  child = spawn(electron, [shellDir, project, `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`, '--no-sandbox'], {
    cwd: shellDir,
    env: { ...process.env, THEIA_CONFIG_DIR: config, AKARI_HOME: akariHome },
    stdio: 'ignore',
    detached: true,
  });
  report.pid = child.pid;
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

  await sleep(10000);
  // --timeline: 実際の使い方どおりタイムライン（履歴つきの書き込み口）も開いておく
  if (process.argv.includes('--timeline')) {
    await evaluate(main, `(() => { const b=[...document.querySelectorAll('button')].find(x=>x.textContent?.trim()==='開くだけ'); if(b)b.click(); return true; })()`);
    report.timelineOpen = await executeCommand(main, 'akari.annotations.open');
    await sleep(5000);
  }
  const deadline = Date.now() + 120000;
  while (!view && Date.now() < deadline) {
    await evaluate(main, `(() => { const b=[...document.querySelectorAll('button')]
      .find(x=>x.textContent?.trim()==='開くだけ'); if(b)b.click(); return true; })()`);
    const opened = await executeCommand(main, 'akari.preview.ensureVisible', { editUri });
    if (!opened.ok) { await sleep(3000); continue; }
    await sleep(4000);
    await activatePreview(main);
    view = await findPreviewView(browser, 15000);
  }
  report.previewBuilt = Boolean(view);
  if (view) {
    await evaluate(browser, `(() => { window.postMessage({type:'akari-preview-seek',time:1}, '*'); return true; })()`,
      view.contextId, view.sessionId);
    await sleep(1500);
    // プレビューのタブを最大化して段を大きくする（Theia はタブのダブルクリックで最大化）
    report.maximized = await evaluate(main, `(() => {
      const label = [...document.querySelectorAll('[class*="TabBar-tabLabel"]')].find(n => n.textContent?.trim() === '出力プレビュー');
      const tab = label?.closest('li') ?? label;
      if (!tab) return false;
      tab.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
      return true; })()`);
    await sleep(2500);
    outer = await frameOffset(main);
    await runScenarios();
    report.results = results;
  }
  report.windowShot = await screenshot(main, `${label}-window`);
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
  try { report.finalCaptions = JSON.parse(await readFile(captionsPath, 'utf8')); } catch { /* none */ }
  await rm(scratch, { recursive: true, force: true });
}

const scrub = line => line.replace(/file:\/\/\/[^\s)"]+/g, '<file>').replace(/\/(?:private|tmp|Users|var)\/[^\s):"]+/g, '<path>');
report.consoleErrors = [...new Set(consoleErrors.filter(line => /TypeError|ReferenceError|interaction|preview|overlay|handle/i.test(line))
  .map(line => scrub(line).replace(/^\S+Z /, '')))].slice(-15);
if (report.error) report.error = scrub(report.error);
const text = scrub(JSON.stringify(report, null, 2));
await writeFile(path.join(outDir, `${label}.json`), `${text}\n`);
console.log(text.slice(0, 4000));
