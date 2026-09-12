#!/usr/bin/env node

// L1 harness (wrapper-authored, verification-only; not product source).
// task 2026-09-12-annotation-stroke-lifetime 指示 6 の L1。
//
// 実機 Electron の出力プレビューで
//   Phase R: 録音中に実マウスで 3 本（左 / 中 / 右の帯）を 5 秒間隔で描き、
//            以後 1 秒刻みで pen-layer の帯ごとのインク量を計測する
//            （AFTER 期待: 最初の線が窓 8s + フェード 1.5s を過ぎて消え、最後の線は残る /
//              BEFORE 期待: 3 本とも残り続ける）
//   Phase S: 録音停止で表示プールがクリアされるか
//   Phase D: セッション描線の再表示で、プレイヘッドを動かすと近傍の線だけが出るか
//   Phase T: 「描線を表示」OFF / ON
// を計測して JSON + PNG（実機スクショ + pen-layer canvas 単体）で残す。
//
// 計測は pen-layer canvas の実ピクセル（getImageData の α）で行う。webview の
// クロージャ変数は読まない — 見えているかどうかだけを見る。
//
// 使い方:  AKARI_L1_LABEL=after node run-l1.mjs   /   AKARI_L1_LABEL=before node run-l1.mjs
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
const port = Number(process.env.AKARI_CDP_PORT ?? 9473);
const label = process.env.AKARI_L1_LABEL ?? 'after';

// 表示規則のチューニング（PEN_TUNING の既定値）。BEFORE 走行でも同じ時間割で計測する。
const WINDOW_SEC = 8;
const FADE_SEC = 1.5;

const scratch = await realpath(await mkdtemp(path.join(os.tmpdir(), 'akari-stroke-life-')));
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

// 再表示フェーズで frame.timelineT を 2 / 22 / 42 秒に振り分けたいので、
// fixture（12 秒）を 60 秒の 1 枚絵へ伸ばした検証専用 edit.json を一時ディレクトリに作る。
const baseEdit = JSON.parse(await readFile(path.join(project, 'edit.json'), 'utf8'));
baseEdit.tracks = [{
  id: 'v1', lane: 'visual', name: 'V1 — 60s still',
  items: [{
    id: 'photo-a-item', at: 0, duration: 1800,
    transform: { x: 0, y: 0, scale: 1, rotate: 0 },
    source: { kind: 'media', src: 'photo-a', in: 0, out: 60 }
  }]
}];
await writeFile(editPath, `${JSON.stringify(baseEdit, null, 2)}\n`);

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
              { frameId: frame.id, worldName: 'akari-stroke-life' }, sessionId);
            const hit = await evaluate(browser,
              `Boolean(document.getElementById('preview-stage') && document.getElementById('pen-layer'))`,
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

const inView = expression => evaluate(browser, expression, view.contextId, view.sessionId);

/** 出力プレビューへ host と同じ形の message を投げる（webview の message listener が唯一の入口）。 */
const post = payload => inView(`(() => { window.postMessage(${JSON.stringify(payload)}, '*'); return true; })()`);

/** pen-layer の実ピクセルを 3 帯に分けてインク量を数える（帯 0=左 / 1=中 / 2=右）。 */
const census = () => inView(`JSON.stringify((() => {
  const canvas = document.getElementById('pen-layer');
  const ctx = canvas.getContext('2d');
  const bands = [];
  for (let index = 0; index < 3; index += 1) {
    const x0 = Math.floor(canvas.width * index / 3);
    const x1 = Math.floor(canvas.width * (index + 1) / 3);
    const data = ctx.getImageData(x0, 0, Math.max(1, x1 - x0), canvas.height).data;
    let inkPixels = 0;
    let maxAlpha = 0;
    let alphaSum = 0;
    for (let p = 3; p < data.length; p += 4) {
      const alpha = data[p];
      if (alpha > 0) { inkPixels += 1; alphaSum += alpha; if (alpha > maxAlpha) maxAlpha = alpha; }
    }
    bands.push({ band: index, inkPixels, maxAlpha, alphaSum });
  }
  return { bands, canvas: { width: canvas.width, height: canvas.height,
    cssWidth: canvas.clientWidth, cssHeight: canvas.clientHeight } };
})())`).then(JSON.parse);

const penLayerRect = () => inView(`(() => {
  const rect = document.getElementById('pen-layer').getBoundingClientRect();
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
})()`);

const outerFrameRect = () => evaluate(main, `(() => {
  const frames = [...document.querySelectorAll('iframe')]
    .map(frame => frame.getBoundingClientRect())
    .filter(rect => rect.width > 0 && rect.height > 0)
    .sort((a, b) => b.width * b.height - a.width * a.height);
  const rect = frames[0] ?? { x: 0, y: 0, width: 0, height: 0 };
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
})()`);

/** 帯 index の中央あたりを水平にドラッグして 1 本描く（実マウス = trusted pointer events）。 */
async function drawStrokeInBand(rect, index) {
  const y = Math.round(rect.y + rect.height * (0.35 + index * 0.1));
  const x0 = Math.round(rect.x + rect.width * (index / 3) + rect.width * 0.04);
  const x1 = Math.round(rect.x + rect.width * ((index + 1) / 3) - rect.width * 0.04);
  const dispatch = (type, x, buttons) => browser.send('Input.dispatchMouseEvent', {
    type, x, y, button: 'left', clickCount: type === 'mouseMoved' ? 0 : 1, buttons
  }, view.sessionId);
  await dispatch('mousePressed', x0, 1);
  const steps = 12;
  for (let step = 1; step <= steps; step += 1) {
    await dispatch('mouseMoved', Math.round(x0 + (x1 - x0) * (step / steps)), 1);
    await sleep(25);
  }
  await dispatch('mouseReleased', x1, 0);
  await sleep(120);
}

async function shot(name) {
  const image = await main.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
  const file = path.join(here, `${label}-${name}.png`);
  await writeFile(file, Buffer.from(image.data, 'base64'));
  return path.basename(file);
}

/** pen-layer だけを PNG で保存する（アプリ全体スクショだと線が小さくて読めないため）。 */
async function penShot(name) {
  const dataUrl = await inView(`document.getElementById('pen-layer').toDataURL('image/png')`);
  const file = path.join(here, `${label}-${name}-penlayer.png`);
  await writeFile(file, Buffer.from(String(dataUrl).split(',')[1], 'base64'));
  return path.basename(file);
}

let child;
let status = 'FAILED';
let summary = {};
const timeline = [];
try {
  child = spawn(electron, [shellDir, project, `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`, '--no-sandbox', '--disable-features=MacWebContentsOcclusion'], {
    cwd: shellDir,
    env: { ...process.env, THEIA_CONFIG_DIR: config, AKARI_HOME: akariHome },
    stdio: 'ignore'
  });
  record('launched', { pid: child.pid, label });

  const targets = await waitForJson(`http://127.0.0.1:${port}/json/list`,
    values => values.find(value => value.type === 'page' && !value.url.startsWith('devtools:')));
  main = new CDP(targets.find(value => value.type === 'page' && !value.url.startsWith('devtools:')).webSocketDebuggerUrl);
  await main.connect();
  await main.send('Runtime.enable');
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
  record('preview-attached', {});
  await sleep(3000);

  // ---- Phase R: 録音中に 3 本描く -------------------------------------------------
  await post({ type: 'akari-preview-seek', time: 2 });
  await sleep(500);
  await post({ type: 'akari-preview-set-review-recording', active: true, mode: 'pen' });
  await sleep(600);
  const penActive = await inView(`document.getElementById('pen-layer').classList.contains('is-active')`);
  record('recording-armed', { penLayerIsActive: penActive });
  if (!penActive) throw new Error('pen layer did not arm (recording/tool mode not applied)');

  const rect = await penLayerRect();
  const outer = await outerFrameRect();
  const drawRect = { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  record('draw-rect', { penLayerRectInWebview: rect, outerFrameRectInMain: outer });

  const t0 = Date.now();
  const at = () => Number(((Date.now() - t0) / 1000).toFixed(2));
  const sample = async (note) => {
    const value = await census();
    const entry = { atSec: at(), note, bands: value.bands.map(band => ({ band: band.band, inkPixels: band.inkPixels, maxAlpha: band.maxAlpha })) };
    timeline.push(entry);
    console.log('[sample]', JSON.stringify(entry));
    return entry;
  };

  await sample('before-any-stroke');
  await drawStrokeInBand(drawRect, 0);
  record('stroke-drawn', { band: 0, atSec: at() });
  await sleep(1200);
  await sample('after-stroke-A');
  const shotA = await penShot('01-stroke-A');

  await sleep(3800);
  await drawStrokeInBand(drawRect, 1);
  record('stroke-drawn', { band: 1, atSec: at() });
  await sleep(1200);
  const strokeBSample = await sample('after-stroke-B');
  const shotAB = await penShot('01b-strokes-A-and-B-both-visible');

  await sleep(3800);
  await drawStrokeInBand(drawRect, 2);
  record('stroke-drawn', { band: 2, atSec: at() });
  await sleep(1200);
  const afterC = await sample('after-stroke-C-all-three-drawn');
  const shotAll = await penShot('02-three-strokes');
  const shotAllApp = await shot('02-three-strokes-app');

  // 3 本描き終えてから 10 秒待つ（契約 指示6）。1 秒刻みで帯ごとのインクを追う。
  for (let index = 0; index < 12; index += 1) {
    await sleep(1000);
    await sample(`wait-${index + 1}s-after-third-stroke`);
  }
  const afterWait = timeline[timeline.length - 1];
  const shotWait = await penShot('03-after-10s-wait');
  const shotWaitApp = await shot('03-after-10s-wait-app');

  // ---- Phase S: 録音停止 ----------------------------------------------------------
  await post({ type: 'akari-preview-set-review-recording', active: false, mode: 'neutral' });
  await sleep(1200);
  const afterStop = await sample('after-recording-stopped');
  const shotStop = await penShot('04-after-recording-stopped');

  // ---- Phase D: セッション描線の再表示 + プレイヘッド移動 ---------------------------
  const replayStrokes = [0, 1, 2].map(index => ({
    id: `st-000${index + 1}`, tool: 'rect', space: 'content-rect',
    recTStart: index * 5, recTEnd: index * 5 + 1,
    frame: { timelineT: 2 + index * 20, sourceT: 2 + index * 20, cutIndex: 0 },
    box: [index / 3 + 0.04, 0.25, 1 / 3 - 0.08, 0.5]
  }));
  await post({
    type: 'akari-preview-show-session-strokes', sessionId: 's-0001',
    target: { tab: editUri, recT: 0 }, strokes: replayStrokes
  });
  await sleep(800);
  const replayAt2 = await sample('replay-playhead-2s');
  const shotReplayA = await penShot('05-replay-playhead-2s');
  for (const [seekTo, note, name] of [[22, 'replay-playhead-22s', '06-replay-playhead-22s'],
    [42, 'replay-playhead-42s', '07-replay-playhead-42s']]) {
    await post({ type: 'akari-preview-seek', time: seekTo });
    await sleep(1200);
    await sample(note);
    await penShot(name);
  }
  const replayAt22 = timeline.find(entry => entry.note === 'replay-playhead-22s');
  const replayAt42 = timeline.find(entry => entry.note === 'replay-playhead-42s');

  // ---- Phase T: 「描線を表示」トグル ------------------------------------------------
  await post({ type: 'akari-preview-set-stroke-visibility', visible: false });
  await sleep(800);
  const toggleOff = await sample('stroke-visibility-off');
  const shotOff = await penShot('08-visibility-off');
  await post({ type: 'akari-preview-set-stroke-visibility', visible: true });
  await sleep(800);
  const toggleOn = await sample('stroke-visibility-on');

  // ---- Phase S2: 窓の内側で録音停止しても表示プールが消えるか（指示 3 の直接証跡）-------
  await post({ type: 'akari-preview-set-review-recording', active: true, mode: 'pen' });
  await sleep(700);
  await drawStrokeInBand(drawRect, 0);
  await sleep(1200);
  const s2Drawn = await sample('s2-stroke-drawn-inside-window');
  const shotS2Drawn = await penShot('09-s2-stroke-inside-window');
  await post({ type: 'akari-preview-set-review-recording', active: false, mode: 'neutral' });
  await sleep(1200);
  const s2Stopped = await sample('s2-after-stop-inside-window');
  const shotS2Stopped = await penShot('10-s2-after-stop-inside-window');

  summary = {
    label,
    tuning: { visibleWindowSec: WINDOW_SEC, fadeOutSec: FADE_SEC },
    strokesDrawn: 3,
    bothAandBVisible: strokeBSample.bands,
    afterThirdStroke: afterC.bands,
    afterTwelveSecondWait: afterWait.bands,
    afterRecordingStopped: afterStop.bands,
    replayPlayhead2s: replayAt2.bands,
    replayPlayhead22s: replayAt22?.bands ?? null,
    replayPlayhead42s: replayAt42?.bands ?? null,
    visibilityOff: toggleOff.bands,
    visibilityOn: toggleOn.bands,
    strokeDrawnInsideWindow: s2Drawn.bands,
    afterStopInsideWindow: s2Stopped.bands,
    shots: [shotA, shotAB, shotAll, shotAllApp, shotWait, shotWaitApp, shotStop, shotReplayA, shotOff,
      shotS2Drawn, shotS2Stopped]
  };
  status = 'PASS';
  record('verdict', { status, ...summary });
} catch (error) {
  record('error', { error: sanitize(String(error?.stack ?? error)) });
  console.error(error);
} finally {
  await writeFile(path.join(here, `run-log-${label}.json`),
    `${sanitize(JSON.stringify({ status, label, summary, timeline, records: log }, null, 2))}\n`)
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
