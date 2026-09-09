#!/usr/bin/env node

// L1: launch the real Electron shell against an isolated project that mounts the two fixtures
// (canvas-center.html = full-frame WebGL canvas painting only the centre, telop-center.html =
// nested inset:0 wrappers around centred text), then measure for each fixture
//   (1) the selection frame shrinks to the painted content, and
//   (2) a click on a transparent part of the fragment selects the video underneath.
// Screenshots of the preview stage are written to --out (before / after evidence).
//
// Usage: node dev-fixtures/overlay-content-box-canvas-hit/run-l1.mjs --label after --out <dir>

import { spawn, spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, realpath, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const fixtureDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(fixtureDir, '..', '..');
const shellDir = path.join(repoRoot, 'apps', 'shell');
const ffmpeg = path.join(repoRoot, 'packages', 'media-bin', 'vendor', `${process.platform}-${process.arch}`,
  process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
const electron = process.platform === 'darwin'
  ? path.join(shellDir, 'node_modules', 'electron', 'dist', 'Electron.app', 'Contents', 'MacOS', 'Electron')
  : process.platform === 'win32'
    ? path.join(shellDir, 'node_modules', 'electron', 'dist', 'electron.exe')
    : path.join(shellDir, 'node_modules', 'electron', 'dist', 'electron');

function argument(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}
const label = argument('label', 'after');
const outDir = path.resolve(argument('out', path.join(repoRoot, 'evidence',
  '2026-09-09-overlay-content-box-canvas-hit')));
const port = Number(process.env.AKARI_CDP_PORT ?? 9431);

// macOS の os.tmpdir() は /var/folders/... のシンボリックリンク。workspace root は実パスで
// 解決されるため realpath で正規化しないと editUri が「ワークスペース外」になる。
const scratch = await realpath(await mkdtemp(path.join(os.tmpdir(), 'akari-content-box-l1-')));
const project = path.join(scratch, 'project');
const profile = path.join(scratch, 'profile');
const config = path.join(scratch, 'config');
const akariHome = path.join(scratch, 'akari-home');
const editUri = pathToFileURL(path.join(project, 'edit.json')).href;

await stat(electron);
await Promise.all([mkdir(profile), mkdir(config), mkdir(akariHome, { recursive: true }),
  mkdir(path.join(project, 'overlays'), { recursive: true }),
  mkdir(path.join(project, 'assets'), { recursive: true })]);
for (const name of ['canvas-center.html', 'telop-center.html']) {
  await cp(path.join(fixtureDir, name), path.join(project, 'overlays', name));
}
// canvas-center.html は texts[].font に edit.json 相対の "assets/three-text.ttf" を宣言する
// （シェルは data: を受け付けない — three-scene-assets.ts の assertRelativeAssetPath）。
await cp(path.join(repoRoot, 'assets', 'font', 'dela-gothic-one', 'DelaGothicOne-Regular.ttf'),
  path.join(project, 'assets', 'three-text.ttf'));
const base = path.join(project, 'assets', 'base.mp4');
const encoded = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
  '-f', 'lavfi', '-i', 'color=c=0x2f5f8f:s=1280x720:d=10:r=30',
  '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-g', '30', base], { encoding: 'utf8' });
if (encoded.status !== 0) throw new Error(`ffmpeg failed: ${encoded.stderr}`);

// 単一の visual カット（下の素材）+ HTML オーバーレイ 2 本を別時刻に並べる。
await writeFile(path.join(project, 'edit.json'), `${JSON.stringify({
  version: 2,
  output: { width: 1280, height: 720, fps: 30 },
  sources: [{ id: 'base', path: 'assets/base.mp4' }],
  tracks: [
    { id: 'v-main', lane: 'visual', name: '本編', items: [
      { id: 'cut-1', at: 0, duration: 270, source: { kind: 'media', src: 'base', in: 0, out: 9 } }] },
    { id: 'v-html', lane: 'visual', name: 'HTML', items: [
      { id: 'canvas-center', at: 0, duration: 120, source: { kind: 'html', path: 'overlays/canvas-center.html' } },
      { id: 'telop-center', at: 150, duration: 120, source: { kind: 'html', path: 'overlays/telop-center.html' } }] }
  ]
}, null, 2)}\n`);
await mkdir(path.join(project, '.akari'), { recursive: true });
await writeFile(path.join(project, '.akari', 'lint.json'), '{"version":1,"verdict":"pass"}\n');
await mkdir(outDir, { recursive: true });

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
  on(method, listener) {
    this.listeners.set(method, [...(this.listeners.get(method) ?? []), listener]);
  }
  close() { this.socket?.close(); }
}

async function evaluate(cdp, expression, contextId, sessionId) {
  const response = await cdp.send('Runtime.evaluate', {
    expression, returnByValue: true, awaitPromise: true,
    ...(contextId === undefined ? {} : { contextId }),
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

// interaction.js が公開する window.akari.* は「メインワールド」にしか無い。isolated world は
// DOM を共有するが JS グローバルは別物なので、Runtime.executionContextCreated を拾って
// 既定コンテキスト（auxData.isDefault）を掴む（verify スキル L1 §5 の手順）。
const mainWorldContexts = new Map();
function trackContexts(browser) {
  browser.on('Runtime.executionContextCreated', (params, sessionId) => {
    if (!params?.context?.auxData?.isDefault) return;
    const list = mainWorldContexts.get(sessionId) ?? [];
    list.push(params.context.id);
    mainWorldContexts.set(sessionId, list);
  });
  browser.on('Runtime.executionContextsCleared', (_params, sessionId) => mainWorldContexts.delete(sessionId));
  browser.on('Runtime.consoleAPICalled', params => {
    if (params.type !== 'error' && params.type !== 'warning') return;
    consoleErrors.push(params.args.map(arg => arg.value ?? arg.description ?? arg.type).join(' ').slice(0, 400));
  });
  browser.on('Runtime.exceptionThrown', params => {
    consoleErrors.push(String(params.exceptionDetails?.exception?.description
      ?? params.exceptionDetails?.text ?? '').slice(0, 400));
  });
}
const consoleErrors = [];

async function findPreviewView(browser, timeoutMs = 60000) {
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
              `Boolean(document.getElementById('preview-layers') && document.getElementById('play-toggle')
                 && window.akari?.interaction?.fragmentBounds)`,
              contextId, sessionId);
            if (hit) return { sessionId, contextId };
          } catch { /* context gone */ }
        }
      } catch { /* target changed mid-flight */ }
    }
    await sleep(500);
  }
  throw new Error('preview webview main-world context not found');
}

async function executeCommand(main, command, argumentValue) {
  return evaluate(main, `(async () => {
    try {
      const dictionary = window.theia?.container?._bindingDictionary;
      const keys = dictionary?._map ? [...dictionary._map.keys()] : [];
      const CommandClass = keys.find(key => typeof key === 'function' && key.prototype
        && typeof key.prototype.executeCommand === 'function' && typeof key.prototype.registerCommand === 'function');
      if (!CommandClass) return { ok: false, error: 'command registry unavailable' };
      const value = await window.theia.container.get(CommandClass)
        .executeCommand(${JSON.stringify(command)}, ${JSON.stringify(argumentValue)});
      return { ok: true, value: typeof value === 'string' ? value : null };
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

async function capture(main, browser, view, name) {
  const inner = await evaluate(browser, `(() => {
    const stage = document.getElementById('preview-layers').getBoundingClientRect();
    return { x: stage.x, y: stage.y, width: stage.width, height: stage.height };
  })()`, view.contextId, view.sessionId);
  const outer = await frameOffset(main);
  const shot = await main.send('Page.captureScreenshot', {
    format: 'png', fromSurface: true,
    clip: { x: outer.x + inner.x, y: outer.y + inner.y, width: inner.width, height: inner.height, scale: 1 },
  });
  const file = path.join(outDir, `${name}.png`);
  await writeFile(file, Buffer.from(shot.data, 'base64'));
  return path.basename(file);
}

async function click(main, x, y) {
  for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
    await main.send('Input.dispatchMouseEvent', {
      type, x, y, button: 'left', buttons: type === 'mousePressed' ? 1 : 0,
      clickCount: type === 'mouseMoved' ? 0 : 1, pointerType: 'mouse',
    });
    await sleep(60);
  }
  await sleep(500);
}

// webview 内の観測。overlay コンテナ矩形・内容枠・選択枠・カット選択枠をまとめて読む。
const OBSERVE = id => `(() => {
  const container = document.querySelector('[data-overlay-id=${JSON.stringify(id)}]');
  if (!container) return { mounted: false };
  const rect = container.getBoundingClientRect();
  const bounds = window.akari?.interaction?.fragmentBounds?.(container) ?? null;
  const frame = document.querySelector('[data-akari-interaction="selection-frame"]');
  const cut = document.getElementById('cut-select-box');
  const stage = document.getElementById('preview-layers').getBoundingClientRect();
  return {
    mounted: true,
    visibility: getComputedStyle(container).visibility,
    container: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
    stage: { left: stage.left, top: stage.top, width: stage.width, height: stage.height },
    bounds: bounds && { left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height },
    selectionFrame: frame ? { width: parseFloat(frame.style.width), height: parseFloat(frame.style.height) } : null,
    cutSelected: Boolean(cut && cut.classList.contains('is-active')),
    diagnostics: {
      three: (() => {
        try { return window.akari?.threeRuntime?.inspect?.(container) ?? null; }
        catch (error) { return { error: String(error?.message ?? error) }; }
      })(),
      canvas: (() => {
        const node = container.querySelector('canvas');
        return node ? { width: node.width, height: node.height, clientWidth: node.clientWidth } : null;
      })(),
      scripts: [...container.querySelectorAll('script')].map(node => ({
        type: node.getAttribute('type'), declared: node.hasAttribute('data-akari-3d-scene'),
        text: (node.textContent ?? '').slice(0, 160) })),
      childElementCount: container.childElementCount,
      readDescriptor: (() => {
        try { return { ok: true, keys: Object.keys(JSON.parse(container.querySelector('script[data-akari-3d-scene]')?.textContent ?? '{}')) }; }
        catch (error) { return { ok: false, error: String(error?.message ?? error) }; }
      })(),
      html: container.innerHTML.slice(0, 400),
    },
  };
})()`;

let child;
let main;
let browser;
const report = { label, fixtures: {} };
try {
  child = spawn(electron, [shellDir, project, `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`, '--no-sandbox'], {
    cwd: shellDir,
    env: { ...process.env, THEIA_CONFIG_DIR: config, AKARI_HOME: akariHome },
    stdio: 'ignore',
  });
  const targets = await waitForJson(`http://127.0.0.1:${port}/json/list`,
    values => values.find(value => value.type === 'page'));
  const target = targets.find(value => value.type === 'page' && !value.url.startsWith('devtools:'));
  main = new CDP(target.webSocketDebuggerUrl);
  await main.connect();
  await main.send('Runtime.enable');
  const version = await waitForJson(`http://127.0.0.1:${port}/json/version`, value => value.webSocketDebuggerUrl);
  browser = new CDP(version.webSocketDebuggerUrl);
  await browser.connect();
  trackContexts(browser);
  await browser.send('Target.setDiscoverTargets', { discover: true }).catch(() => undefined);
  // 既定ウィンドウではステージが 332px 幅しかなく、内容枠と透明部の判別が粗くなる。
  try {
    const { windowId } = await browser.send('Browser.getWindowForTarget', { targetId: target.id });
    await browser.send('Browser.setWindowBounds',
      { windowId, bounds: { left: 0, top: 0, width: 1680, height: 1040, windowState: 'normal' } });
  } catch { /* window bounds are best-effort */ }

  await sleep(10000);
  let view;
  const deadline = Date.now() + 180000;
  while (!view && Date.now() < deadline) {
    await evaluate(main, `(() => { const b=[...document.querySelectorAll('button')]
      .find(x=>x.textContent?.trim()==='開くだけ'); if(b)b.click(); return true; })()`);
    const opened = await executeCommand(main, 'akari.preview.ensureVisible', { editUri });
    if (!opened.ok) { await sleep(2000); continue; }
    await sleep(3000);
    await activatePreview(main);
    view = await findPreviewView(browser, 20000).catch(() => undefined);
  }
  if (!view) throw new Error('preview did not activate');

  for (const [id, seconds] of [['canvas-center', 2], ['telop-center', 7]]) {
    let done = false;
    let lastError;
    for (let attempt = 0; attempt < 5 && !done; attempt += 1) {
      try {
        await activatePreview(main);
        view = await findPreviewView(browser, 15000);
        await evaluate(browser, `(() => { window.postMessage({type:'akari-preview-seek',time:${seconds}}, '*'); return true; })()`,
          view.contextId, view.sessionId);
        await sleep(2500);
        let initial = await evaluate(browser, OBSERVE(id), view.contextId, view.sessionId);
        // 3D は非同期に読み込む。ready になるまで（最大 20 秒）待ってから測る。
        for (let wait = 0; wait < 40 && initial.diagnostics?.three
          && initial.diagnostics.three.status !== 'ready' && !initial.diagnostics.three.error; wait += 1) {
          await sleep(500);
          initial = await evaluate(browser, OBSERVE(id), view.contextId, view.sessionId);
        }
        if (!initial.mounted || !initial.bounds) throw new Error(`${id} not mounted: ${JSON.stringify(initial)}`);
        report.fixtures[`${id}-diagnostics`] = initial.diagnostics;
        const outer = await frameOffset(main);
        const entry = {
          seconds,
          containerRatio: {
            width: initial.bounds.width / initial.container.width,
            height: initial.bounds.height / initial.container.height,
          },
          container: initial.container,
          bounds: initial.bounds,
        };

        // 1) 描かれている内容の中央をクリック → オーバーレイが選択され、枠が内容に縮む
        await click(main, outer.x + initial.bounds.left + initial.bounds.width / 2,
          outer.y + initial.bounds.top + initial.bounds.height / 2);
        const onContent = await evaluate(browser, OBSERVE(id), view.contextId, view.sessionId);
        entry.contentClick = { selectionFrame: onContent.selectionFrame, cutSelected: onContent.cutSelected };
        entry.shots = { content: await capture(main, browser, view, `${label}-${id}-content-click`) };

        // 2) 断片の透明部（コンテナ左上の隅）をクリック → 下の素材（カット）が選ばれる
        await click(main, outer.x + initial.container.left + 14, outer.y + initial.container.top + 14);
        const onTransparent = await evaluate(browser, OBSERVE(id), view.contextId, view.sessionId);
        entry.transparentClick = {
          selectionFrame: onTransparent.selectionFrame, cutSelected: onTransparent.cutSelected,
        };
        entry.shots.transparent = await capture(main, browser, view, `${label}-${id}-transparent-click`);
        entry.checks = {
          // (1) 枠が内容に縮む  (2) 内容クリックでオーバーレイが選択される
          // (3) 透明部クリックで下の素材（カット）が選ばれる
          shrinks: entry.containerRatio.width < 0.9 && entry.containerRatio.height < 0.9,
          contentSelectsOverlay: Boolean(entry.contentClick.selectionFrame) && !entry.contentClick.cutSelected,
          transparentSelectsMedia: entry.transparentClick.cutSelected === true,
        };
        entry.pass = Object.values(entry.checks).every(Boolean);
        report.fixtures[id] = entry;
        done = true;
      } catch (error) {
        lastError = error;
        if (!/Session with given id|Cannot find context|context.*destroyed|Target closed/i.test(String(error?.message))) throw error;
        await sleep(1000);
      }
    }
    if (!done) throw lastError ?? new Error(`${id} never observed`);
  }
} finally {
  main?.close();
  browser?.close();
  if (child?.pid) {
    try { process.kill(child.pid, 'SIGTERM'); } catch { /* exited */ }
    await sleep(1500);
    try { process.kill(child.pid, 'SIGKILL'); } catch { /* exited */ }
  }
  await sleep(500);
  await rm(scratch, { recursive: true, force: true });
}

report.consoleErrors = consoleErrors.slice(-25);
report.verdict = ['canvas-center', 'telop-center'].every(id => report.fixtures[id]?.pass) ? 'PASS' : 'FAIL';
console.log(JSON.stringify(report, null, 2));
