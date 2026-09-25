// L1 共通部品（fx1-timeline-canvas-rows。c0b-canvas-ui の l1-lib の複製 + AKARI_L1_REPO で起動するチェックアウトを差し替え）: 隔離 Electron の起動・CDP・出力プレビュー webview への到達・
// タイムラインの DOM 読み取り。判定はしない（各ドライバが観測値を JSON に残す）。
import { spawn, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

export { sleep };

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
export const evidenceRoot = path.resolve(scriptDir, '..');
export const repoRoot = process.env.AKARI_L1_REPO ? path.resolve(process.env.AKARI_L1_REPO) : path.resolve(evidenceRoot, "..", "..");
export const shellDir = path.join(repoRoot, 'apps', 'shell');
const electron = path.join(shellDir, 'node_modules', 'electron', 'dist', 'Electron.app', 'Contents', 'MacOS', 'Electron');
const ffmpeg = process.env.AKARI_FFMPEG ?? 'ffmpeg';

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
        reject: error => { clearTimeout(timer); reject(error); }
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
    ...(contextId === undefined ? {} : { contextId })
  }, sessionId);
  if (response.exceptionDetails) throw new Error(JSON.stringify(response.exceptionDetails).slice(0, 800));
  return response.result.value;
}

async function waitForJson(url, predicate, timeoutMs = 60000) {
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

/** 隔離プロジェクトを作る。files = { 相対パス: 文字列 }。clip.mp4 を ffmpeg で生成する。 */
export async function makeProject(slug, edit, files = {}, { clipSeconds = 30 } = {}) {
  const scratch = await realpath(await mkdtemp(path.join(os.tmpdir(), `${slug}-`)));
  const project = path.join(scratch, 'project');
  const dirs = { scratch, project, profile: path.join(scratch, 'profile'), config: path.join(scratch, 'config'),
    akariHome: path.join(scratch, 'akari-home') };
  await mkdir(project, { recursive: true });
  await Promise.all([mkdir(dirs.profile), mkdir(dirs.config), mkdir(dirs.akariHome), mkdir(path.join(project, '.akari'))]);
  await writeFile(path.join(project, '.akari', 'lint.json'), '{"version":1,"verdict":"pass"}\n');
  const made = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
    '-f', 'lavfi', '-i', `testsrc2=size=640x360:rate=30:duration=${clipSeconds}`,
    '-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-preset', 'ultrafast', path.join(project, 'clip.mp4')], { encoding: 'utf8' });
  if (made.status !== 0) throw new Error(`ffmpeg failed: ${made.stderr}`);
  for (const [rel, text] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(project, rel)), { recursive: true });
    await writeFile(path.join(project, rel), text);
  }
  const editPath = path.join(project, 'edit.json');
  await writeFile(editPath, `${JSON.stringify(edit, null, 2)}\n`);
  return { ...dirs, editPath, editUri: pathToFileURL(editPath).href };
}

export function sanitizer(dirs) {
  return text => text
    .split(repoRoot).join('<REPO>')
    .split(dirs.scratch).join('<TMP>')
    .split(os.homedir()).join('<HOME>');
}

export class Session {
  constructor(dirs, port) { this.dirs = dirs; this.port = port; this.contextsBySession = new Map(); this.offset = { x: 0, y: 0 }; }

  async start() {
    this.child = spawn(electron, [shellDir, this.dirs.project, `--remote-debugging-port=${this.port}`,
      `--user-data-dir=${this.dirs.profile}`, '--no-sandbox'], {
      cwd: shellDir,
      env: { ...process.env, THEIA_CONFIG_DIR: this.dirs.config, AKARI_HOME: this.dirs.akariHome },
      stdio: 'ignore'
    });
    const targets = await waitForJson(`http://127.0.0.1:${this.port}/json/list`,
      values => values.find(value => value.type === 'page' && !value.url.startsWith('devtools:')), 120000);
    const target = targets.find(value => value.type === 'page' && !value.url.startsWith('devtools:'));
    this.main = new CDP(target.webSocketDebuggerUrl);
    await this.main.connect();
    await this.main.send('Runtime.enable');
    await this.main.send('Page.enable');
    await this.main.send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
    const version = await waitForJson(`http://127.0.0.1:${this.port}/json/version`, value => value.webSocketDebuggerUrl);
    this.browser = new CDP(version.webSocketDebuggerUrl);
    await this.browser.connect();
    await this.browser.send('Target.setDiscoverTargets', { discover: true }).catch(() => undefined);
    this.browser.on('Runtime.executionContextCreated', (params, sessionId) => {
      const list = this.contextsBySession.get(sessionId) ?? [];
      list.push({ id: params.context.id, auxData: params.context.auxData ?? {} });
      this.contextsBySession.set(sessionId, list);
    });
    this.browser.on('Runtime.executionContextsCleared', (_p, sessionId) => this.contextsBySession.set(sessionId, []));
    this.browser.on('Runtime.executionContextDestroyed', (params, sessionId) => {
      this.contextsBySession.set(sessionId,
        (this.contextsBySession.get(sessionId) ?? []).filter(entry => entry.id !== params.executionContextId));
    });
    await sleep(12000);
  }

  async stop() {
    try { this.main?.close(); this.browser?.close(); } catch { /* noop */ }
    if (this.child?.pid) { try { process.kill(this.child.pid, 'SIGKILL'); } catch { /* gone */ } }
    await sleep(1500);
    const left = spawnSync('ps', ['-axo', 'pid=,command='], { encoding: 'utf8' }).stdout
      .split('\n').filter(line => line.includes(this.dirs.profile));
    for (const line of left) {
      const pid = Number(line.trim().split(/\s+/)[0]);
      if (pid) { try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ } }
    }
    await sleep(500);
    // 返り値 = 片付けた後もプロファイルを握って残っているプロセス数（0 であること）
    return spawnSync('ps', ['-axo', 'pid=,command='], { encoding: 'utf8' }).stdout
      .split('\n').filter(line => line.includes(this.dirs.profile)).length;
  }

  ev(expression) { return evaluate(this.main, expression); }

  async command(command, argument) {
    return this.ev(`(async () => {
      try {
        const dictionary = window.theia?.container?._bindingDictionary;
        const keys = dictionary?._map ? [...dictionary._map.keys()] : [];
        const CommandClass = keys.find(key => typeof key === 'function' && key.prototype
          && typeof key.prototype.executeCommand === 'function' && typeof key.prototype.registerCommand === 'function');
        if (!CommandClass) return { ok: false, error: 'command registry unavailable' };
        const value = await window.theia.container.get(CommandClass)
          .executeCommand(${JSON.stringify(command)}, ${JSON.stringify(argument)});
        return { ok: true, value: value === undefined ? null : JSON.parse(JSON.stringify(value ?? null)) };
      } catch (error) { return { ok: false, error: error?.message ?? String(error) }; }
    })()`);
  }

  async findPreviewView(timeoutMs = 30000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const all = await this.browser.send('Target.getTargets').catch(() => undefined);
      for (const info of all?.targetInfos ?? []) {
        if (!['iframe', 'page', 'webview'].includes(info.type)) continue;
        if (!String(info.url ?? '').includes('webview')) continue;
        try {
          const { sessionId } = await this.browser.send('Target.attachToTarget', { targetId: info.targetId, flatten: true });
          this.contextsBySession.set(sessionId, []);
          await this.browser.send('Runtime.enable', {}, sessionId).catch(() => undefined);
          await sleep(400);
          for (const context of this.contextsBySession.get(sessionId) ?? []) {
            if (context.auxData.isDefault === false) continue;
            try {
              const hit = await evaluate(this.browser,
                `Boolean(document.getElementById('preview-stage') && window.akari && window.akari.computeOutputFrameRect)`,
                context.id, sessionId);
              if (hit) return { sessionId, contextId: context.id };
            } catch { /* gone */ }
          }
        } catch { /* changed */ }
      }
      await sleep(500);
    }
    throw new Error('preview webview main-world context not found');
  }

  async activatePreview() {
    return this.ev(`(() => {
      const label = [...document.querySelectorAll('[class*="TabBar-tabLabel"]')]
        .find(node => node.textContent?.trim() === '出力プレビュー');
      if (!label) return false;
      label.click();
      return true;
    })()`);
  }

  async openPreviewAndTimeline() {
    const deadline = Date.now() + 180000;
    while (!this.view && Date.now() < deadline) {
      await this.ev(`(() => { const b=[...document.querySelectorAll('button')]
        .find(x=>x.textContent?.trim()==='開くだけ'); if(b)b.click(); return true; })()`);
      const opened = await this.command('akari.preview.ensureVisible', { editUri: this.dirs.editUri });
      if (!opened.ok) { await sleep(2000); continue; }
      await sleep(3000);
      await this.activatePreview();
      this.view = await this.findPreviewView(20000).catch(() => undefined);
    }
    if (!this.view) throw new Error('preview did not activate');
    const timeline = await this.command('akari.annotations.open', undefined);
    await sleep(4000);
    await this.activatePreview();
    this.view = await this.findPreviewView();
    return timeline;
  }

  async refreshView() { this.view = await this.findPreviewView(); }

  async pv(expression) {
    // タブの切り替えで webview の実行コンテキストが作り直されることがあるので、1 回だけ掴み直す。
    try {
      return await evaluate(this.browser, expression, this.view.contextId, this.view.sessionId);
    } catch (error) {
      if (!/Cannot find context|No target with given id|Session with given id not found/.test(String(error?.message ?? error))) throw error;
      await this.activatePreview();
      await sleep(800);
      this.view = await this.findPreviewView();
      return evaluate(this.browser, expression, this.view.contextId, this.view.sessionId);
    }
  }

  async seek(seconds) {
    await this.pv(`(() => { window.postMessage({type:'akari-preview-seek',time:${seconds}}, '*'); return true; })()`);
    await sleep(1500);
  }

  async previewTree() {
    return this.pv(`JSON.parse(JSON.stringify((window.akari.state && window.akari.state.summary && window.akari.state.summary.tree) || []))`);
  }

  async screenshot(file, clip) {
    const shot = await this.main.send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip: { ...clip, scale: 1 } } : {}) });
    await writeFile(file, Buffer.from(shot.data, 'base64'));
    return path.basename(file);
  }

  async previewRect() {
    const outer = await this.ev(`(() => {
      const frames = [...document.querySelectorAll('iframe')].filter(f => f.getBoundingClientRect().width > 50);
      const f = frames[0];
      if (!f) return null;
      const r = f.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    })()`);
    return outer;
  }

  async timelineRect() {
    return this.ev(`(() => {
      const w = document.getElementById('akari-annotations-widget');
      if (!w) return null;
      const r = w.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    })()`);
  }

  async mouse(type, x, y, extra = {}) {
    await this.main.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1, ...extra });
  }

  async drag(from, to, { steps = 12, button = 'left' } = {}) {
    await this.main.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x, y: from.y, button: 'none' });
    await sleep(40);
    await this.main.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: from.x, y: from.y, button, buttons: 1, clickCount: 1 });
    await sleep(60);
    for (let s = 1; s <= steps; s++) {
      const x = from.x + (to.x - from.x) * (s / steps);
      const y = from.y + (to.y - from.y) * (s / steps);
      await this.main.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button, buttons: 1 });
      await sleep(25);
    }
    await sleep(80);
    await this.main.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: to.x, y: to.y, button, buttons: 0, clickCount: 1 });
    await sleep(900);
  }

  async click(x, y, { button = 'left', modifiers = 0 } = {}) {
    await this.main.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', modifiers });
    await sleep(30);
    await this.main.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button, buttons: button === 'right' ? 2 : 1, clickCount: 1, modifiers });
    await sleep(40);
    await this.main.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button, buttons: 0, clickCount: 1, modifiers });
    await sleep(600);
  }

  async key(key, code, vk, modifiers = 0) {
    await this.main.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key, code, windowsVirtualKeyCode: vk, modifiers });
    await sleep(30);
    await this.main.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk, modifiers });
    await sleep(700);
  }

  /** タイムラインの DOM: 左の木の行と帯のチップ。 */
  async timelineState() {
    return this.ev(`(() => {
      const w = document.getElementById('akari-annotations-widget');
      if (!w) return null;
      const rect = el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; };
      const rows = [...w.querySelectorAll('[data-akari-tree-row-id]')]
        .filter(el => el.closest('[data-akari-tree-track]'))
        .map(el => ({ id: el.dataset.akariTreeRowId, text: el.textContent.trim().slice(0, 80), rect: rect(el) }));
      const chips = [...w.querySelectorAll('.akari-timeline-tree-item[data-akari-item-id]')]
        .map(el => ({ id: el.dataset.akariItemId, kind: el.dataset.akariTreeItemKind, text: el.textContent.trim().slice(0, 80),
          className: el.className, rect: rect(el) }));
      return { rows, chips, text: w.textContent.slice(0, 2000) };
    })()`);
  }

  async readEdit() { return JSON.parse(await readFile(this.dirs.editPath, 'utf8')); }

  async cleanup() { if (existsSync(this.dirs.scratch)) await rm(this.dirs.scratch, { recursive: true, force: true }); }
}

export function findItem(doc, id) {
  const walk = (items, parentAbs, parentId) => {
    for (const item of items ?? []) {
      const abs = parentAbs + item.at;
      if (item.id === id) return { item, absAt: abs, parentId };
      const hit = walk(item.items, abs, item.id);
      if (hit) return hit;
    }
    return undefined;
  };
  for (const track of doc.tracks ?? []) {
    const hit = walk(track.items, 0, null);
    if (hit) return { ...hit, trackId: track.id };
  }
  return undefined;
}
