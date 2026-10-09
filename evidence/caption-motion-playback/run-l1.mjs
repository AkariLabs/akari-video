#!/usr/bin/env node
// L1（実機 Electron + CDP + 実プレビュー）: インスペクターで選べる字幕の動きが「再生中に」効くかを撮る。
//
//   node evidence/caption-motion-playback/run-l1.mjs --phase preview --label before --out <dir>
//   node evidence/caption-motion-playback/run-l1.mjs --phase export  --label before --out <dir>
//
// preview: 動き 1 種につき字幕 1 本（4 秒枠）を並べたプロジェクトを開き、先頭から**再生**して
//          各字幕の「登場の途中 / 表示中 / 退場の途中」でプレビューを撮る（押した瞬間の replay ではない）。
//          続けて字幕を選択したまま再生する組（オーナーの操作に近い条件）と、インスペクターの
//          選択表示（登場を切り替える前後・退場タブ）を撮る。
// export:  同じプロジェクトを render-cut（--engine auto）で書き出し、同じ時刻のフレームを抜く。
//
// 環境: HOME / AKARI_HOME / THEIA_CONFIG_DIR / user-data-dir はすべて一時ディレクトリ。
// 証跡に作業機の絶対パスを残さない（scrub）。

import { spawn, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const here = path.dirname(fileURLToPath(import.meta.url));
const worktree = path.resolve(here, '..', '..');
const shellDir = path.join(worktree, 'apps', 'shell');
function argument(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}
const phase = argument('phase', 'preview');
const label = argument('label', 'run');
const outDir = path.resolve(argument('out', path.join(here, 'out')));
const onlyRows = (argument('rows', '') || '').split(',').filter(Boolean);
const FFMPEG = process.env.FFMPEG ?? 'ffmpeg';
const port = Number(process.env.AKARI_CDP_PORT ?? 9600 + (process.pid % 300));

// ---------------------------------------------------------------- rows

const recipes = JSON.parse(await readFile(path.join(worktree, 'packages', 'render-cut', 'src', 'caption-animation-recipes.json'), 'utf8'));
// インスペクターの「テキストアニメ」全種（catalog.ts の写し。typewriter は対象外）
const catalogSource = await readFile(path.join(shellDir, 'extensions', 'akari-annotations', 'src', 'browser', 'inspector', 'caption-motion-catalog.ts'), 'utf8');
const CATALOG = [...catalogSource.matchAll(/\{ id: "([^"]+)", label: "([^"]+)", slot: "(in|loop)" \}/g)]
  .map(([, id, name, slot]) => ({ id, name, slot }));
const IN = 2.0; // 登場・退場の尺（撮影の時刻ずれに耐えるよう既定より長くする）
const OUT = 2.0;
const LOOP = 3;
const rows = [];
for (const entry of CATALOG) {
  if (entry.id === 'typewriter') continue;
  rows.push(entry.slot === 'loop'
    ? { key: `loop-${entry.id}`, title: `${entry.name}（${entry.id}・強調）`, animation: { loop: { id: entry.id, duration_sec: LOOP } } }
    : { key: `inout-${entry.id}`, title: `${entry.name}（${entry.id}・登場+退場）`,
      animation: { in: { id: entry.id, duration_sec: IN }, out: { id: entry.id, duration_sec: OUT } } });
}
// 「動き」の強調タブ（pulse / spin / blink / jiggle）は登場用 id を loop に置く
for (const [preset, id] of [['pulse', 'heartbeat'], ['spin', 'spin-in'], ['blink', 'flash'], ['jiggle', 'jitter']]) {
  rows.push({ key: `loop-${id}`, title: `強調タブ「${preset}」（${id}・強調）`, animation: { loop: { id, duration_sec: LOOP } } });
}
// 組（タイプライターは対象外）
const presetToAnimation = { fade: 'fade-in-out', 'slide-up': 'slide-up', wipe: 'wipe-right', pop: 'pop', pulse: 'heartbeat', float: 'float' };
for (const [id, name, inPreset, loopPreset, outPreset] of [
  ['simple', 'シンプル', 'fade', null, 'fade'], ['smart', 'スマート', 'slide-up', 'float', 'slide-up'],
  ['fun', 'ファン', 'pop', 'pulse', 'pop'], ['corp', 'コーポレート', 'wipe', null, 'wipe'],
  ['relax', 'リラックス', 'fade', 'float', 'fade']
]) {
  rows.push({ key: `combo-${id}`, title: `組「${name}」`, animation: {
    in: { id: presetToAnimation[inPreset], duration_sec: IN }, out: { id: presetToAnimation[outPreset], duration_sec: OUT },
    ...(loopPreset ? { loop: { id: presetToAnimation[loopPreset], duration_sec: LOOP } } : {}) } });
}
// 登場 / 退場が混ざらないことの確認行
rows.push({ key: 'only-out-fade', title: '退場だけフェード', animation: { out: { id: 'fade-in-out', duration_sec: OUT } } });
rows.push({ key: 'only-in-fade', title: '登場だけフェード', animation: { in: { id: 'fade-in-out', duration_sec: IN } } });
rows.push({ key: 'only-out-wipe', title: '退場だけワイプ', animation: { out: { id: 'wipe-right', duration_sec: OUT } } });
rows.push({ key: 'only-in-wipe', title: '登場だけワイプ', animation: { in: { id: 'wipe-right', duration_sec: IN } } });
// 実際の既定尺（インスペクターが書く尺）のワイプ / フェード
rows.push({ key: 'none', title: '動きなし（対照）', animation: null });
const SLOT_SECONDS = 6;
const CAPTION_OFFSET = 0.25;
const CAPTION_LENGTH = 5.5;
const SHOTS = [['in', 0.8], ['hold', 2.75], ['out', 4.2]];
// 再生は 0.5 倍速（プレビューの速さ設定。スクリーンショットの遅れ ~1 秒が字幕時間で 0.5 秒に収まる）
const PLAY_RATE = Number(process.env.AKARI_L1_RATE ?? 0.5);
rows.forEach((row, index) => {
  row.index = index;
  row.captionId = `c-${String(index + 1).padStart(4, '0')}`;
  row.start = index * SLOT_SECONDS + CAPTION_OFFSET;
  row.end = row.start + CAPTION_LENGTH;
});
// インスペクター確認用（最後尾。組「シンプル」= 登場フェード / 退場フェード）
const inspectorRow = { key: 'inspector', captionId: `c-${String(rows.length + 1).padStart(4, '0')}`,
  start: rows.length * SLOT_SECONDS + CAPTION_OFFSET, title: 'インスペクター確認用',
  animation: { in: { id: 'fade-in-out', duration_sec: 0.4 }, out: { id: 'fade-in-out', duration_sec: 0.27 } } };
inspectorRow.end = inspectorRow.start + CAPTION_LENGTH;
const TOTAL = (rows.length + 1) * SLOT_SECONDS;
for (const id of new Set(rows.flatMap(row => Object.values(row.animation ?? {}).map(slot => slot.id)))) {
  if (!Object.hasOwn(recipes, id)) console.warn(`fixture: recipe missing for ${id}`);
}

// ---------------------------------------------------------------- fixture

const scratch = await realpath(await mkdtemp(path.join(os.tmpdir(), 'akari-caption-motion-l1-')));
const project = path.join(scratch, 'project');
const profile = path.join(scratch, 'profile');
const config = path.join(scratch, 'config');
const akariHome = path.join(scratch, 'akari-home');
const home = path.join(scratch, 'home');
const editPath = path.join(project, 'edit.json');
const captionsPath = path.join(project, 'captions.json');
const editUri = pathToFileURL(editPath).href;
await mkdir(outDir, { recursive: true });
await Promise.all([mkdir(profile), mkdir(config), mkdir(akariHome), mkdir(home), mkdir(project, { recursive: true }).then(() => undefined),
  mkdir(path.join(project, '.akari'), { recursive: true }), mkdir(path.join(project, 'assets'), { recursive: true })]);
const fps = 30;
const EDIT = {
  version: 2,
  output: { width: 1280, height: 720, fps },
  sources: [{ id: 'base', path: 'assets/base.mp4' }],
  tracks: [{ id: 'v-main', lane: 'visual', items: [
    { id: 'cut-1', at: 0, duration: TOTAL * fps, source: { kind: 'media', src: 'base', in: 0, out: TOTAL } }] }]
};
const captionRow = row => ({ id: row.captionId, start: row.start, end: row.end, time_domain: 'output', text: row.title,
  speaker: null, sourceRef: null, edited: true, ...(row.animation ? { text_style: { animation: row.animation } } : {}) });
const CAPTIONS = { captions: [...rows, inspectorRow].map(captionRow) };
await writeFile(editPath, `${JSON.stringify(EDIT, null, 2)}\n`);
await writeFile(captionsPath, `${JSON.stringify(CAPTIONS, null, 2)}\n`);
await writeFile(path.join(project, '.akari', 'lint.json'), '{"version":1,"verdict":"pass"}\n');
{
  const encoded = spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-f', 'lavfi', '-i',
    `color=c=0x2b3a55:s=1280x720:d=${TOTAL}:r=${fps}`, '-vf', 'drawgrid=w=80:h=80:t=1:c=white@0.12',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-g', '30', path.join(project, 'assets', 'base.mp4')], { encoding: 'utf8' });
  if (encoded.status !== 0) throw new Error(`ffmpeg failed: ${encoded.stderr}`);
}

const scrubText = value => String(value ?? '')
  .split(scratch).join('<tmp>').split(worktree).join('<repo>').split(os.homedir()).join('<home>')
  .replace(/\/(?:private|tmp|Users|var)\/[^\s)"']+/g, '<path>');

const summary = { label, phase, rows: rows.map(({ key, title, captionId, start, end, animation }) =>
  ({ key, title, captionId, start, end, animation })), shots: SHOTS, total: TOTAL };

// ---------------------------------------------------------------- export phase

if (phase === 'export') {
  await mkdir(path.join(project, 'exports'), { recursive: true });
  const out = path.join(project, 'exports', 'l1.mp4');
  const started = Date.now();
  const run = spawnSync(process.execPath, [path.join(worktree, 'packages', 'render-cut', 'bin', 'render-cut.mjs'),
    project, '--out', out, '--force', '--engine', process.env.AKARI_L1_ENGINE ?? 'auto', '--no-audio', '--progress'], {
    encoding: 'utf8', maxBuffer: 1 << 28,
    env: { ...process.env, HOME: home, AKARI_HOME: akariHome, AKARI_EXPORT_ALLOW_DESKTOP: '0' }
  });
  summary.exportSeconds = (Date.now() - started) / 1000;
  summary.exportStatus = run.status;
  const lines = `${run.stdout}\n${run.stderr}`.split('\n');
  summary.engineLines = lines.filter(line => /ENGINE|launcher|tier|unsupported|warn|理由|error/i.test(line)).map(scrubText).slice(0, 40);
  summary.exportTail = lines.slice(-12).map(scrubText);
  try {
    const { readdir } = await import('node:fs/promises');
    const directory = path.join(project, '.akari', 'reports', 'render-receipts');
    const receiptName = (await readdir(directory)).find(name => name.endsWith('.json'));
    summary.receiptName = receiptName ?? null;
    const text = await readFile(path.join(directory, receiptName), 'utf8');
    summary.launcherTier = [...text.matchAll(/"launcher_tier": (\d+|null)/g)].map(match => match[1]);
    summary.receiptEngine = /"engine": "([a-z]+)"/.exec(text)?.[1] ?? null;
  } catch { summary.receipt = 'not found'; }
  summary.frames = [];
  if (run.status === 0) {
    for (const row of rows) {
      if (onlyRows.length && !onlyRows.includes(row.key)) continue;
      for (const [name, offset] of SHOTS) {
        const file = `${label}-export-${row.key}-${name}.png`;
        const t = row.start + offset;
        const crop = spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-ss', t.toFixed(3), '-i', out,
          '-frames:v', '1', '-vf', 'crop=1280:300:0:420,scale=640:-1', path.join(outDir, file)], { encoding: 'utf8' });
        summary.frames.push({ row: row.key, shot: name, t, file: crop.status === 0 ? file : null });
      }
    }
  }
  await writeFile(path.join(outDir, `${label}-export.json`), `${JSON.stringify(summary, null, 2)}\n`);
  console.log(JSON.stringify({ exportStatus: summary.exportStatus, exportSeconds: summary.exportSeconds,
    engineLines: summary.engineLines, launcherTier: summary.launcherTier, tail: summary.exportTail }, null, 2));
  await rm(scratch, { recursive: true, force: true });
  process.exit(run.status === 0 ? 0 : 1);
}

// ---------------------------------------------------------------- CDP

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
  close() { this.socket?.close(); }
}

async function evaluate(cdp, expression, contextId, sessionId) {
  const response = await cdp.send('Runtime.evaluate', {
    expression, returnByValue: true, awaitPromise: true, ...(contextId === undefined ? {} : { contextId })
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

const consoleLines = [];
const mainWorldContexts = new Map();
function trackContexts(cdp) {
  cdp.on('Runtime.executionContextCreated', (params, sessionId) => {
    if (!params?.context?.auxData?.isDefault) return;
    mainWorldContexts.set(sessionId, [...(mainWorldContexts.get(sessionId) ?? []), params.context.id]);
  });
  cdp.on('Runtime.executionContextsCleared', (_params, sessionId) => mainWorldContexts.delete(sessionId));
}
function trackConsole(cdp) {
  cdp.on('Runtime.consoleAPICalled', params => {
    if (params.type !== 'error' && params.type !== 'warning') return;
    consoleLines.push(params.args.map(arg => arg.value ?? arg.description ?? arg.type).join(' ').slice(0, 300));
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

let main;
let browser;
let view;
const inView = expression => evaluate(browser, expression, view.contextId, view.sessionId);

async function executeCommand(command, argumentValue) {
  console.error(`[l1] command ${command}`);
  return Promise.race([sleep(20000).then(() => ({ ok: false, error: 'command timed out (20s)' })), evaluate(main, `(async () => {
    try {
      const dictionary = window.theia?.container?._bindingDictionary;
      const keys = dictionary?._map ? [...dictionary._map.keys()] : [];
      const CommandClass = keys.find(key => typeof key === 'function' && key.prototype
        && typeof key.prototype.executeCommand === 'function' && typeof key.prototype.registerCommand === 'function');
      if (!CommandClass) return { ok: false, error: 'command registry unavailable' };
      const value = await window.theia.container.get(CommandClass)
        .executeCommand(${JSON.stringify(command)}, ${JSON.stringify(argumentValue)});
      let plain = null; try { plain = value === undefined ? null : JSON.parse(JSON.stringify(value)); } catch { plain = typeof value; }
      return { ok: true, value: plain };
    } catch (error) { return { ok: false, error: error?.message ?? String(error) }; }
  })()`).catch(error => ({ ok: false, error: String(error?.message ?? error) }))]);
}

async function screenshot(name, clip) {
  const shot = await main.send('Page.captureScreenshot', { format: 'png', fromSurface: true, ...(clip ? { clip: { ...clip, scale: 1 } } : {}) });
  await writeFile(path.join(outDir, `${name}.png`), Buffer.from(shot.data, 'base64'));
  return `${name}.png`;
}

// プレビューの字幕帯（下 40%）を切り抜く矩形（main ページ座標）
let stageClip = null;
async function computeStageClip() {
  const frame = await evaluate(main, `(() => {
    const frames = [...document.querySelectorAll('iframe')].map(element => ({ box: element.getBoundingClientRect() }))
      .filter(value => value.box.width > 200 && value.box.height > 150)
      .sort((left, right) => right.box.width * right.box.height - left.box.width * left.box.height);
    const box = frames[0]?.box; return box ? { x: box.x, y: box.y, width: box.width, height: box.height } : null; })()`);
  const stage = await inView(`(() => { const element = document.getElementById('preview-stage') ?? document.getElementById('preview-layers');
    const box = element.getBoundingClientRect(); return { x: box.x, y: box.y, width: box.width, height: box.height }; })()`);
  if (!frame || !stage) return null;
  const top = frame.y + stage.y + stage.height * 0.58;
  return { x: Math.round(frame.x + stage.x), y: Math.round(top), width: Math.round(stage.width), height: Math.round(stage.height * 0.42) };
}

// 字幕プレートの実測（再生中の計算済みスタイル）
const PROBE = `(() => {
  const seek = Number(document.getElementById('seek')?.value ?? NaN);
  const plates = [...document.querySelectorAll('#caption-plate .akari-caption__plate')]
    .filter(element => element.getBoundingClientRect().width > 0);
  const plate = plates[0];
  const host = plate?.closest('.caption-row-plate');
  const style = plate ? getComputedStyle(plate) : null;
  return { t: seek, playing: document.getElementById('play-toggle')?.getAttribute('aria-label') ?? document.getElementById('play-toggle')?.textContent ?? null,
    text: plate?.textContent?.trim().slice(0, 40) ?? null,
    selected: host ? host.hasAttribute('data-selected') : null,
    textanim: plate ? plate.hasAttribute('data-akari-textanim') : null,
    opacity: style ? Number(style.opacity) : null, transform: style?.transform ?? null, clipPath: style?.clipPath ?? null,
    animations: plate ? plate.getAnimations().map(animation => ({ name: animation.animationName ?? null,
      state: animation.playState, t: Math.round(Number(animation.currentTime ?? 0)) })) : [] };
})()`;

async function captureRowShots(row, prefix, record) {
  for (const [name, offset] of SHOTS) {
    const target = row.start + offset;
    const deadline = Date.now() + 15000;
    let now = await inView(PROBE);
    while (Date.now() < deadline && !(now.t >= target - 0.02)) {
      await sleep(now.t < target - 0.5 ? 120 : 8);
      now = await inView(PROBE);
    }
    const file = await screenshot(`${prefix}-${row.key}-${name}`, stageClip);
    const after = await inView(PROBE);
    record.push({ row: row.key, shot: name, target, probe: now, tAfterShot: after.t, file });
  }
}

const report = { ...summary, port, steps: {} };
let child;
try {
  await stat(path.join(shellDir, 'lib', 'backend', 'main.js'));
  const electron = path.join(worktree, 'node_modules', 'electron', 'dist', 'Electron.app', 'Contents', 'MacOS', 'Electron');
  child = spawn(electron, [shellDir, project, `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-sandbox',
    '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding'], {
    cwd: shellDir, env: { ...process.env, HOME: home, THEIA_CONFIG_DIR: config, AKARI_HOME: akariHome }, stdio: 'ignore', detached: true
  });
  const isShellPage = value => value.type === 'page' && value.url && !value.url.startsWith('devtools:');
  const targets = await waitForJson(`http://127.0.0.1:${port}/json/list`, values => values.find(isShellPage));
  const target = targets.find(isShellPage);
  main = new CDP(target.webSocketDebuggerUrl);
  await main.connect();
  trackConsole(main);
  await main.send('Runtime.enable');
  const version = await waitForJson(`http://127.0.0.1:${port}/json/version`, value => value.webSocketDebuggerUrl);
  browser = new CDP(version.webSocketDebuggerUrl);
  await browser.connect();
  trackContexts(browser);
  trackConsole(browser);
  await browser.send('Target.setDiscoverTargets', { discover: true }).catch(() => undefined);
  try {
    const { windowId } = await browser.send('Browser.getWindowForTarget', { targetId: target.id });
    await browser.send('Browser.setWindowBounds', { windowId, bounds: { left: 0, top: 0, width: 1680, height: 1040, windowState: 'normal' } });
  } catch { /* best-effort */ }
  await sleep(10000);
  const dismiss = `(() => { const b=[...document.querySelectorAll('button')].find(x=>['開くだけ','キャンセル'].includes(x.textContent?.trim())); if(b)b.click(); return true; })()`;
  await evaluate(main, dismiss);
  await evaluate(main, '(() => { window.resizeTo(1900, 1150); return true; })()').catch(() => undefined);
  await sleep(1000);
  const deadline = Date.now() + 150000;
  while (!view && Date.now() < deadline) {
    await evaluate(main, dismiss);
    const opened = await executeCommand('akari.preview.ensureVisible', { editUri });
    if (!opened.ok) { await sleep(3000); continue; }
    await sleep(4000);
    view = await findPreviewView(browser, 15000);
  }
  if (!view) throw new Error('preview webview not found');
  console.error('[l1] preview found');
  report.steps.inspectorOpen = await executeCommand('akari.inspector.open');
  await sleep(3000);
  await evaluate(main, dismiss);
  await sleep(800);
  report.steps.windowSize = await evaluate(main, '({ w: innerWidth, h: innerHeight })');
  // 選択なしの状態から始める（timeline の選択を外す）
  report.steps.clearSelection = await executeCommand('akari.timeline.selectCaptions', { editUri, captionIds: [] });
  await inView(`(() => { window.postMessage({ type: 'akari-preview-seek', time: 0.1 }, '*'); return true; })()`);
  await sleep(2500);
  report.steps.rate = await inView(`(() => { window.postMessage({ type: 'akari-preview-set-rate', rate: ${PLAY_RATE} }, '*'); return true; })()`);
  stageClip = await computeStageClip();
  report.stageClip = stageClip;
  await screenshot(`${label}-window-start`);

  // ---- A: 選択なしで先頭から通しで再生 ----
  const playback = [];
  const playRows = rows.filter(row => !onlyRows.length || onlyRows.includes(row.key));
  const firstStart = Math.max(0, playRows[0].start - CAPTION_OFFSET - 0.2);
  await inView(`(() => { window.postMessage({ type: 'akari-preview-seek', time: ${firstStart} }, '*'); return true; })()`);
  await sleep(1500);
  await inView(`(() => { window.postMessage({ type: 'akari-preview-toggle-playback' }, '*'); return true; })()`);
  for (const row of playRows) {
    console.error(`[l1] play ${row.key}`);
    const probe = await inView(PROBE);
    if (probe.t > row.start + 0.3 || probe.t < row.start - 1.2) { // 取りこぼし・飛び: その字幕の手前から再生し直す
      await inView(`(() => { window.postMessage({ type: 'akari-preview-toggle-playback' }, '*'); return true; })()`);
      await sleep(300);
      await inView(`(() => { window.postMessage({ type: 'akari-preview-seek', time: ${row.start - 0.2} }, '*'); return true; })()`);
      await sleep(1200);
      await inView(`(() => { window.postMessage({ type: 'akari-preview-toggle-playback' }, '*'); return true; })()`);
    }
    await captureRowShots(row, `${label}-play`, playback);
  }
  await inView(`(() => { window.postMessage({ type: 'akari-preview-toggle-playback' }, '*'); return true; })()`);
  report.steps.playback = playback;

  // ---- B: 字幕を選択したまま再生（インスペクターで動きを選んだ直後と同じ状態） ----
  const selectedPlayback = [];
  for (const key of ['inout-fade-in-out', 'inout-slide-up', 'inout-wipe-right', 'loop-heartbeat', 'combo-corp', 'only-out-fade']) {
    const row = rows.find(value => value.key === key);
    if (!row || (onlyRows.length && !onlyRows.includes(key))) continue;
    const selected = await executeCommand('akari.timeline.selectCaptions', { editUri, captionIds: [row.captionId] });
    await sleep(1200);
    await inView(`(() => { window.postMessage({ type: 'akari-preview-seek', time: ${row.start - 0.2} }, '*'); return true; })()`);
    await sleep(1500);
    await inView(`(() => { window.postMessage({ type: 'akari-preview-toggle-playback' }, '*'); return true; })()`);
    await captureRowShots(row, `${label}-selplay`, selectedPlayback);
    await inView(`(() => { window.postMessage({ type: 'akari-preview-toggle-playback' }, '*'); return true; })()`);
    selectedPlayback.at(-1).selectCommand = selected.ok;
    await sleep(500);
  }
  report.steps.selectedPlayback = selectedPlayback;
  await executeCommand('akari.timeline.selectCaptions', { editUri, captionIds: [] });

  // ---- C: インスペクターの選択表示（登場を切り替える前後・退場タブ・テキストアニメ欄） ----
  const INSPECTOR = `document.querySelector('[data-akari-ui="panel:inspector"]')`;
  const pressedState = async () => evaluate(main, `(() => {
    const root = ${INSPECTOR}; if (!root) return null;
    const panel = root.querySelector('.akari-caption-motion-panel');
    const switcher = [...(panel?.querySelectorAll('.akari-caption-motion-switch button') ?? [])]
      .map(button => ({ label: button.textContent.trim(), pressed: button.getAttribute('aria-pressed') }));
    const pressed = [...(panel?.querySelectorAll('.akari-caption-motion-card[aria-pressed="true"]') ?? [])]
      .map(card => ({ kind: card.dataset.motionKind, id: card.dataset.motionId, slot: card.dataset.motionSlot ?? null,
        animation: card.dataset.motionAnimation, label: card.textContent.trim() }));
    return { hasPanel: Boolean(panel), switcher, pressed };
  })()`);
  const readAnimation = async id => {
    const document = JSON.parse(await readFile(captionsPath, 'utf8'));
    const rowsRead = Array.isArray(document) ? document : document.captions;
    return rowsRead.find(row => row.id === id)?.text_style?.animation ?? null;
  };
  const panelShot = async name => {
    const rect = await evaluate(main, `(() => { const root = ${INSPECTOR}; if (!root) return null;
      const box = root.getBoundingClientRect(); return { x: box.x, y: box.y, width: box.width, height: Math.min(box.height, 980) }; })()`);
    return screenshot(`${label}-inspector-${name}`, rect ? { x: Math.max(0, rect.x - 4), y: Math.max(0, rect.y - 4), width: rect.width + 8, height: rect.height + 8 } : undefined);
  };
  const clickCard = async selector => {
    const ok = await evaluate(main, `(() => { const card = ${INSPECTOR}?.querySelector(${JSON.stringify(selector)});
      if (!card) return false; card.scrollIntoView({ block: 'center' }); card.click(); return true; })()`);
    await sleep(2500);
    return ok;
  };
  const inspectorSteps = [];
  const step = async name => {
    inspectorSteps.push({ name, pressed: await pressedState(), saved: await readAnimation(inspectorRow.captionId), file: await panelShot(name) });
  };
  report.steps.selectInspectorRow = await executeCommand('akari.timeline.selectCaptions', { editUri, captionIds: [inspectorRow.captionId] });
  await inView(`(() => { window.postMessage({ type: 'akari-preview-seek', time: ${inspectorRow.start + 1.5} }, '*'); return true; })()`);
  await sleep(2000);
  report.steps.motionTab = await evaluate(main, `(() => { const button = ${INSPECTOR}?.querySelector('[data-akari-ui="tab:inspector-motion"]');
    if (!button || button.disabled) return false; button.click(); return true; })()`);
  await sleep(1500);
  await step('1-initial-in-tab');
  report.steps.clickInSlide = await clickCard('.akari-caption-motion-card[data-motion-kind="slot"][data-motion-id="slide-up"]');
  await step('2-after-in-slide-up');
  report.steps.clickOutTab = await evaluate(main, `(() => { const button = [...(${INSPECTOR}?.querySelectorAll('.akari-caption-motion-switch button') ?? [])]
    .find(value => value.textContent.trim() === '退場'); if (!button) return false; button.click(); return true; })()`);
  await sleep(1500);
  await step('3-out-tab');
  report.steps.clickTextanimFade = await clickCard('.akari-caption-motion-card[data-motion-kind="textanim"][data-motion-id="fade-in-out"]');
  await step('4-out-tab-textanim-fade');
  report.steps.clickOutWipe = await clickCard('.akari-caption-motion-card[data-motion-kind="slot"][data-motion-id="wipe"]');
  await step('5-out-tab-wipe');
  report.steps.inspector = inspectorSteps;
  await screenshot(`${label}-window-end`);
} catch (error) {
  report.error = scrubText(error?.stack ?? error?.message ?? String(error));
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

report.console = [...new Set(consoleLines.map(scrubText))].filter(line => /caption|textanim|anim|motion/i.test(line)).slice(0, 30);
await writeFile(path.join(outDir, `${label}-preview.json`), `${scrubText(JSON.stringify(report, null, 2))}\n`);
console.log(JSON.stringify({ error: report.error ?? null, playback: report.steps.playback?.length ?? 0,
  selected: report.steps.selectedPlayback?.length ?? 0, inspector: report.steps.inspector?.map(step => ({ name: step.name, pressed: step.pressed?.pressed, saved: step.saved })) }, null, 2));
if (report.error) process.exitCode = 1;
