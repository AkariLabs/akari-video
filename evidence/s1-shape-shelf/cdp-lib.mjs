// L1（検証専用）の共通部品: 隔離プロジェクトで本物の Electron シェルを起動し、CDP で操作する。
// evidence/s0-shape-contract/run-l1.mjs の CDP まわりを切り出したもの。

import { spawn, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

export { sleep };

export class CDP {
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

export async function evaluate(cdp, expression, contextId, sessionId) {
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

/** 自分の slug を含む一時ディレクトリ。終わったら dispose() で消す。 */
export async function makeScratch(prefix) {
  const scratch = await realpath(await mkdtemp(path.join(os.tmpdir(), prefix)));
  const dirs = {
    scratch,
    project: path.join(scratch, 'project'),
    profile: path.join(scratch, 'profile'),
    config: path.join(scratch, 'config'),
    akariHome: path.join(scratch, 'akari-home'),
  };
  await Promise.all([mkdir(dirs.profile), mkdir(dirs.config), mkdir(dirs.akariHome, { recursive: true }),
    mkdir(path.join(dirs.project, '.akari'), { recursive: true })]);
  return { ...dirs, dispose: () => rm(scratch, { recursive: true, force: true }) };
}

export async function setTheme(configDir, theme) {
  await writeFile(path.join(configDir, 'settings.json'), `${JSON.stringify({ 'workbench.colorTheme': theme }, null, 2)}\n`);
}

/** Electron を自分のプロセスグループで起動し、主窓に CDP でつなぐ。 */
export async function launchShell({ shellDir, dirs, port, width = 1680, height = 940 }) {
  const electron = path.join(shellDir, 'node_modules', 'electron', 'dist', 'Electron.app', 'Contents', 'MacOS', 'Electron');
  const child = spawn(electron, [shellDir, dirs.project, `--remote-debugging-port=${port}`,
    `--user-data-dir=${dirs.profile}`, '--no-sandbox'], {
    cwd: shellDir,
    env: { ...process.env, THEIA_CONFIG_DIR: dirs.config, AKARI_HOME: dirs.akariHome },
    stdio: 'ignore',
    detached: true,
  });
  const isShellPage = value => value.type === 'page' && value.url && !value.url.startsWith('devtools:');
  const targets = await waitForJson(`http://127.0.0.1:${port}/json/list`, values => values.find(isShellPage));
  const target = targets.find(isShellPage);
  const main = new CDP(target.webSocketDebuggerUrl);
  await main.connect();
  const consoleErrors = [];
  main.on('Runtime.consoleAPICalled', params => {
    if (params.type !== 'error') return;
    consoleErrors.push(params.args.map(arg => arg.value ?? arg.description ?? arg.type).join(' ').slice(0, 600));
  });
  main.on('Runtime.exceptionThrown', params => {
    consoleErrors.push(String(params.exceptionDetails?.exception?.description ?? params.exceptionDetails?.text ?? '').slice(0, 600));
  });
  await main.send('Runtime.enable');
  await main.send('Page.enable');
  const version = await waitForJson(`http://127.0.0.1:${port}/json/version`, value => value.webSocketDebuggerUrl);
  const browser = new CDP(version.webSocketDebuggerUrl);
  await browser.connect();
  // Electron の CDP には Browser.setWindowBounds が無いので、画面の寸法は Emulation で固定する（画面より大きい窓は作れない）。
  await main.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile: false }).catch(() => undefined);
  const stop = async () => {
    main.close();
    browser.close();
    if (child.pid) {
      try { process.kill(-child.pid, 'SIGTERM'); } catch { /* exited */ }
      await sleep(1500);
      try { process.kill(-child.pid, 'SIGKILL'); } catch { /* exited */ }
    }
    // プロセスグループから外れた Electron の補助プロセスも、この起動専用のプロファイル名で拾って止める（自分の起動分だけ）。
    const pids = args => spawnSync('pgrep', args, { encoding: 'utf8' }).stdout.split('\n').map(Number).filter(Boolean);
    const stray = pids(['-f', `user-data-dir=${dirs.profile}`]);
    for (const pid of [...stray.flatMap(parent => pids(['-P', String(parent)])), ...stray]) {
      try { process.kill(pid, 'SIGKILL'); } catch { /* exited */ }
    }
  };
  return { child, main, browser, consoleErrors, stop };
}

export async function executeCommand(main, command, ...args) {
  return evaluate(main, `(async () => {
    try {
      const dictionary = window.theia?.container?._bindingDictionary;
      const keys = dictionary?._map ? [...dictionary._map.keys()] : [];
      const CommandClass = keys.find(key => typeof key === 'function' && key.prototype
        && typeof key.prototype.executeCommand === 'function' && typeof key.prototype.registerCommand === 'function');
      if (!CommandClass) return { ok: false, error: 'command registry unavailable' };
      const value = await window.theia.container.get(CommandClass)
        .executeCommand(${JSON.stringify(command)}, ...${JSON.stringify(args)});
      if (value === undefined) return { ok: true, value: null };
      try { return { ok: true, value: JSON.parse(JSON.stringify(value)) }; }
      catch { return { ok: true, value: '[' + (value?.constructor?.name ?? typeof value) + ']' }; }
    } catch (error) { return { ok: false, error: error?.message ?? String(error) }; }
  })()`);
}

export async function screenshot(main, file, clip) {
  const shot = await main.send('Page.captureScreenshot', {
    format: 'png', fromSurface: true, ...(clip ? { clip: { ...clip, scale: 1 } } : {}),
  });
  await writeFile(file, Buffer.from(shot.data, 'base64'));
  return path.basename(file);
}

export async function rectOf(main, selector) {
  return evaluate(main, `(() => {
    const node = document.querySelector(${JSON.stringify(selector)});
    if (!node) return null;
    const r = node.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  })()`);
}

export async function waitFor(main, expression, timeoutMs = 30000, interval = 300) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { const value = await evaluate(main, expression); if (value) return value; } catch { /* retry */ }
    await sleep(interval);
  }
  return undefined;
}

/** マウスの実イベントでクリック（React のハンドラを本物の経路で通す）。 */
export async function clickAt(main, x, y) {
  await main.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  await main.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await main.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
}

export async function clickSelector(main, selector) {
  await evaluate(main, `document.querySelector(${JSON.stringify(selector)})?.scrollIntoView({ block: 'center', inline: 'nearest' })`);
  await sleep(200);
  const rect = await rectOf(main, selector);
  if (!rect) throw new Error(`not found: ${selector}`);
  await clickAt(main, rect.x + rect.width / 2, rect.y + rect.height / 2);
  return rect;
}

export async function hover(main, x, y) {
  await main.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
}

// 証跡にローカルの絶対パスを残さない。
export const scrub = line => String(line).replace(/file:\/\/\/[^\s)"']+/g, '<file>')
  .replace(/\/(?:private|tmp|Users|var)\/[^\s):"']+/g, '<path>');

/** 出力プレビューの webview（別ターゲット）に CDP でつなぐ。S-0 の run-l1.mjs と同じ探し方。 */
export async function findPreviewView(browser, timeoutMs = 20000) {
  const contexts = new Map();
  if (!browser.__trackingContexts) {
    browser.__trackingContexts = contexts;
    browser.on('Runtime.executionContextCreated', (params, sessionId) => {
      if (!params?.context?.auxData?.isDefault) return;
      const list = browser.__trackingContexts.get(sessionId) ?? [];
      list.push(params.context.id);
      browser.__trackingContexts.set(sessionId, list);
    });
    await browser.send('Target.setDiscoverTargets', { discover: true }).catch(() => undefined);
  }
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const all = await browser.send('Target.getTargets').catch(() => undefined);
    for (const info of all?.targetInfos ?? []) {
      if (!['iframe', 'page', 'webview'].includes(info.type)) continue;
      if (!String(info.url ?? '').includes('webview')) continue;
      try {
        const { sessionId } = await browser.send('Target.attachToTarget', { targetId: info.targetId, flatten: true });
        browser.__trackingContexts.delete(sessionId);
        await browser.send('Runtime.enable', {}, sessionId).catch(() => undefined);
        await sleep(300);
        for (const contextId of browser.__trackingContexts.get(sessionId) ?? []) {
          try {
            const hit = await evaluate(browser,
              `Boolean(document.getElementById('preview-layers') && document.getElementById('play-toggle'))`, contextId, sessionId);
            if (hit) return { sessionId, contextId };
          } catch { /* context gone */ }
        }
      } catch { /* target changed */ }
    }
    await sleep(500);
  }
  return undefined;
}
