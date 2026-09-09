#!/usr/bin/env node

// L1: インスペクターの数値欄をタイプしたとき、確定前にプレビューが 1 打鍵ごとに追従するか。
// (a) 上トラックのレイヤー item で X に 3 / 30 / 300 (b) base トラックの v2 item で同じ
// (c) 回転 45 (d) Escape で元値へ戻り、blur は確定値と一致。各手順で出力プレビューを PNG 連番に撮る。

import { spawn, spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../../../../..');
const shellDir = path.join(repoRoot, 'apps', 'shell');
const fixtureDir = path.join(repoRoot, 'dev-fixtures', 'cross-track-image-overlap');
const electron = path.join(shellDir, 'node_modules', 'electron', 'dist',
  'Electron.app', 'Contents', 'MacOS', 'Electron');
const ffmpeg = path.join(repoRoot, 'packages', 'media-bin', 'vendor', 'darwin-arm64', 'ffmpeg');
const port = Number(process.env.AKARI_CDP_PORT ?? 9451);
const frameEngine = process.env.AKARI_FRAME_ENGINE ?? '1';
const label = process.env.AKARI_L1_LABEL ?? (frameEngine === '0' ? 'legacy' : 'frame-engine');
const shotDir = path.join(here, `shots-${label}`);

const scratch = await realpath(await mkdtemp(path.join(os.tmpdir(), 'akari-ilps-')));
const project = path.join(scratch, 'project');
const profile = path.join(scratch, 'profile');
const config = path.join(scratch, 'config');
const akariHome = path.join(scratch, 'akari-home');
const editPath = path.join(project, 'edit.json');
const editUri = pathToFileURL(editPath).href;

await cp(fixtureDir, project, {
  recursive: true,
  filter: source => !source.endsWith('run-l1.mjs') && !source.endsWith('README.md')
});
await Promise.all([mkdir(profile), mkdir(config), mkdir(akariHome), mkdir(shotDir, { recursive: true }),
  mkdir(path.join(project, '.akari'), { recursive: true })]);
await writeFile(path.join(project, '.akari', 'lint.json'), '{"version":1,"verdict":"pass"}\n');

const log = [];
let shotIndex = 0;
function record(step, data = {}) {
  const entry = { step, ...data };
  log.push(entry);
  console.log(`[${step}]`, JSON.stringify(data));
}
function check(condition, message, data = {}) {
  record(condition ? 'ok' : 'FAILED', { message, ...data });
  if (!condition) throw new Error(`assertion failed: ${message} :: ${JSON.stringify(data)}`);
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
      }, 30000);
      this.pending.set(id, {
        resolve: value => { clearTimeout(timer); resolve(value); },
        reject: error => { clearTimeout(timer); reject(error); }
      });
      this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }
  on(method, listener) { this.listeners.set(method, [...(this.listeners.get(method) ?? []), listener]); }
  close() { try { this.socket?.close(); } catch { /* already gone */ } }
}

async function evaluate(cdp, expression, contextId, sessionId) {
  const response = await cdp.send('Runtime.evaluate', {
    expression, returnByValue: true, awaitPromise: true,
    ...(contextId === undefined ? {} : { contextId })
  }, sessionId);
  if (response.exceptionDetails) throw new Error(JSON.stringify(response.exceptionDetails));
  return response.result.value;
}

async function waitForJson(url, predicate, timeoutMs = 90000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const value = await (await fetch(url)).json();
      if (predicate(value)) return value;
    } catch { /* endpoint not ready */ }
    await sleep(250);
  }
  throw new Error(`timed out waiting for ${url}`);
}

let main;
let browser;
let view;

async function waitFor(description, expression, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { if (await evaluate(main, expression)) return true; } catch { /* redraw */ }
    await sleep(150);
  }
  throw new Error(`timed out waiting for ${description}`);
}

async function realClick(x, y) {
  for (const type of ['mousePressed', 'mouseReleased']) {
    await main.send('Input.dispatchMouseEvent',
      { type, x, y, button: 'left', clickCount: 1, buttons: type === 'mousePressed' ? 1 : 0 });
    await sleep(30);
  }
}
async function keyPress(options) {
  await main.send('Input.dispatchKeyEvent', { type: 'keyDown', ...options });
  await sleep(20);
  await main.send('Input.dispatchKeyEvent', { type: 'keyUp', ...options });
}

async function executeCommand(command, argument) {
  return evaluate(main, `(async () => {
    try {
      const dictionary = window.theia?.container?._bindingDictionary;
      const keys = dictionary?._map ? [...dictionary._map.keys()] : [];
      const CommandClass = keys.find(key => typeof key === 'function' && key.prototype
        && typeof key.prototype.executeCommand === 'function'
        && typeof key.prototype.registerCommand === 'function');
      if (!CommandClass) return { ok: false, error: 'command registry unavailable' };
      await window.theia.container.get(CommandClass)
        .executeCommand(${JSON.stringify(command)}, ${JSON.stringify(argument)});
      return { ok: true };
    } catch (error) { return { ok: false, error: error?.message ?? String(error) }; }
  })()`);
}

async function findPreviewView(timeoutMs = 90000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const all = await browser.send('Target.getTargets').catch(() => undefined);
    for (const info of all?.targetInfos ?? []) {
      if (!['iframe', 'page', 'webview'].includes(info.type)) continue;
      if (!String(info.url ?? '').includes('webview')) continue;
      try {
        const { sessionId } = await browser.send('Target.attachToTarget', { targetId: info.targetId, flatten: true });
        await browser.send('Page.enable', {}, sessionId).catch(() => undefined);
        const tree = await browser.send('Page.getFrameTree', {}, sessionId);
        const frames = [];
        (function walk(node) { frames.push(node.frame); (node.childFrames ?? []).forEach(walk); })(tree.frameTree);
        for (const frame of frames) {
          try {
            const world = await browser.send('Page.createIsolatedWorld',
              { frameId: frame.id, worldName: 'akari-ilps' }, sessionId);
            const hit = await evaluate(browser,
              `Boolean(document.getElementById('preview-stage') && document.getElementById('preview-layers'))`,
              world.executionContextId, sessionId);
            if (hit) return { sessionId, contextId: world.executionContextId };
          } catch { /* frame gone */ }
        }
      } catch { /* target changed */ }
    }
    await sleep(500);
  }
  throw new Error('preview webview context not found');
}

// メイン DOM の webview iframe 位置 + webview 内のステージ矩形を合成し、メインの page target
// から出力プレビューだけを切り出して撮る（iframe target への captureScreenshot は無応答になる）。
async function capture(name) {
  const inner = await evaluate(browser, `(() => {
    const rect = document.getElementById('preview-stage').getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  })()`, view.contextId, view.sessionId);
  const outer = await evaluate(main, `(() => {
    const frames = [...document.querySelectorAll('iframe')]
      .map(frame => frame.getBoundingClientRect())
      .filter(rect => rect.width > 0 && rect.height > 0)
      .sort((a, b) => b.width * b.height - a.width * a.height);
    const rect = frames[0] ?? { x: 0, y: 0 };
    return { x: rect.x, y: rect.y };
  })()`);
  const clip = {
    x: Math.round(outer.x + inner.x), y: Math.round(outer.y + inner.y),
    width: Math.round(inner.width), height: Math.round(inner.height), scale: 1
  };
  const shot = await main.send('Page.captureScreenshot', { format: 'png', fromSurface: true, clip });
  const file = path.join(shotDir, `${String(shotIndex++).padStart(2, '0')}-${name}.png`);
  await writeFile(file, Buffer.from(shot.data, 'base64'));
  return { file, clip };
}

// 画面撮影は色管理を通るので純色から外れる（既存 fixture の実測）。優勢チャネルで判定する。
const WIDTH = 320;
const HEIGHT = 180;
function metrics(file) {
  const result = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-i', file,
    '-vf', `scale=${WIDTH}:${HEIGHT},format=rgb24`, '-frames:v', '1',
    '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { encoding: 'buffer', maxBuffer: 1 << 26 });
  if (result.status !== 0) throw new Error(result.stderr.toString());
  const pixels = result.stdout;
  const acc = {
    red: { count: 0, sumX: 0, minX: WIDTH, maxX: -1 },
    green: { count: 0, sumX: 0, sumY: 0, minX: WIDTH, maxX: -1, minY: HEIGHT, maxY: -1 }
  };
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const offset = (y * WIDTH + x) * 3;
      const r = pixels[offset];
      const g = pixels[offset + 1];
      const b = pixels[offset + 2];
      if (r >= 120 && r - Math.max(g, b) >= 45) {
        acc.red.count++; acc.red.sumX += x;
        acc.red.minX = Math.min(acc.red.minX, x); acc.red.maxX = Math.max(acc.red.maxX, x);
      } else if (g >= 120 && g - Math.max(r, b) >= 45) {
        acc.green.count++; acc.green.sumX += x; acc.green.sumY += y;
        acc.green.minX = Math.min(acc.green.minX, x); acc.green.maxX = Math.max(acc.green.maxX, x);
        acc.green.minY = Math.min(acc.green.minY, y); acc.green.maxY = Math.max(acc.green.maxY, y);
      }
    }
  }
  const round = value => Math.round(value * 100) / 100;
  return {
    redCount: acc.red.count,
    redCentroidX: acc.red.count ? round(acc.red.sumX / acc.red.count) : null,
    redMinX: acc.red.count ? acc.red.minX : null,
    greenCount: acc.green.count,
    greenCentroidX: acc.green.count ? round(acc.green.sumX / acc.green.count) : null,
    greenWidth: acc.green.count ? acc.green.maxX - acc.green.minX + 1 : 0,
    greenHeight: acc.green.count ? acc.green.maxY - acc.green.minY + 1 : 0
  };
}

async function observe(name) {
  const { file } = await capture(name);
  const value = metrics(file);
  record('observe', { name, file: path.basename(file), ...value });
  return value;
}

async function seek(seconds) {
  await evaluate(browser,
    `(() => { window.postMessage({ type: 'akari-preview-seek', time: ${seconds} }, '*'); return true; })()`,
    view.contextId, view.sessionId);
  await sleep(1200);
}

const itemSelector = id => `[data-akari-item-id=${JSON.stringify(id)}]:not([data-akari-tree-row-id])`;

async function timelineInventory() {
  return evaluate(main, `JSON.stringify({
    itemIds: [...new Set([...document.querySelectorAll('[data-akari-item-id]')]
      .map(node => node.getAttribute('data-akari-item-id')))],
    cutIds: [...new Set([...document.querySelectorAll('[data-akari-cut-id]')]
      .map(node => node.getAttribute('data-akari-cut-id')))],
    cutIndexes: [...new Set([...document.querySelectorAll('[data-akari-cut-index]')]
      .map(node => node.getAttribute('data-akari-cut-index')))],
    tracks: [...document.querySelectorAll('[data-akari-timeline-track-id]')]
      .map(node => node.getAttribute('data-akari-timeline-track-id'))
  })`).then(JSON.parse);
}

async function selectItem(itemId) {
  const selector = JSON.stringify(itemSelector(itemId));
  try {
    await waitFor(`timeline item ${itemId}`, `Boolean(document.querySelector(${selector}))`, 8000);
  } catch (error) {
    record('timeline-inventory', await timelineInventory());
    throw error;
  }
  let target = null;
  let last = null;
  for (let attempt = 0; attempt < 12 && !target; attempt++) {
    await evaluate(main, `document.querySelector(${selector})?.scrollIntoView({ block: 'center' })`);
    await sleep(200);
    const candidate = await evaluate(main, `(() => {
      const item = document.querySelector(${selector});
      if (!item) return null;
      const rect = item.getBoundingClientRect();
      for (const ratio of [0.5, 0.25, 0.75]) {
        const x = rect.left + rect.width * ratio;
        const y = rect.top + rect.height / 2;
        const hit = document.elementFromPoint(x, y);
        if (hit?.closest(${selector}) === item) {
          return { x, y, width: rect.width, height: rect.height, hit: true };
        }
      }
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2,
        width: rect.width, height: rect.height, hit: false,
        blocker: hit ? (hit.tagName + '.' + String(hit.className).slice(0, 60)) : null };
    })()`);
    if (candidate) last = candidate;
    if (candidate?.hit && candidate.width > 0) target = candidate;
    else await sleep(200);
  }
  if (!target) {
    record('select-fallback', { itemId, last });
    if (!last || !(last.width > 0)) throw new Error(`no click target for ${itemId}: ${JSON.stringify(last)}`);
    target = last;
  }
  await realClick(target.x, target.y);
  await waitFor(`inspector for ${itemId}`,
    `Boolean(document.querySelector(${selector})?.classList.contains('akari-annotations-selected')
      && document.querySelector('.akari-inspector-widget'))`);
  await sleep(400);
}

const fieldSelector = field => `[data-akari-ui="field:inspector-transform-${field}"] .akari-inspector-number-input`;

// 右ドックのインスペクターは既定で畳まれていることがある（欄の rect が 0x0 になる）。
// 明示的に開いてから欄を触る。
async function openInspector(field = 'x') {
  const selector = JSON.stringify(fieldSelector(field));
  const visible = `(() => { const input = document.querySelector(${selector});
    if (!input) return false; const rect = input.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0; })()`;
  if (await evaluate(main, visible)) return 'already';
  for (let attempt = 0; attempt < 5; attempt++) {
    await executeCommand('akari.inspector.open', undefined);
    for (let wait = 0; wait < 20; wait++) {
      await sleep(300);
      if (await evaluate(main, visible)) {
        record('inspector-opened', { attempt });
        return 'command';
      }
    }
  }
  throw new Error('inspector panel did not become visible');
}

async function focusField(field) {
  const selector = JSON.stringify(fieldSelector(field));
  await waitFor(`${field} field`, `Boolean(document.querySelector(${selector}))`);
  let how = 'click';
  let probe = null;
  for (let attempt = 0; attempt < 6; attempt++) {
    probe = await evaluate(main, `(() => {
      const input = document.querySelector(${selector});
      if (!input) return null;
      input.scrollIntoView({ block: 'center' });
      const rect = input.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      const hit = document.elementFromPoint(x, y);
      return { x, y, width: rect.width, height: rect.height, hit: hit === input,
        blocker: hit ? hit.tagName + '.' + String(hit.className).slice(0, 50) : null };
    })()`);
    if (probe?.hit) break;
    await sleep(250);
  }
  if (probe?.hit) {
    await realClick(probe.x, probe.y);
  } else {
    how = 'js-focus';
    await evaluate(main, `(() => { const input = document.querySelector(${selector});
      input.focus(); input.select(); return document.activeElement === input; })()`);
  }
  await keyPress({ key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 4 });
  await sleep(150);
  const focused = await evaluate(main, `(() => { const input = document.querySelector(${selector});
    return document.activeElement === input; })()`);
  if (!focused) {
    await evaluate(main, `(() => { const input = document.querySelector(${selector});
      input.focus(); input.select(); return true; })()`);
    how += '+refocus';
  }
  record('focus-field', { field, how, probe, focused });
  const settled = await evaluate(main, `(() => { const input = document.querySelector(${selector});
    return document.activeElement === input; })()`);
  if (!settled) throw new Error(`could not focus ${field} field: ${JSON.stringify(probe)}`);
  // Cmd+A は dispatchKeyEvent では編集コマンドに落ちないことがあるので、打鍵前の空欄化は
  // JS で行う（イベントは発火しない = live 経路には乗らない）。以降の 1 打鍵ずつが検証対象。
  await evaluate(main, `(() => { const input = document.querySelector(${selector});
    input.value = ''; return input.value; })()`);
  await sleep(100);
}

async function typeChar(character) {
  await main.send('Input.insertText', { text: character });
  await sleep(220);
}

async function fieldValue(field) {
  return evaluate(main, `document.querySelector(${JSON.stringify(fieldSelector(field))})?.value ?? null`);
}

async function liveEvents() {
  return evaluate(main, 'JSON.stringify(window.__akariIlpsLive ?? [])').then(JSON.parse);
}
async function resetLive() {
  await evaluate(main, `(() => {
    window.__akariIlpsLive = [];
    if (!window.__akariIlpsHooked) {
      window.__akariIlpsHooked = true;
      window.addEventListener('akari.timeline.liveTransform', event => {
        window.__akariIlpsLive.push({
          kind: event.detail?.target?.kind, id: event.detail?.target?.id,
          index: event.detail?.target?.index, field: event.detail?.field, value: event.detail?.value
        });
      });
    }
    return true;
  })()`);
}

const readEdit = async () => JSON.parse(await readFile(editPath, 'utf8'));
const itemTransform = (edit, id) => {
  for (const track of edit.tracks ?? []) {
    for (const item of track.items ?? []) if (item.id === id) return item.transform ?? {};
  }
  return undefined;
};

let child;
let status = 'FAILED';
try {
  child = spawn(electron, [shellDir, project, `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`, '--no-sandbox', '--disable-features=MacWebContentsOcclusion'], {
    cwd: shellDir,
    env: { ...process.env, THEIA_CONFIG_DIR: config, AKARI_HOME: akariHome, AKARI_FRAME_ENGINE: frameEngine },
    stdio: 'ignore'
  });
  record('launched', { pid: child.pid, frameEngine, label });

  const targets = await waitForJson(`http://127.0.0.1:${port}/json/list`,
    values => values.find(value => value.type === 'page' && !value.url.startsWith('devtools:')));
  main = new CDP(targets.find(value => value.type === 'page' && !value.url.startsWith('devtools:')).webSocketDebuggerUrl);
  await main.connect();
  await main.send('Runtime.enable');
  const version = await waitForJson(`http://127.0.0.1:${port}/json/version`, value => value.webSocketDebuggerUrl);
  browser = new CDP(version.webSocketDebuggerUrl);
  await browser.connect();
  await browser.send('Target.setDiscoverTargets', { discover: true }).catch(() => undefined);

  await waitFor('theia ready', 'Boolean(window.theia && window.theia.container)', 120000);
  await sleep(8000);
  await evaluate(main, `(() => { const button = [...document.querySelectorAll('button')]
    .find(candidate => candidate.textContent?.trim() === '開くだけ'); if (button) button.click(); return true; })()`);
  await sleep(1500);

  for (let attempt = 0; attempt < 6; attempt++) {
    const opened = await executeCommand('akari.preview.ensureVisible', { editUri });
    if (opened.ok) break;
    await sleep(3000);
  }
  await sleep(4000);
  await evaluate(main, `(() => { const label = [...document.querySelectorAll('[class*="TabBar-tabLabel"]')]
    .find(node => node.textContent?.trim() === '出力プレビュー'); if (label) label.click(); return true; })()`);
  view = await findPreviewView();
  record('preview-attached', {});

  let timeline = await evaluate(main, `Boolean(document.getElementById('akari-annotations-widget'))`);
  for (let attempt = 0; attempt < 4 && !timeline; attempt++) {
    await keyPress({ key: 'F1', code: 'F1', windowsVirtualKeyCode: 112 });
    await sleep(500);
    await main.send('Input.insertText', { text: 'タイムラインを開く' });
    await sleep(600);
    await keyPress({ key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    for (let wait = 0; wait < 30 && !timeline; wait++) {
      await sleep(300);
      timeline = await evaluate(main, `Boolean(document.getElementById('akari-annotations-widget'))`);
    }
  }
  check(timeline, 'timeline widget is open');
  await resetLive();
  await sleep(1000);
  await observe('boot');

  const results = {};

  // (a) 上トラックのレイヤー item（緑・50% 中央）で X に 3 / 30 / 300 を 1 打鍵ずつ
  await seek(6);
  await selectItem('photo-b-item');
  await openInspector('x');
  const layerBase = await observe('a0-layer-selected-before-typing');
  await focusField('x');
  await resetLive();
  const layerSteps = [];
  for (const character of ['3', '0', '0']) {
    await typeChar(character);
    layerSteps.push({ typed: await fieldValue('x'), ...(await observe(`a-layer-x-${await fieldValue('x')}`)) });
  }
  results.layerTyping = { base: layerBase, steps: layerSteps, live: await liveEvents() };
  check(layerSteps.map(step => step.typed).join(',') === '3,30,300',
    '(a) X 欄に 3 / 30 / 300 が 1 打鍵ずつ入った', { typed: layerSteps.map(step => step.typed) });
  check(results.layerTyping.live.every(event => (event.kind === 'layer' || event.kind === 'item')
    && event.id === 'photo-b-item' && event.field === 'x'),
  '(a) live 要求は photo-b-item の x で飛んでいる', { live: results.layerTyping.live });
  check(results.layerTyping.live.map(event => event.value).join(',') === '3,30,300',
    '(a) 打鍵ごとに 3 / 30 / 300 の live 値が飛んだ（確定前）', { live: results.layerTyping.live });
  check(layerSteps[1].greenCentroidX > layerSteps[0].greenCentroidX + 2
    && layerSteps[2].greenCentroidX > layerSteps[1].greenCentroidX + 30,
    '(a) 打鍵ごとにプレビューの緑素材が右へ動いた',
    { centroids: layerSteps.map(step => step.greenCentroidX) });
  // 確定前なので edit.json は無傷
  check(itemTransform(await readEdit(), 'photo-b-item').x === 0,
    '(a) 確定前は edit.json の transform.x が 0 のまま', {});
  // Escape で元に戻す（次の検証を汚さない）
  await keyPress({ key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await sleep(600);
  await observe('a-after-escape');

  // (c) 回転 45 をタイプ（同じレイヤー item）
  await openInspector('rotate');
  await focusField('rotate');
  await resetLive();
  const rotateSteps = [];
  for (const character of ['4', '5']) {
    await typeChar(character);
    rotateSteps.push({ typed: await fieldValue('rotate'), ...(await observe(`c-layer-rotate-${await fieldValue('rotate')}`)) });
  }
  results.rotate = { steps: rotateSteps, live: await liveEvents() };
  check(results.rotate.live.map(event => `${event.field}:${event.value}`).join(',') === 'rotate:4,rotate:45',
    '(c) 回転 4 → 45 が打鍵ごとに live で飛んだ', { live: results.rotate.live });
  // 素材は横長（既定の外接は約 158x87）。45° では外接がほぼ正方形へ近づき、縦が大きく伸びる。
  check(rotateSteps[1].greenHeight > rotateSteps[0].greenHeight + 30
    && Math.abs(rotateSteps[1].greenWidth - rotateSteps[1].greenHeight) <= 20,
    '(c) 45° で緑素材の外接矩形が正方形へ広がった（回転がプレビューに乗った）',
    { steps: rotateSteps.map(step => ({ w: step.greenWidth, h: step.greenHeight })) });
  await keyPress({ key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await sleep(600);

  // (b) base トラックの v2 item（赤・全画面）で同じ
  await seek(2);
  // base トラックの帯は data-akari-item-id にトラック内 index（"0"）を出す。実体は
  // edit.json の photo-a-item（v2 item）で、インスペクターがどの target を送るかは live ログで見る。
  await selectItem('0');
  await openInspector('x');
  const baseBefore = await observe('b0-base-item-selected-before-typing');
  await focusField('x');
  await resetLive();
  const baseSteps = [];
  for (const character of ['3', '0', '0']) {
    await typeChar(character);
    baseSteps.push({ typed: await fieldValue('x'), ...(await observe(`b-base-x-${await fieldValue('x')}`)) });
  }
  results.baseTyping = { base: baseBefore, steps: baseSteps, live: await liveEvents() };
  check(results.baseTyping.live.length === 3 && results.baseTyping.live.every(event => event.field === 'x'),
    '(b) base トラックの clip でも打鍵ごとに live 要求が飛ぶ',
    { live: results.baseTyping.live, target: results.baseTyping.live[0] });
  check(results.baseTyping.live.map(event => event.value).join(',') === '3,30,300',
    '(b) 打鍵ごとに 3 / 30 / 300 の live 値が飛んだ', { live: results.baseTyping.live });
  check(baseSteps[1].redCentroidX > baseSteps[0].redCentroidX + 2
    && baseSteps[2].redCentroidX > baseSteps[1].redCentroidX + 20,
    '(b) base トラックの v2 item でも打鍵ごとにプレビューが動いた',
    { centroids: baseSteps.map(step => step.redCentroidX) });

  // (d-1) Escape は元の値へ戻し、プレビューも戻る
  await keyPress({ key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await sleep(900);
  const afterEscape = await observe('d1-base-after-escape');
  results.escape = { value: await fieldValue('x'), metrics: afterEscape, edit: itemTransform(await readEdit(), 'photo-a-item') };
  check(Number(results.escape.value) === 0, '(d) Escape で X 欄が元値 0 に戻った', { value: results.escape.value });
  check((results.escape.edit.x ?? 0) === 0, '(d) Escape 後の edit.json は 0 のまま', { edit: results.escape.edit });
  check(Math.abs(afterEscape.redCentroidX - baseBefore.redCentroidX) <= 2,
    '(d) Escape でプレビューが元の位置へ戻った',
    { before: baseBefore.redCentroidX, after: afterEscape.redCentroidX });

  // (d-2) タイプ → blur は確定値とプレビューが一致
  await focusField('x');
  await resetLive();
  for (const character of ['6', '0']) await typeChar(character);
  const beforeBlur = await observe('d2-base-x-60-before-blur');
  await evaluate(main, `(() => { const input = document.querySelector(
    ${JSON.stringify(fieldSelector('x'))}); if (input) input.blur(); return true; })()`);
  await sleep(1800);
  const afterBlur = await observe('d2-base-x-60-after-blur');
  results.blur = { beforeBlur, afterBlur, edit: itemTransform(await readEdit(), 'photo-a-item'),
    value: await fieldValue('x') };
  check(results.blur.edit.x === 60, '(d) blur で edit.json の transform.x が 60 に確定した', { edit: results.blur.edit });
  check(Math.abs(afterBlur.redCentroidX - beforeBlur.redCentroidX) <= 3,
    '(d) 確定後のプレビューが確定前の live プレビューと一致する',
    { beforeBlur: beforeBlur.redCentroidX, afterBlur: afterBlur.redCentroidX });

  // (b2) base トラックの v2 item を「item ターゲット」で live 要求したときの受け側解決。
  // インスペクターがこの fixture の base 帯には cut ターゲットを送るため、タイムラインが使う
  // のと同じ window CustomEvent チャネルへ item ターゲットを直接流して受け側だけを確かめる。
  const dispatchLive = async (target, field, value) => {
    await evaluate(main, `(() => { window.dispatchEvent(new CustomEvent('akari.timeline.liveTransform', {
      detail: { editUri: ${JSON.stringify(editUri)}, target: ${JSON.stringify(target)},
        field: ${JSON.stringify(field)}, value: ${value} } })); return true; })()`);
    await sleep(900);
  };
  const committed = await observe('e0-item-target-baseline');
  await dispatchLive({ kind: 'item', id: 'photo-a-item' }, 'x', 220);
  const itemTargeted = await observe('e1-item-target-x-220');
  await dispatchLive({ kind: 'item', id: 'no-such-item' }, 'x', -260);
  const unknownTargeted = await observe('e2-item-target-unknown');
  await dispatchLive({ kind: 'item', id: 'photo-a-item' }, 'x', 60);
  const restored = await observe('e3-item-target-restored');
  results.itemTarget = { committed, itemTargeted, unknownTargeted, restored };
  check(itemTargeted.redCentroidX > committed.redCentroidX + 20,
    '(b2) item ターゲット（base トラックの v2 item = summary.cuts 側）がプレビューへ届いた',
    { committed: committed.redCentroidX, itemTargeted: itemTargeted.redCentroidX });
  check(Math.abs(unknownTargeted.redCentroidX - itemTargeted.redCentroidX) <= 3,
    '(b2) 存在しない item id は無視される', { unknownTargeted: unknownTargeted.redCentroidX });
  check(Math.abs(restored.redCentroidX - committed.redCentroidX) <= 3,
    '(b2) 元値の item ターゲットで確定値の見た目へ戻る',
    { committed: committed.redCentroidX, restored: restored.redCentroidX });

  status = 'PASS';
  record('verdict', { status, label });
  await writeFile(path.join(here, `run-log-${label}.json`),
    `${JSON.stringify({ status, label, frameEngine, results, records: log }, null, 2)}\n`);
} catch (error) {
  await writeFile(path.join(here, `run-log-${label}.json`),
    `${JSON.stringify({ status, label, frameEngine, error: String(error?.stack ?? error), records: log }, null, 2)}\n`)
    .catch(() => undefined);
  console.error(error);
} finally {
  main?.close();
  browser?.close();
  if (child?.pid) {
    try { process.kill(child.pid, 'SIGTERM'); } catch { /* already exited */ }
    await sleep(1500);
    try { process.kill(child.pid, 'SIGKILL'); } catch { /* already exited */ }
  }
  await sleep(1000);
  await rm(scratch, { recursive: true, force: true });
}
console.log(`L1_STATUS=${status}`);
process.exit(status === 'PASS' ? 0 : 1);
