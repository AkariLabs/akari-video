#!/usr/bin/env node

// L1（検証専用）: 図形アイテム入りの edit.json を隔離プロジェクトに置いて本物の Electron シェルを起動し、
// 出力プレビューが構築できるか（落ちないか）・各図形が DOM にマウントされるかを観測してスクショを残す。
//
// 使い方:
//   node evidence/s0-shape-contract/run-l1.mjs --shell <apps/shell の絶対パス> --edit <edit.json> \
//     --label before-direct --out <出力 dir> [--ids a,b,c] [--seek 1]
// 環境変数 AKARI_CDP_PORT（既定 9543）・L1_TMP_PREFIX（一時ディレクトリ名の接頭辞）。

import { spawn } from 'node:child_process';
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
const editSource = path.resolve(argument('edit'));
const label = argument('label', 'run');
const outDir = path.resolve(argument('out', '.'));
const ids = (argument('ids', '') || '').split(',').filter(Boolean);
const seek = Number(argument('seek', '1'));
const port = Number(process.env.AKARI_CDP_PORT ?? 9543);
const electron = path.join(shellDir, 'node_modules', 'electron', 'dist', 'Electron.app', 'Contents', 'MacOS', 'Electron');

const scratch = await realpath(await mkdtemp(path.join(os.tmpdir(), process.env.L1_TMP_PREFIX ?? 'akari-shape-l1-')));
const project = path.join(scratch, 'project');
const profile = path.join(scratch, 'profile');
const config = path.join(scratch, 'config');
const akariHome = path.join(scratch, 'akari-home');
const editUri = pathToFileURL(path.join(project, 'edit.json')).href;

await stat(electron);
await Promise.all([mkdir(profile), mkdir(config), mkdir(akariHome, { recursive: true }),
  mkdir(path.join(project, '.akari'), { recursive: true }), mkdir(outDir, { recursive: true })]);
await copyFile(editSource, path.join(project, 'edit.json'));
await writeFile(path.join(project, '.akari', 'lint.json'), '{"version":1,"verdict":"pass"}\n');

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
  if (response.exceptionDetails) throw new Error(JSON.stringify(response.exceptionDetails));
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
    format: 'png', fromSurface: true, ...(clip ? { clip: { ...clip, scale: 1 } } : {}),
  });
  await writeFile(path.join(outDir, `${name}.png`), Buffer.from(shot.data, 'base64'));
  return `${name}.png`;
}

const OBSERVE = `(() => {
  const ids = ${JSON.stringify(ids)};
  const stage = document.getElementById('preview-layers').getBoundingClientRect();
  const items = {};
  for (const id of ids) {
    const node = document.querySelector('[data-overlay-id=' + JSON.stringify(id) + ']');
    if (!node) { items[id] = { mounted: false }; continue; }
    const rect = node.getBoundingClientRect();
    const svg = node.querySelector('svg');
    const svgRect = svg ? svg.getBoundingClientRect() : null;
    items[id] = {
      mounted: true,
      visibility: getComputedStyle(node).visibility,
      rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
      svg: svgRect ? { left: svgRect.left, top: svgRect.top, width: svgRect.width, height: svgRect.height,
        viewBox: svg.getAttribute('viewBox') } : null,
      htmlHead: node.innerHTML.slice(0, 300),
    };
  }
  return { stage: { x: stage.x, y: stage.y, width: stage.width, height: stage.height },
    overlayCount: document.querySelectorAll('[data-overlay-id]').length, items };
})()`;

let child;
let main;
let browser;
const report = { label, edit: path.basename(editSource), port };
try {
  child = spawn(electron, [shellDir, project, `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`, '--no-sandbox'], {
    cwd: shellDir,
    env: { ...process.env, THEIA_CONFIG_DIR: config, AKARI_HOME: akariHome },
    stdio: 'ignore',
    // Theia のバックエンドは子プロセスで動く。自分が起動した木だけをまとめて止めるため別グループにする。
    detached: true,
  });
  report.pid = child.pid;
  // 起動直後の page は url が空のまま差し替わることがある。読み込み先が決まった page を待つ。
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
  let view;
  const attempts = [];
  const deadline = Date.now() + 120000;
  while (!view && Date.now() < deadline) {
    await evaluate(main, `(() => { const b=[...document.querySelectorAll('button')]
      .find(x=>x.textContent?.trim()==='開くだけ'); if(b)b.click(); return true; })()`);
    const opened = await executeCommand(main, 'akari.preview.ensureVisible', { editUri });
    attempts.push(opened);
    if (!opened.ok) { await sleep(3000); continue; }
    await sleep(4000);
    await activatePreview(main);
    view = await findPreviewView(browser, 15000);
  }
  report.openAttempts = attempts.slice(-5);
  report.previewBuilt = Boolean(view);
  if (view) {
    await evaluate(browser, `(() => { window.postMessage({type:'akari-preview-seek',time:${seek}}, '*'); return true; })()`,
      view.contextId, view.sessionId);
    await sleep(3000);
    const observed = await evaluate(browser, OBSERVE, view.contextId, view.sessionId);
    report.observed = observed;
    const outer = await frameOffset(main);
    report.shot = await screenshot(main, `${label}-stage`, {
      x: outer.x + observed.stage.x, y: outer.y + observed.stage.y,
      width: observed.stage.width, height: observed.stage.height,
    });
    report.allMounted = ids.every(id => observed.items[id]?.mounted);
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
  await rm(scratch, { recursive: true, force: true });
}

// 証跡にローカルの絶対パスを残さない（file:// と /private・/tmp・/Users・/var 始まりを伏せる）。
const scrub = line => line.replace(/file:\/\/\/[^\s)]+/g, '<file>').replace(/\/(?:private|tmp|Users|var)\/[^\s):]+/g, '<path>');
report.consoleErrors = [...new Set(consoleErrors.filter(line => /shape|trimStart|TypeError|preview|overlay/i.test(line))
  .map(line => scrub(line).replace(/^\S+Z /, '')))].slice(-12);
if (report.error) report.error = scrub(report.error);
await writeFile(path.join(outDir, `${label}.json`), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
