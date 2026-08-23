#!/usr/bin/env node

// L1: launch the real Electron shell, seek the preview to 2/6/10s, sample pixels, then render the
// same isolated project with render-cut and sample the matching output frames.

import { spawn, spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const fixtureDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(fixtureDir, '..', '..');
const shellDir = path.join(repoRoot, 'apps', 'shell');
const renderCli = path.join(repoRoot, 'packages', 'render-cut', 'bin', 'render-cut.mjs');
const electron = process.platform === 'darwin'
  ? path.join(shellDir, 'node_modules', 'electron', 'dist', 'Electron.app', 'Contents', 'MacOS', 'Electron')
  : process.platform === 'win32'
    ? path.join(shellDir, 'node_modules', 'electron', 'dist', 'electron.exe')
    : path.join(shellDir, 'node_modules', 'electron', 'dist', 'electron');

// macOS の os.tmpdir() は /var/folders/...（実体 /private/var/...）のシンボリックリンク。
// シェルの workspace root は実パスで解決されるため、raw パスのままだと editUri が
// 「ワークスペース外」と判定されプレビューが開かない。realpath で正規化してから使う。
const scratch = await realpath(await mkdtemp(path.join(os.tmpdir(), 'akari-cross-track-overlap-')));
const project = path.join(scratch, 'project');
const profile = path.join(scratch, 'profile');
const config = path.join(scratch, 'config');
const port = Number(process.env.AKARI_CDP_PORT ?? 9337);
const editUri = pathToFileURL(path.join(project, 'edit.json')).href;
const skipPreview = process.env.AKARI_SKIP_PREVIEW === '1';

await Promise.all([...(skipPreview ? [] : [stat(electron)]), stat(renderCli)]);
await cp(fixtureDir, project, { recursive: true, filter: source => !source.endsWith('run-l1.mjs') });
await Promise.all([mkdir(profile), mkdir(config), mkdir(path.join(project, '.akari'))]);
await writeFile(path.join(project, '.akari', 'lint.json'), '{"version":1,"verdict":"pass"}\n');

class CDP {
  constructor(url) {
    this.url = url;
    this.id = 0;
    this.pending = new Map();
    this.listeners = new Map();
  }
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
      // 失効した session への送信は応答が返らないことがある（実測: iframe target への
      // Page.captureScreenshot が無応答で 20 分ハング）。無応答は 30 秒で打ち切る。
      const timer = setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`CDP ${method} timed out (session stale?)`));
        }
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

async function waitForJson(url, predicate, timeoutMs = 60000) {
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

// Theia webview は外側ホスト（webview/index.html）→ 内側 active-frame の二重入れ子。
// 毎回 Target.getTargets から webview の iframe target へ新規 attach し、frame tree の
// 各 frame に isolated world を作って DOM を直接確かめる（イベント収集ベースの探索は
// 実測でフレークした。isolated world でも window.postMessage は main world のリスナーへ
// 届くので seek 駆動にそのまま使える）。
async function findPreviewView(browser, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  const seen = [];
  while (Date.now() < deadline) {
    seen.length = 0;
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
              { frameId: frame.id, worldName: 'akari-l1' }, sessionId);
            const state = await evaluate(browser,
              `JSON.stringify({ hit: Boolean(document.getElementById('preview-layers') && document.getElementById('play-toggle')), body: (document.body?.innerText ?? '').slice(0, 120) })`,
              world.executionContextId, sessionId);
            const parsed = JSON.parse(state);
            if (parsed.hit) return { sessionId, contextId: world.executionContextId };
            seen.push({ url: String(frame.url).slice(0, 60), body: parsed.body });
          } catch { /* frame gone or world rejected */ }
        }
      } catch { /* target changed mid-flight */ }
    }
    await sleep(500);
  }
  throw new Error(`preview webview context not found; frames seen: ${JSON.stringify(seen)}`);
}

async function executeCommand(main, command, argument) {
  return evaluate(main, `(async () => {
    try {
      const dictionary = window.theia?.container?._bindingDictionary;
      const keys = dictionary?._map ? [...dictionary._map.keys()] : [];
      const CommandClass = keys.find(key => typeof key === 'function' && key.prototype
        && typeof key.prototype.executeCommand === 'function' && typeof key.prototype.registerCommand === 'function');
      if (!CommandClass) return { ok: false, error: 'command registry unavailable' };
      const value = await window.theia.container.get(CommandClass)
        .executeCommand(${JSON.stringify(command)}, ${JSON.stringify(argument)});
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

function sample(file, x, y) {
  const result = spawnSync('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-nostdin', '-i', file,
    '-vf', `scale=640:360,crop=2:2:${x}:${y},format=rgb24`,
    '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-',
  ], { encoding: 'buffer' });
  if (result.status !== 0) throw new Error(result.stderr.toString());
  return [...result.stdout.subarray(0, 3)];
}

// 画面撮影はディスプレイの色管理を通るため純色から大きくずれる（実測: 純赤 [255,0,0] が
// [233,51,35]、純緑 [0,255,0] が [117,251,76]）。検証の目的は「どの写真の画素か / 黒露出が
// 無いか」の判別なので、絶対値一致ではなく優勢チャネルで判定する。黒（ステージ背景）は
// どの判定も満たさないため、黒落ちはこのまま検出できる。
function isRed(pixel) {
  return pixel[0] >= 150 && pixel[0] - Math.max(pixel[1], pixel[2]) >= 60;
}
function isGreen(pixel) {
  return pixel[1] >= 150 && pixel[1] - Math.max(pixel[0], pixel[2]) >= 60;
}

// iframe target への Page.captureScreenshot は無応答になり得る（実測ハング）。
// ステージ矩形（内側 webview 座標）+ Theia webview iframe の位置（メイン DOM 座標）を
// 合成した clip で、メインの page target からウィンドウ全体撮影する。
async function capturePreview(mainCdp, browserCdp, view, name) {
  const inner = await evaluate(browserCdp, `(() => {
    const stage = document.getElementById('preview-layers').getBoundingClientRect();
    return { x: stage.x, y: stage.y, width: stage.width, height: stage.height };
  })()`, view.contextId, view.sessionId);
  const outer = await evaluate(mainCdp, `(() => {
    const frame = document.querySelector('iframe');
    const rect = frame ? frame.getBoundingClientRect() : { x: 0, y: 0 };
    return { x: rect.x, y: rect.y };
  })()`);
  const clip = {
    x: outer.x + inner.x, y: outer.y + inner.y,
    width: inner.width, height: inner.height, scale: 1,
  };
  const shot = await mainCdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true, clip });
  const file = path.join(scratch, `${name}.png`);
  await writeFile(file, Buffer.from(shot.data, 'base64'));
  return file;
}

function sampleRenderedFrame(file, seconds, x, y) {
  const frame = Math.round(seconds * 30);
  const result = spawnSync('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-nostdin', '-i', file,
    '-vf', `select=eq(n\\,${frame}),crop=2:2:${x}:${y},format=rgb24`,
    '-vsync', '0', '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-',
  ], { encoding: 'buffer' });
  if (result.status !== 0) throw new Error(result.stderr.toString());
  return [...result.stdout.subarray(0, 3)];
}

let child;
let main;
let browser;
const result = { preview: {}, render: {} };
if (!skipPreview) try {
  child = spawn(electron, [shellDir, project, `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`, '--no-sandbox'], {
    cwd: shellDir, env: { ...process.env, THEIA_CONFIG_DIR: config }, stdio: 'ignore',
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
  await browser.send('Target.setDiscoverTargets', { discover: true }).catch(() => undefined);

  // フロントエンド起動直後（workspace root が settle する前）に ensureVisible を打つと、
  // プレビューが「ワークスペース外」のエラーカードで開いてそのまま固まる（実測）。
  // 初期化を待ってから開き、ステージ DOM が見つからなければ ensureVisible からやり直す。
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

  // webview は edit 読み込みで target ごと再生成されることがあり、find 済みの
  // session/context が失効する（実測: Session with given id not found）。
  // seek ごとに live な view を取り直し、失効エラーだけリトライする。
  for (const seconds of [2, 6, 10]) {
    let done = false;
    let lastError;
    for (let attempt = 0; attempt < 5 && !done; attempt += 1) {
      try {
        await activatePreview(main);
        view = await findPreviewView(browser, 15000);
        await evaluate(browser, `(() => { window.postMessage({type:'akari-preview-seek',time:${seconds}}, '*'); return true; })()`,
          view.contextId, view.sessionId);
        await sleep(1000);
        const frame = await capturePreview(main, browser, view, `preview-${seconds}`);
        result.preview[seconds] = { center: sample(frame, 320, 180), outside: sample(frame, 40, 40) };
        done = true;
      } catch (error) {
        lastError = error;
        if (!/Session with given id|Cannot find context|context.*destroyed|Target closed/i.test(String(error?.message))) throw error;
        await sleep(1000);
      }
    }
    if (!done) throw lastError ?? new Error(`seek ${seconds}s never sampled`);
  }

  if (!isRed(result.preview[2].center) || !isRed(result.preview[2].outside)
    || !isGreen(result.preview[6].center) || !isRed(result.preview[6].outside)
    || !isRed(result.preview[10].center) || !isRed(result.preview[10].outside)) {
    throw new Error(`preview pixel assertion failed: ${JSON.stringify(result.preview)}`);
  }
} catch (error) {
  await rm(scratch, { recursive: true, force: true });
  throw error;
} finally {
  main?.close();
  browser?.close();
  if (child?.pid) {
    try { process.kill(child.pid, 'SIGTERM'); } catch { /* exited */ }
    await sleep(1000);
    try { process.kill(child.pid, 'SIGKILL'); } catch { /* exited */ }
  }
}

const render = spawnSync(process.execPath, [renderCli, project], { encoding: 'utf8' });
if (render.status !== 0) throw new Error(`render-cut failed:\n${render.stdout}\n${render.stderr}`);
const receipt = JSON.parse(await readFile(path.join(project, '.akari', 'render.json'), 'utf8'));
const output = path.join(project, receipt.artifacts[0].path);
for (const seconds of [2, 6, 10]) {
  result.render[seconds] = {
    center: sampleRenderedFrame(output, seconds, 320, 180),
    outside: sampleRenderedFrame(output, seconds, 40, 40),
  };
}
if (!isRed(result.render[2].center) || !isRed(result.render[2].outside)
  || !isGreen(result.render[6].center) || !isRed(result.render[6].outside)
  || !isRed(result.render[10].center) || !isRed(result.render[10].outside)) {
  throw new Error(`render pixel assertion failed: ${JSON.stringify(result.render)}`);
}

console.log(JSON.stringify({ verdict: skipPreview ? 'RENDER_PASS' : 'PASS', ...result }, null, 2));
await rm(scratch, { recursive: true, force: true });
