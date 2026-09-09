#!/usr/bin/env node

// L1: 重なった上のトラックのクリップを出力プレビューで選べるか（task 2026-09-09-preview-overlap-clip-select）。
//
// 実 Electron シェルを 1 本だけ起動し、CDP の Input で「本物のマウス」を出力プレビューへ落として
//   (a) プレビューをクリック → 最前面（退避 layer）が選ばれ選択枠が出る
//   (b) タイムラインでクリップを選ぶ → プレビューに選択枠が出る
//   (d) 3 本重ね（V1/V2/V3）でも最前面が選ばれる
//   (c) 選択したクリップを右へドラッグ → edit.json の当該 item だけ動く
// を観測する。判定はせず観測値を JSON で吐く（BEFORE / AFTER の両方で同じ script を走らせて比べる）。
//
// 使い方: AKARI_L1_LABEL=after AKARI_L1_OUT=<dir> node dev-fixtures/preview-overlap-clip-select/run-l1.mjs
// 起動した Electron は finally で必ず kill する（孤児プロセス事故の再発防止）。

import { spawn, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const fixtureDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(fixtureDir, '..', '..');
const shellDir = path.join(repoRoot, 'apps', 'shell');
const label = process.env.AKARI_L1_LABEL ?? 'run';
const outDir = process.env.AKARI_L1_OUT ?? path.join(repoRoot, 'evidence', '2026-09-09-preview-overlap-clip-select');
const port = Number(process.env.AKARI_CDP_PORT ?? 9351);
const electron = path.join(shellDir, 'node_modules', 'electron', 'dist', 'Electron.app', 'Contents', 'MacOS', 'Electron');
const ffmpeg = process.env.AKARI_FFMPEG ?? 'ffmpeg';

const scratch = await realpath(await mkdtemp(path.join(os.tmpdir(), 'akari-overlap-select-')));
const project = path.join(scratch, 'project');
const profile = path.join(scratch, 'profile');
const config = path.join(scratch, 'config');
const akariHome = path.join(scratch, 'akari-home');
const editPath = path.join(project, 'edit.json');
const editUri = pathToFileURL(editPath).href;

await stat(electron);
await mkdir(project, { recursive: true });
await Promise.all([mkdir(profile), mkdir(config), mkdir(akariHome), mkdir(path.join(project, '.akari'))]);
await writeFile(path.join(project, '.akari', 'lint.json'), '{"version":1,"verdict":"pass"}\n');

// 素材は 1 本だけ作り、V1 / V2 / V3 で同じ動画を重ねる（オーナー報告と同じ形）。
const clip = path.join(project, 'clip.mp4');
{
  const made = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
    '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30:duration=9',
    '-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-preset', 'ultrafast', clip], { encoding: 'utf8' });
  if (made.status !== 0) throw new Error(`ffmpeg failed: ${made.stderr}`);
}

// V1 = 全画面（cuts のまま）、V2 = 0.6 倍（cross-track 退避 → layers）、V3 = 0.35 倍（4s 以降だけ重なる）。
const edit = {
  version: 2,
  output: { width: 640, height: 360, fps: 30 },
  sources: [{ id: 'clip', path: 'clip.mp4', proxy: null }],
  tracks: [
    { id: 'v1', lane: 'visual', name: 'V1 base', items: [{
      id: 'base-item', at: 0, duration: 240,
      transform: { x: 0, y: 0, scale: 1, rotate: 0 },
      source: { kind: 'media', src: 'clip', in: 0, out: 8 } }] },
    { id: 'v2', lane: 'visual', name: 'V2 mid', items: [{
      id: 'mid-item', at: 0, duration: 240,
      transform: { x: 0, y: 0, scale: 0.6, rotate: 0 },
      source: { kind: 'media', src: 'clip', in: 0, out: 8 } }] },
    { id: 'v3', lane: 'visual', name: 'V3 top', items: [{
      id: 'top-item', at: 120, duration: 120,
      transform: { x: 0, y: 0, scale: 0.35, rotate: 0 },
      source: { kind: 'media', src: 'clip', in: 4, out: 8 } }] }
  ]
};
await writeFile(editPath, `${JSON.stringify(edit, null, 2)}\n`);

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
  on(method, listener) {
    this.listeners.set(method, [...(this.listeners.get(method) ?? []), listener]);
  }
  close() { this.socket?.close(); }
}

async function evaluate(cdp, expression, contextId, sessionId) {
  const response = await cdp.send('Runtime.evaluate', {
    expression, returnByValue: true, awaitPromise: true,
    ...(contextId === undefined ? {} : { contextId })
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

// webview は外側ホスト → 内側 active-frame の二重入れ子。isolated world は DOM を共有するが
// JS グローバル（window.akari）は共有しないので、**メインワールドの実行コンテキスト**を掴む。
// Runtime.enable は既存コンテキストも executionContextCreated として流し直すので、それを収集する。
const contextsBySession = new Map();
const webviewExceptions = [];
function trackContexts(browser) {
  browser.on('Runtime.exceptionThrown', params => {
    const details = params.exceptionDetails ?? {};
    webviewExceptions.push(String(details.exception?.description ?? details.text ?? '').slice(0, 400));
  });
  browser.on('Runtime.executionContextCreated', (params, sessionId) => {
    const list = contextsBySession.get(sessionId) ?? [];
    list.push({ id: params.context.id, auxData: params.context.auxData ?? {} });
    contextsBySession.set(sessionId, list);
  });
  browser.on('Runtime.executionContextsCleared', (_params, sessionId) => contextsBySession.set(sessionId, []));
  browser.on('Runtime.executionContextDestroyed', (params, sessionId) => {
    contextsBySession.set(sessionId,
      (contextsBySession.get(sessionId) ?? []).filter(entry => entry.id !== params.executionContextId));
  });
}

async function findPreviewView(browser, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const all = await browser.send('Target.getTargets').catch(() => undefined);
    for (const info of all?.targetInfos ?? []) {
      if (!['iframe', 'page', 'webview'].includes(info.type)) continue;
      if (!String(info.url ?? '').includes('webview')) continue;
      try {
        const { sessionId } = await browser.send('Target.attachToTarget', { targetId: info.targetId, flatten: true });
        contextsBySession.set(sessionId, []);
        await browser.send('Runtime.enable', {}, sessionId).catch(() => undefined);
        await sleep(400);
        for (const context of contextsBySession.get(sessionId) ?? []) {
          if (context.auxData.isDefault === false) continue;
          try {
            const hit = await evaluate(browser,
              `Boolean(document.getElementById('preview-layers') && document.getElementById('layer-select-box')
                && window.akari && window.akari.computeOutputFrameRect)`,
              context.id, sessionId);
            if (hit) return { sessionId, contextId: context.id };
          } catch { /* context gone */ }
        }
      } catch { /* target changed mid-flight */ }
    }
    await sleep(500);
  }
  throw new Error('preview webview main-world context not found');
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

let child;
let main;
let browser;
let view;
const observations = { label, steps: {} };

// webview の内側座標 → メインウィンドウ座標。実測の probe で補正する（入れ子 iframe のオフセットを仮定しない）。
let offset = { x: 0, y: 0 };

async function refreshView() {
  view = await findPreviewView(browser, 20000);
  await evaluate(browser, `(() => {
    if (!window.__akariL1Probe) {
      window.__akariL1Probe = { x: null, y: null };
      window.addEventListener('pointermove', event => {
        window.__akariL1Probe = { x: event.clientX, y: event.clientY };
      }, true);
    }
    return true;
  })()`, view.contextId, view.sessionId);
}

async function stageGeometry() {
  return evaluate(browser, `(() => {
    const stage = document.getElementById('preview-stage');
    const rect = stage.getBoundingClientRect();
    return { left: rect.left, top: rect.top, width: rect.width, height: rect.height,
      layoutWidth: stage.clientWidth, layoutHeight: stage.clientHeight,
      scale: window.akari.stageScale() || 1 };
  })()`, view.contextId, view.sessionId);
}

// 出力 px（stageLocalPoint の座標系）→ webview のクライアント座標
function innerPointFor(stage, ox, oy) {
  const scaleX = stage.width / (stage.layoutWidth || 1);
  const scaleY = stage.height / (stage.layoutHeight || 1);
  return { x: stage.left + ox * scaleX, y: stage.top + oy * scaleY };
}

async function outerIframeOffset() {
  return evaluate(main, `(() => {
    const frame = document.querySelector('iframe');
    const rect = frame ? frame.getBoundingClientRect() : { x: 0, y: 0 };
    return { x: rect.x, y: rect.y };
  })()`);
}

async function mouse(type, x, y, extra = {}) {
  await main.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1, ...extra });
}

// webview 内座標 (ix, iy) をメイン座標へ写す。probe で一度だけ実測補正する。
async function calibrate(ix, iy) {
  const outer = await outerIframeOffset();
  let guess = { x: outer.x + ix, y: outer.y + iy };
  await mouse('mouseMoved', guess.x, guess.y);
  await sleep(200);
  const probe = await evaluate(browser, `JSON.stringify(window.__akariL1Probe)`, view.contextId, view.sessionId);
  const seen = JSON.parse(probe);
  if (seen && Number.isFinite(seen.x)) {
    offset = { x: guess.x - seen.x, y: guess.y - seen.y };
  } else {
    offset = { x: outer.x, y: outer.y };
  }
  return { outer, seen, offset };
}

const toMain = (ix, iy) => ({ x: offset.x + ix, y: offset.y + iy });

async function previewState() {
  const raw = await evaluate(browser, `JSON.stringify((() => {
    const box = document.getElementById('layer-select-box');
    const cut = document.getElementById('cut-select-box');
    const rect = box.getBoundingClientRect();
    const cutRect = cut ? cut.getBoundingClientRect() : null;
    const media = [...document.querySelectorAll('[data-akari-layer-id]')].map(node => ({
      id: node.dataset.akariLayerId,
      z: node.style.zIndex,
      display: node.style.display,
      videoWidth: node.videoWidth || node.naturalWidth || 0,
      videoHeight: node.videoHeight || node.naturalHeight || 0,
      readyState: node.readyState,
      transformX: node.dataset.akariTransformX,
      scale: node.dataset.akariTransformScale
    }));
    return {
      engineClock: Boolean(window.akari.frameEngineClock),
      engineCanvas: Boolean(document.getElementById('frame-engine-canvas')),
      layerBoxActive: box.classList.contains('is-active'),
      layerBox: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
      cutBoxActive: cut ? cut.classList.contains('is-active') : false,
      cutBox: cutRect ? { width: cutRect.width, height: cutRect.height } : null,
      media
    };
  })())`, view.contextId, view.sessionId);
  return JSON.parse(raw);
}

async function timelineSelection() {
  const raw = await evaluate(main, `JSON.stringify([...document.querySelectorAll('[data-akari-item-id]')]
    .filter(node => node.classList.contains('akari-annotations-selected'))
    .map(node => node.dataset.akariItemId))`);
  return JSON.parse(raw);
}

async function seek(seconds) {
  await evaluate(browser, `(() => { window.postMessage({type:'akari-preview-seek',time:${seconds}}, '*'); return true; })()`,
    view.contextId, view.sessionId);
  await sleep(1200);
}

async function capture(name) {
  const stage = await stageGeometry();
  const clip = {
    x: offset.x + stage.left, y: offset.y + stage.top,
    width: stage.width, height: stage.height, scale: 1
  };
  const shot = await main.send('Page.captureScreenshot', { format: 'png', fromSurface: true, clip });
  const file = path.join(outDir, `${label}-${name}.png`);
  await writeFile(file, Buffer.from(shot.data, 'base64'));
  return path.basename(file);
}

async function readEdit() {
  return JSON.parse(await readFile(editPath, 'utf8'));
}

function transformsOf(document) {
  const out = {};
  for (const track of document.tracks) for (const item of track.items ?? []) out[item.id] = item.transform;
  return out;
}

try {
  await mkdir(outDir, { recursive: true });
  child = spawn(electron, [shellDir, project, `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`, '--no-sandbox'], {
    cwd: shellDir,
    env: { ...process.env, THEIA_CONFIG_DIR: config, AKARI_HOME: akariHome },
    stdio: 'ignore'
  });
  const targets = await waitForJson(`http://127.0.0.1:${port}/json/list`,
    values => values.find(value => value.type === 'page'), 120000);
  const target = targets.find(value => value.type === 'page' && !value.url.startsWith('devtools:'));
  main = new CDP(target.webSocketDebuggerUrl);
  await main.connect();
  await main.send('Runtime.enable');
  const version = await waitForJson(`http://127.0.0.1:${port}/json/version`, value => value.webSocketDebuggerUrl);
  browser = new CDP(version.webSocketDebuggerUrl);
  await browser.connect();
  await browser.send('Target.setDiscoverTargets', { discover: true }).catch(() => undefined);
  trackContexts(browser);

  await sleep(12000);
  const deadline = Date.now() + 180000;
  while (!view && Date.now() < deadline) {
    await evaluate(main, `(() => { const b=[...document.querySelectorAll('button')]
      .find(x=>x.textContent?.trim()==='開くだけ'); if(b)b.click(); return true; })()`);
    const opened = await executeCommand(main, 'akari.preview.ensureVisible', { editUri });
    if (!opened.ok) { await sleep(2000); continue; }
    await sleep(3000);
    await activatePreview(main);
    await refreshView().catch(() => { view = undefined; });
  }
  if (!view) throw new Error('preview did not activate');
  await sleep(4000);
  await refreshView();

  // タイムライン（注釈ウィジェット）を先に開く。開くとレイアウトが変わるので、
  // ステージ幾何は毎回測り直す（stale な中心座標でクリックしない）。
  observations.steps.timeline_open = await executeCommand(main, 'akari.annotations.open', undefined);
  await sleep(4000);
  await activatePreview(main);
  await refreshView();
  observations.stage = await stageGeometry();

  const clickCenter = async (settle = 1200) => {
    await refreshView();
    const stage = await stageGeometry();
    const inner = innerPointFor(stage, stage.layoutWidth / 2, stage.layoutHeight / 2);
    const calibration = await calibrate(inner.x, inner.y);
    const point = toMain(inner.x, inner.y);
    await mouse('mouseMoved', point.x, point.y);
    await mouse('mousePressed', point.x, point.y, { buttons: 1 });
    await sleep(120);
    await mouse('mouseReleased', point.x, point.y, { buttons: 0 });
    await sleep(settle);
    return { stage, inner, point, calibration };
  };
  const clickAt = async (point, settle = 1000) => {
    await mouse('mouseMoved', point.x, point.y);
    await mouse('mousePressed', point.x, point.y, { buttons: 1 });
    await sleep(120);
    await mouse('mouseReleased', point.x, point.y, { buttons: 0 });
    await sleep(settle);
  };
  const clearSelection = async () => {
    const stage = await stageGeometry();
    await clickAt(toMain(stage.left + 2, stage.top + 2), 800);
  };

  // (a) 2 本重ね（V1 + V2）でプレビュー中央をクリック → 最前面（mid-item）が選ばれるか
  await seek(2);
  observations.steps.a_before_click = { preview: await previewState(), timeline: await timelineSelection() };
  observations.steps.a_geometry = await clickCenter();
  observations.steps.a_click_preview = {
    preview: await previewState(), timeline: await timelineSelection(),
    png: await capture('a-click-preview')
  };

  // (b) タイムラインで mid-item を選ぶ → プレビューに枠が出るか
  await clearSelection();
  {
    const rect = await evaluate(main, `JSON.stringify((() => {
      const nodes = [...document.querySelectorAll('[data-akari-item-id]')];
      const node = nodes.find(candidate => candidate.dataset.akariItemId === 'mid-item'
        && candidate.getBoundingClientRect().width > 4 && candidate.getBoundingClientRect().height > 4);
      if (!node) return { ids: nodes.map(n => n.dataset.akariItemId) };
      const r = node.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    })())`);
    const point = JSON.parse(rect);
    observations.steps.b_timeline_target = point;
    if (Number.isFinite(point?.x)) {
      await clickAt(point, 1500);
      await refreshView();
    }
    observations.steps.b_select_from_timeline = {
      preview: await previewState(), timeline: await timelineSelection(),
      png: await capture('b-select-from-timeline')
    };
  }

  // metadata 未着（engine 経路の台帳 <video> は preload='metadata'。実測で videoWidth=0 のまま
  // 残ることがある = 本票の根本原因）を、台帳要素の videoWidth/videoHeight を 0 に固定して再現する。
  // src は触らないので error → display:none の別経路には落ちず、寸法ゲートだけを純粋に突く。
  const hideMetadata = async () => JSON.parse(await evaluate(browser, `JSON.stringify((() => {
    for (const node of document.querySelectorAll('[data-akari-layer-id]')) {
      Object.defineProperty(node, 'videoWidth', { configurable: true, get: () => 0 });
      Object.defineProperty(node, 'videoHeight', { configurable: true, get: () => 0 });
    }
    return [...document.querySelectorAll('[data-akari-layer-id]')].map(node => ({
      id: node.dataset.akariLayerId, videoWidth: node.videoWidth,
      readyState: node.readyState, display: node.style.display }));
  })())`, view.contextId, view.sessionId));

  // (d) 3 本重ね（t=6s: V1 + V2 + V3）で中央クリック → 最前面（top-item）が選ばれるか
  await clearSelection();
  await seek(6);
  observations.steps.d_geometry = await clickCenter();
  observations.steps.d_three_stack = {
    preview: await previewState(), timeline: await timelineSelection(),
    png: await capture('d-three-stack')
  };

  // (e) metadata 未着で 2 本重ね（t=2s）→ 上（mid-item）が選べるか
  await clearSelection();
  await seek(2);
  observations.steps.e_hide_metadata = await hideMetadata();
  observations.steps.e_geometry = await clickCenter();
  observations.steps.e_click_without_metadata = {
    preview: await previewState(), timeline: await timelineSelection(),
    png: await capture('e-click-without-metadata')
  };

  // (f) metadata 未着で 3 本重ね（t=6s）→ 最前面（top-item）が選べるか
  await clearSelection();
  await seek(6);
  await hideMetadata();
  observations.steps.f_geometry = await clickCenter();
  observations.steps.f_three_stack_without_metadata = {
    preview: await previewState(), timeline: await timelineSelection(),
    png: await capture('f-three-stack-without-metadata')
  };

  // (g) 重なりの無い領域（base の cut だけが居る左端）をクリック → 従来どおり cut が選ばれる
  //     ことを確認する（受け入れ条件「重なりの無いプロジェクトの選択挙動が不変」の実測）。
  await clearSelection();
  await seek(2);
  {
    await refreshView();
    const stage = await stageGeometry();
    const point = toMain(stage.left + stage.width * 0.06, stage.top + stage.height / 2);
    await clickAt(point, 1200);
    observations.steps.g_cut_only_area = {
      point, preview: await previewState(), timeline: await timelineSelection(),
      png: await capture('g-cut-only-area')
    };
  }

  // (c) 2 本重ねへ戻し、選択したクリップを右へ 100px（画面 px）ドラッグ → edit.json の当該 item だけ動く
  await clearSelection();
  await seek(2);
  observations.steps.c_hide_metadata = await hideMetadata();
  const dragSelection = await clickCenter();
  observations.steps.c_selection_before_drag = {
    preview: await previewState(), timeline: await timelineSelection()
  };
  observations.steps.c_edit_before = transformsOf(await readEdit());
  {
    const start = dragSelection.point;
    await mouse('mouseMoved', start.x, start.y);
    await mouse('mousePressed', start.x, start.y, { buttons: 1 });
    await sleep(200);
    for (let step = 1; step <= 10; step += 1) {
      await mouse('mouseMoved', start.x + step * 10, start.y, { buttons: 1 });
      await sleep(60);
    }
    await sleep(200);
    await mouse('mouseReleased', start.x + 100, start.y, { buttons: 0 });
    await sleep(3000);
  }
  observations.steps.c_edit_after = transformsOf(await readEdit());
  observations.steps.c_drag = {
    dragPixels: 100,
    outputPixels: 100 / (dragSelection.stage.width / (dragSelection.stage.layoutWidth || 1)),
    preview: await previewState(), timeline: await timelineSelection(),
    png: await capture('c-drag-100px')
  };
} catch (error) {
  observations.error = String(error?.stack ?? error);
} finally {
  main?.close();
  browser?.close();
  if (child?.pid) {
    try { process.kill(child.pid, 'SIGTERM'); } catch { /* exited */ }
    await sleep(1500);
    try { process.kill(child.pid, 'SIGKILL'); } catch { /* exited */ }
  }
  await sleep(1000);
  const leftovers = spawnSync('/bin/sh', ['-c',
    `ps -eo pid,ppid,args | grep -F ${JSON.stringify(profile)} | grep -v grep | wc -l`], { encoding: 'utf8' });
  observations.leftoverProcesses = Number((leftovers.stdout ?? '0').trim());
  observations.webviewExceptions = webviewExceptions.slice(0, 12);
}

const sanitize = value => value
  .split(scratch).join('<TMP>')
  .split(repoRoot).join('<WORKTREE>')
  .split(os.homedir()).join('<HOME>');
const json = sanitize(JSON.stringify(observations, null, 2));
await writeFile(path.join(outDir, `${label}-observations.json`), `${json}\n`);
console.log(json);
await rm(scratch, { recursive: true, force: true });
