#!/usr/bin/env node

// L1 harness (wrapper-authored, verification-only; not product source).
// task 2026-09-12-preview-context-menu-blank 指示 3 / 4。
//
// 出力プレビューの中で実マウスの右クリックを 1 回打ち、
//  (a) メインドキュメントに Lumino の .lm-Menu（= 黒い丸ポチの実体）が出るか
//  (b) webview 内の contextmenu イベントが defaultPrevented になっているか
//  (c) ホストへ akari-preview-context-menu が届いたか（console.debug フック）
// を計測して JSON + PNG で残す。
//
// 使い方:
//   AKARI_FRAME_ENGINE=1 AKARI_L1_LABEL=after-frame-engine node run-l1.mjs
//   AKARI_FRAME_ENGINE=0 AKARI_L1_LABEL=after-legacy      node run-l1.mjs
//
// AKARI_HOME / THEIA_CONFIG_DIR / --user-data-dir はすべて mkdtemp した一時ディレクトリへ
// 向けてあり、実利用の ~/.akari ~/.theia ~/.config/akari-video は読み書きしない。
// 終了時は自分が spawn した Electron の pid だけを指名 kill する（pkill -f Electron はしない）。

import { spawn } from 'node:child_process';
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
const port = Number(process.env.AKARI_CDP_PORT ?? 9471);
const frameEngine = process.env.AKARI_FRAME_ENGINE ?? '1';
const label = process.env.AKARI_L1_LABEL ?? (frameEngine === '0' ? 'legacy' : 'frame-engine');

const scratch = await realpath(await mkdtemp(path.join(os.tmpdir(), 'akari-ctxmenu-')));
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
await Promise.all([mkdir(profile), mkdir(config), mkdir(akariHome),
  mkdir(path.join(project, '.akari'), { recursive: true })]);
await writeFile(path.join(project, '.akari', 'lint.json'), '{"version":1,"verdict":"pass"}\n');

// 証跡に作業機のパスを残さない（wrapper-codex.md 2026-09-09 追記）。
const sanitize = value => String(value)
  .split(scratch).join('<TMP>')
  .split(repoRoot).join('<WORKTREE>')
  .split(os.tmpdir()).join('<TMP>')
  .split(os.homedir()).join('<HOME>');

const log = [];
function record(step, data = {}) {
  const entry = JSON.parse(sanitize(JSON.stringify({ step, ...data })));
  log.push(entry);
  console.log(`[${step}]`, JSON.stringify(entry));
}
function check(condition, message, data = {}) {
  record(condition ? 'ok' : 'FAILED', { message, ...data });
  if (!condition) throw new Error(`assertion failed: ${message}`);
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

async function waitForJson(url, predicate, timeoutMs = 120000) {
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
const hostLogs = [];

async function waitFor(description, expression, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { if (await evaluate(main, expression)) return true; } catch { /* redraw */ }
    await sleep(150);
  }
  throw new Error(`timed out waiting for ${description}`);
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

async function findPreviewView(timeoutMs = 120000) {
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
              { frameId: frame.id, worldName: 'akari-ctxmenu' }, sessionId);
            const hit = await evaluate(browser,
              `Boolean(document.getElementById('preview-stage') && document.getElementById('preview-layers'))`,
              world.executionContextId, sessionId);
            if (hit) return { sessionId, contextId: world.executionContextId, frameId: frame.id, targetId: info.targetId };
          } catch { /* frame gone */ }
        }
      } catch { /* target changed */ }
    }
    await sleep(500);
  }
  throw new Error('preview webview context not found');
}

/** メインドキュメントの Lumino メニューを数える（= 空コンテキストメニューの実体）。 */
const menuCensus = () => evaluate(main, `JSON.stringify((() => {
  const menus = [...document.querySelectorAll('.lm-Menu')];
  return {
    count: menus.length,
    menus: menus.map(node => {
      const rect = node.getBoundingClientRect();
      const content = node.querySelector('.lm-Menu-content');
      return {
        attached: node.isConnected,
        parent: node.parentElement ? node.parentElement.tagName : null,
        items: content ? content.childElementCount : null,
        rect: { x: Math.round(rect.x), y: Math.round(rect.y),
          w: Math.round(rect.width), h: Math.round(rect.height) }
      };
    })
  };
})())`).then(JSON.parse);

/** webview 側に「イベントが来たか / defaultPrevented か」を記録する probe を仕込む（isolated world）。 */
const installProbe = () => evaluate(browser, `(() => {
  window.__akariCtxProbe = [];
  if (!window.__akariCtxProbeHooked) {
    window.__akariCtxProbeHooked = true;
    document.addEventListener('contextmenu', event => {
      window.__akariCtxProbe.push({
        defaultPrevented: event.defaultPrevented,
        clientX: event.clientX, clientY: event.clientY,
        target: event.target ? (event.target.id || event.target.tagName) : null
      });
    }, false);
  }
  return true;
})()`, view.contextId, view.sessionId);

/** ホスト（メインレンダラー）側の console.debug を包んで、log-only フックの実行を直接捕まえる。
 *  Theia はログレベル次第で console.debug を差し替えるので CDP の consoleAPICalled だけでは足りない。 */
const installHostProbe = () => evaluate(main, `(() => {
  window.__akariCtxHostLog = [];
  if (!window.__akariCtxHostHooked) {
    window.__akariCtxHostHooked = true;
    const original = console.debug ? console.debug.bind(console) : () => {};
    console.debug = (...args) => {
      try {
        window.__akariCtxHostLog.push(args.map(arg => {
          if (typeof arg === 'string') return arg;
          try { return JSON.stringify(arg); } catch { return String(arg); }
        }).join(' '));
      } catch { /* ignore */ }
      return original(...args);
    };
  }
  return true;
})()`);

const readHostProbe = () => evaluate(main,
  `JSON.stringify((window.__akariCtxHostLog ?? []).filter(line => line.includes('akari-preview')))`)
  .then(JSON.parse);

/** ホスト側の「コンテキストメニューを出せ」要求を 2 経路とも捕まえる。
 *  Theia の ElectronContextMenuRenderer は titleBarStyle が native なら
 *  window.electronTheiaCore.popup（OS ネイティブメニュー・DOM に出ない）、
 *  custom なら Lumino の .lm-Menu（DOM）を使う。前者はモーダルで計測が止まるため
 *  probe では実 popup を抑止し「要求されたこと + 項目数」だけを記録する。 */
const installMenuProbe = () => evaluate(main, `(() => {
  window.__akariCtxPopup = [];
  window.__akariCtxAdded = [];
  if (!window.__akariCtxMenuHooked) {
    window.__akariCtxMenuHooked = true;
    const core = window.electronTheiaCore;
    if (core && typeof core.popup === 'function') {
      const original = core.popup.bind(core);
      core.popup = (template, x, y, onClosed, windowName) => {
        let items = null;
        let dump = null;
        try {
          items = Array.isArray(template) ? template.length
            : (Array.isArray(template?.items) ? template.items.length : null);
          dump = JSON.stringify(template).slice(0, 400);
        } catch { /* not serializable */ }
        window.__akariCtxPopup.push({ items, x, y, template: dump });
        if (typeof onClosed === 'function') setTimeout(onClosed, 0);
        return Promise.resolve(-1);
      };
      window.__akariCtxPopupOriginal = original;
    }
    new MutationObserver(records => {
      for (const entry of records) {
        for (const node of entry.addedNodes) {
          if (node.nodeType !== 1) continue;
          window.__akariCtxAdded.push({
            tag: node.tagName, className: String(node.className ?? '').slice(0, 120)
          });
        }
      }
    }).observe(document.body, { childList: true });
  }
  return Promise.resolve(window.electronTheiaCore?.getTitleBarStyleAtStartup?.())
    .catch(() => 'error')
    .then(titleBarStyle => ({ titleBarStyle: titleBarStyle ?? null, hasCore: Boolean(window.electronTheiaCore) }));
})()`);

const readMenuProbe = () => evaluate(main, `JSON.stringify({
  popups: window.__akariCtxPopup ?? [],
  added: (window.__akariCtxAdded ?? []).filter(entry => /Menu|menu/.test(entry.className) || entry.tag === 'UL')
})`).then(JSON.parse);

/** Theia 側 WebviewWidget.handleContextMenu（= did-context-menu の受け口）の呼び出しを数える。
 *  「メニューが出たか」よりも上流の「ホストがメニューを出そうとしたか」を直接測る。 */
const installWidgetProbe = () => evaluate(main, `(() => {
  window.__akariCtxHost = [];
  try {
    const dictionary = window.theia?.container?._bindingDictionary;
    const keys = dictionary?._map ? [...dictionary._map.keys()] : [];
    const ShellClass = keys.find(key => typeof key === 'function' && key.prototype
      && typeof key.prototype.revealWidget === 'function'
      && typeof key.prototype.addWidget === 'function');
    if (!ShellClass) return { ok: false, error: 'shell class not found' };
    const shell = window.theia.container.get(ShellClass);
    const widgets = [...shell.widgets];
    const webview = widgets.find(widget => typeof widget.handleContextMenu === 'function'
      && typeof widget.setHTML === 'function');
    if (!webview) return { ok: false, error: 'webview widget not found',
      widgets: widgets.map(widget => widget.constructor?.name).slice(0, 40) };
    const proto = Object.getPrototypeOf(webview);
    if (!proto.__akariCtxHooked) {
      proto.__akariCtxHooked = true;
      const original = proto.handleContextMenu;
      proto.handleContextMenu = function (event) {
        const entry = { clientX: event?.clientX, clientY: event?.clientY };
        window.__akariCtxHost.push(entry);
        try {
          return original.apply(this, arguments);
        } catch (error) {
          entry.threw = String(error?.stack ?? error).slice(0, 400);
          throw error;
        }
      };
    }
    return { ok: true, widget: webview.constructor?.name };
  } catch (error) { return { ok: false, error: String(error) }; }
})()`);

const readWidgetProbe = () => evaluate(main, 'JSON.stringify(window.__akariCtxHost ?? [])').then(JSON.parse);

/** ContextMenuRenderer.doRender を instance レベルで包む。
 *  titleBarStyle=native のとき Theia は OS ネイティブメニューを popup するので DOM にもページの
 *  スクリーンショットにも一切残らない（= .lm-Menu 計数では検出できない）。ここで「メニューを
 *  出す要求が来たか / その項目数」を直接記録し、実 popup は抑止する（モーダルで計測が止まるため）。 */
const installRendererProbe = () => evaluate(main, `(() => {
  window.__akariCtxRender = [];
  try {
    const dictionary = window.theia?.container?._bindingDictionary;
    const keys = dictionary?._map ? [...dictionary._map.keys()] : [];
    const ShellClass = keys.find(key => typeof key === 'function' && key.prototype
      && typeof key.prototype.revealWidget === 'function'
      && typeof key.prototype.addWidget === 'function');
    const shell = ShellClass ? window.theia.container.get(ShellClass) : undefined;
    const webview = shell ? [...shell.widgets].find(widget => typeof widget.handleContextMenu === 'function'
      && typeof widget.setHTML === 'function') : undefined;
    let renderer = webview?.contextMenuRenderer;
    if (!renderer) {
      const RendererClass = keys.find(key => typeof key === 'function' && key.prototype
        && typeof key.prototype.render === 'function'
        && typeof key.prototype.setCurrent === 'function');
      renderer = RendererClass ? window.theia.container.get(RendererClass) : undefined;
    }
    if (!renderer || typeof renderer.doRender !== 'function') {
      return { ok: false, error: 'context menu renderer not found',
        webviewKeys: webview ? Object.keys(webview).slice(0, 60) : null };
    }
    if (!renderer.__akariCtxHooked) {
      renderer.__akariCtxHooked = true;
      const original = renderer.doRender.bind(renderer);
      renderer.doRender = params => {
        let items = null;
        try {
          const children = params?.menu?.children;
          items = Array.isArray(children) ? children.length : (children?.length ?? null);
        } catch { /* opaque menu model */ }
        window.__akariCtxRender.push({
          menuPath: Array.isArray(params?.menuPath) ? params.menuPath.join('/') : String(params?.menuPath),
          items,
          anchor: params?.anchor ? { x: params.anchor.x, y: params.anchor.y } : null
        });
        // 実メニュー（ネイティブ popup / Lumino）は出さずに握りつぶす。
        return { onDispose: () => ({ dispose: () => {} }), dispose: () => {} };
      };
    }
    return { ok: true, renderer: renderer.constructor?.name,
      useNativeStyle: renderer.useNativeStyle ?? null };
  } catch (error) { return { ok: false, error: String(error) }; }
})()`);

const readRendererProbe = () => evaluate(main,
  'JSON.stringify(window.__akariCtxRender ?? [])').then(JSON.parse);

const readProbe = () => evaluate(browser,
  'JSON.stringify(window.__akariCtxProbe ?? [])', view.contextId, view.sessionId).then(JSON.parse);

async function stagePointInMainViewport() {
  const inner = await evaluate(browser, `(() => {
    const rect = document.getElementById('preview-stage').getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  })()`, view.contextId, view.sessionId);
  const outer = await evaluate(main, `(() => {
    const frames = [...document.querySelectorAll('iframe')]
      .map(frame => frame.getBoundingClientRect())
      .filter(rect => rect.width > 0 && rect.height > 0)
      .sort((a, b) => b.width * b.height - a.width * a.height);
    const rect = frames[0] ?? { x: 0, y: 0, width: 0, height: 0 };
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  })()`);
  return {
    inner, outer,
    x: Math.round(outer.x + inner.x + inner.width / 2),
    y: Math.round(outer.y + inner.y + inner.height / 2)
  };
}

async function rightClick(x, y, sessionId, offset = { x: 0, y: 0 }) {
  const px = x - offset.x;
  const py = y - offset.y;
  for (const type of ['mousePressed', 'mouseReleased']) {
    await (sessionId ? browser : main).send('Input.dispatchMouseEvent', {
      type, x: px, y: py, button: 'right', clickCount: 1,
      buttons: type === 'mousePressed' ? 2 : 0
    }, sessionId);
    await sleep(60);
  }
}

async function shot(name) {
  const image = await main.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
  const file = path.join(here, `${label}-${name}.png`);
  await writeFile(file, Buffer.from(image.data, 'base64'));
  return path.basename(file);
}

let child;
let status = 'FAILED';
let summary = {};
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
  main.on('Runtime.consoleAPICalled', params => {
    const text = (params.args ?? []).map(arg => {
      if (arg.value !== undefined) return typeof arg.value === 'string' ? arg.value : JSON.stringify(arg.value);
      return arg.preview ? JSON.stringify(arg.preview.properties?.map(p => `${p.name}=${p.value}`)) : arg.description ?? '';
    }).join(' ');
    if (text.includes('akari-preview')) hostLogs.push({ type: params.type, text: sanitize(text) });
  });
  const version = await waitForJson(`http://127.0.0.1:${port}/json/version`, value => value.webSocketDebuggerUrl);
  browser = new CDP(version.webSocketDebuggerUrl);
  await browser.connect();
  await browser.send('Target.setDiscoverTargets', { discover: true }).catch(() => undefined);

  await waitFor('theia ready', 'Boolean(window.theia && window.theia.container)', 180000);
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
  record('preview-attached', { frameEngine });
  await sleep(3000);
  await installProbe();
  await installHostProbe();
  record('menu-probe-installed', await installMenuProbe());
  record('widget-probe-installed', await installWidgetProbe());
  record('renderer-probe-installed', await installRendererProbe());

  const before = await menuCensus();
  const beforeShot = await shot('00-before-right-click');
  record('menu-before-right-click', { ...before, shot: beforeShot });

  const point = await stagePointInMainViewport();
  record('right-click-point', point);
  // 右クリック直後の 2.5 秒を 100ms 刻みでサンプリングする（一瞬だけ出て消えるメニューを取り逃がさない）。
  const menuSamples = [];
  const sampleMenus = async (rounds = 25) => {
    for (let index = 0; index < rounds; index++) {
      menuSamples.push((await menuCensus()).count);
      await sleep(100);
    }
  };
  await rightClick(point.x, point.y);
  await sampleMenus();

  let probe = await readProbe();
  let dispatchedVia = 'main-target';
  if (probe.length === 0) {
    // OOPIF で main target の hit-test が iframe へ入らない場合は webview target へ直接打つ。
    dispatchedVia = 'webview-target';
    await rightClick(point.x, point.y, view.sessionId, { x: point.outer.x, y: point.outer.y });
    await sampleMenus();
    probe = await readProbe();
  }
  record('probe', { dispatchedVia, probe });

  const after = await menuCensus();
  const afterShot = await shot('01-after-right-click');
  record('menu-after-right-click', { ...after, shot: afterShot });
  const hostProbe = await readHostProbe();
  const menuProbe = await readMenuProbe();
  const widgetProbe = await readWidgetProbe();
  const rendererProbe = await readRendererProbe();
  record('renderer-probe', { rendererProbe });
  record('widget-probe', { widgetProbe });
  record('menu-probe', menuProbe);
  record('host-console', { hostLogs, hostProbe });

  check(probe.length >= 1, 'webview 内で contextmenu イベントが実際に発火した', { probe });

  const visibleMenus = after.menus.filter(menu => menu.rect.w > 0 && menu.rect.h > 0);
  summary = {
    label, frameEngine, dispatchedVia,
    menuCountBefore: before.count,
    menuCountAfter: after.count,
    menuCountPeakDuringSampling: Math.max(0, ...menuSamples),
    menuSampleCount: menuSamples.length,
    visibleMenuCountAfter: visibleMenus.length,
    visibleMenus,
    defaultPrevented: probe.map(entry => entry.defaultPrevented),
    hostContextMenuLogs: hostLogs.filter(entry => entry.text.includes('context menu')),
    hostProbe,
    hostHandleContextMenuCalls: widgetProbe,
    contextMenuRenderRequests: rendererProbe,
    nativePopupRequests: menuProbe.popups,
    menuNodesAddedToBody: menuProbe.added,
    shots: [beforeShot, afterShot]
  };
  status = 'PASS';
  record('verdict', { status, ...summary });
} catch (error) {
  record('error', { error: sanitize(String(error?.stack ?? error)) });
  console.error(error);
} finally {
  await writeFile(path.join(here, `run-log-${label}.json`),
    `${sanitize(JSON.stringify({ status, label, frameEngine, summary, records: log }, null, 2))}\n`)
    .catch(() => undefined);
  main?.close();
  browser?.close();
  if (child?.pid) {
    try { process.kill(child.pid, 'SIGTERM'); } catch { /* already exited */ }
    await sleep(1500);
    try { process.kill(child.pid, 'SIGKILL'); } catch { /* already exited */ }
  }
  await sleep(1500);
  await rm(scratch, { recursive: true, force: true });
}
console.log(`L1_STATUS=${status}`);
process.exit(status === 'PASS' ? 0 : 1);
