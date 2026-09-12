#!/usr/bin/env node
// L1 harness (wrapper-authored, verification-only; not product source).
// task 2026-09-12-review-session-viewer 指示 6 の L1。
//
// 実機 Electron で
//   1. 注釈パネルのセッション行「見返す」→ ビューアが右パネルに開く
//   2. ビューアの差分が「移動 1 件」（録音時点の edit.snapshot.json → 現在の edit.json で
//      cut-2 の at だけを動かした fixture）
//   3. 発話行の対象表示（compile-proposals.json の target / sourceT）と再生位置ハイライト
//   4. 音声再生（実マウスの再生ボタン押下）で recT が進み、出力プレビューの #seek が
//      recT → timelineT の写像どおり追従する
//   5. プレイヘッド近傍の描線だけが出る（pen-layer の実ピクセルを 3 帯に分けて計測）
//   6. 原本 6 ファイルのバイト不変（sha256 を前後で照合）
// を計測して JSON + PNG で残す。
//
// AKARI_HOME / THEIA_CONFIG_DIR / --user-data-dir はすべて mkdtemp した一時ディレクトリへ
// 向けてあり、実利用の ~/.akari ~/.theia ~/.config/akari-video は読み書きしない。
// 終了時は自分が spawn した Electron の pid だけを指名 kill する（pkill -f Electron はしない）。
//
// usage: node run-l1.mjs [port]

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../../../../..');
const shellDir = path.join(repoRoot, 'apps', 'shell');
const electron = path.join(shellDir, 'node_modules', 'electron', 'dist',
  'Electron.app', 'Contents', 'MacOS', 'Electron');
const port = Number(process.argv[2] ?? 9488);

const scratch = await realpath(await mkdtemp(path.join(os.tmpdir(), 'akari-session-viewer-')));
const project = path.join(scratch, 'project');
const profile = path.join(scratch, 'profile');
const akariHome = path.join(scratch, 'akari-home');
await cp(path.join(repoRoot, 'test-project'), project, { recursive: true });
await Promise.all([mkdir(profile), mkdir(akariHome)]);
const editPath = path.join(project, 'edit.json');
const editUri = pathToFileURL(editPath).href;

// ---- fixture: 録音時点の edit.json（snapshot）と、そこから 1 本だけ動かした現在の edit.json ----
const baseEdit = JSON.parse(await readFile(editPath, 'utf8'));
const visual = baseEdit.tracks.find(track => track.id === 't1');
visual.items[1].at = 450;                       // 15.00s（snapshot 側）
const snapshotText = `${JSON.stringify(baseEdit, null, 2)}\n`;
visual.items[1].at = 480;                       // 16.00s（現在側）= 移動 1 件
await writeFile(editPath, `${JSON.stringify(baseEdit, null, 2)}\n`);

const sessionDir = path.join(project, 'review', 'sessions', 's-0001');
await mkdir(sessionDir, { recursive: true });
await writeFile(path.join(sessionDir, 'edit.snapshot.json'), snapshotText);

// events.jsonl: 0-3s 再生（timelineT 0→3）→ 一時停止 → 16s へ seek → 再生（16→19.5）
const events = [
  { recT: 0, type: 'start', timelineT: 0, playing: false },
  { recT: 0.5, type: 'play', timelineT: 0 },
  { recT: 1, type: 'tick', timelineT: 0.5 },
  { recT: 2, type: 'tick', timelineT: 1.5 },
  { recT: 3, type: 'tick', timelineT: 2.5 },
  { recT: 3.5, type: 'pause', timelineT: 3 },
  { recT: 4, type: 'seek', from: 3, to: 16 },
  { recT: 4.5, type: 'play', timelineT: 16 },
  { recT: 5, type: 'tick', timelineT: 16.5 },
  { recT: 6, type: 'tick', timelineT: 17.5 },
  { recT: 7, type: 'tick', timelineT: 18.5 },
  { recT: 8, type: 'end', timelineT: 19.5 }
];
await writeFile(path.join(sessionDir, 'events.jsonl'),
  `${events.map(event => JSON.stringify(event)).join('\n')}\n`);

// strokes.json: A = 左帯 / timelineT 1.5、B = 右帯 / timelineT 17.5（16s 離す = 窓 8s の外）
const band = (index, y) => Array.from({ length: 10 }, (unused, step) => [
  Number((index / 3 + 0.04 + (step / 9) * (1 / 3 - 0.08)).toFixed(4)), y
]);
await writeFile(path.join(sessionDir, 'strokes.json'), `${JSON.stringify({
  version: 1,
  strokes: [
    { id: 'st-0001', tool: 'pen', space: 'content-rect', recTStart: 1.4, recTEnd: 1.9,
      frame: { timelineT: 1.5, sourceT: 1.5, cutIndex: 0 }, points: band(0, 0.35) },
    { id: 'st-0002', tool: 'pen', space: 'content-rect', recTStart: 5.8, recTEnd: 6.2,
      frame: { timelineT: 17.5, sourceT: 7.5, cutIndex: 1 }, points: band(2, 0.55) }
  ]
}, null, 2)}\n`);

await writeFile(path.join(sessionDir, 'transcript.json'), `${JSON.stringify({
  version: 1, backend: 'fixture',
  segments: [
    { start: 1, end: 3, text: 'このカットが長いです' },
    { start: 5.5, end: 7.5, text: 'ここのテロップを大きくして' }
  ]
}, null, 2)}\n`);

await writeFile(path.join(sessionDir, 'compile-proposals.json'), `${JSON.stringify({
  version: 1, sessionId: 's-0001', backend: 'fixture',
  proposals: [
    { index: 0, transcript: 'このカットが長いです', recRange: [1, 3],
      reference: { target: 'cut:0', sourceT: 1.5, timelineT: 1.5, confidence: 'high',
        resolutionMethod: 'playing' }, provisional: null, decision: null },
    { index: 1, transcript: 'ここのテロップを大きくして', recRange: [5.5, 7.5],
      reference: { target: 'cut:1', sourceT: 7.5, timelineT: 17.5, confidence: 'low',
        resolutionMethod: 'scrub-unsettled' }, provisional: null, decision: null }
  ]
}, null, 2)}\n`);

// audio.wav: 16 kHz mono 16 bit の 8.5 秒トーン（実マイクは使わない）
const sampleRate = 16000;
const frames = Math.round(sampleRate * 8.5);
const pcm = Buffer.alloc(frames * 2);
for (let index = 0; index < frames; index += 1) {
  pcm.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 220 * index / sampleRate) * 8000), index * 2);
}
const header = Buffer.alloc(44);
header.write('RIFF', 0, 'ascii'); header.writeUInt32LE(36 + pcm.length, 4);
header.write('WAVE', 8, 'ascii'); header.write('fmt ', 12, 'ascii');
header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
header.writeUInt32LE(sampleRate, 24); header.writeUInt32LE(sampleRate * 2, 28);
header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
header.write('data', 36, 'ascii'); header.writeUInt32LE(pcm.length, 40);
await writeFile(path.join(sessionDir, 'audio.wav'), Buffer.concat([header, pcm]));

await writeFile(path.join(sessionDir, 'session.json'), `${JSON.stringify({
  version: 1, id: 's-0001',
  startedAt: '2026-09-12T05:00:00.000Z', endedAt: '2026-09-12T05:00:08.500Z',
  audio: 'audio.wav', editSnapshot: 'edit.snapshot.json',
  editHash: `sha256:${createHash('sha256').update(snapshotText).digest('hex')}`,
  status: 'transcribed', compiledAnnotations: null
}, null, 2)}\n`);

// s-0002: 文字起こし前（transcript.json なし）+ v0 の edit.snapshot.json
// = 「コンパイルがまだです」導線と「旧形式のため差分は出せません」の両方を実機で見る。
const legacyDir = path.join(project, 'review', 'sessions', 's-0002');
await mkdir(legacyDir, { recursive: true });
const legacySnapshot = `${JSON.stringify({
  version: 0,
  output: { width: 1280, height: 720, fps: 30 },
  source: { path: 'source.mp4', proxy: null },
  cuts: [{ in: 0, out: 5, transition_out: null }],
  overlays: [], layers: [], audio: { bgm: null, sfx: [] }
}, null, 2)}\n`;
await writeFile(path.join(legacyDir, 'edit.snapshot.json'), legacySnapshot);
await writeFile(path.join(legacyDir, 'events.jsonl'),
  `${JSON.stringify({ recT: 0, type: 'start', timelineT: 2, playing: false })}\n`
  + `${JSON.stringify({ recT: 3.2, type: 'end', timelineT: 2 })}\n`);
const legacyPcm = pcm.subarray(0, sampleRate * 2 * 3);
const legacyHeader = Buffer.from(header);
legacyHeader.writeUInt32LE(36 + legacyPcm.length, 4);
legacyHeader.writeUInt32LE(legacyPcm.length, 40);
await writeFile(path.join(legacyDir, 'audio.wav'), Buffer.concat([legacyHeader, legacyPcm]));
await writeFile(path.join(legacyDir, 'session.json'), `${JSON.stringify({
  version: 1, id: 's-0002',
  startedAt: '2026-09-12T05:10:00.000Z', endedAt: '2026-09-12T05:10:03.200Z',
  audio: 'audio.wav', editSnapshot: 'edit.snapshot.json',
  editHash: `sha256:${createHash('sha256').update(legacySnapshot).digest('hex')}`,
  status: 'recorded', compiledAnnotations: null
}, null, 2)}\n`);

const RAW_FILES = ['audio.wav', 'events.jsonl', 'strokes.json', 'edit.snapshot.json',
  'transcript.json', 'compile-proposals.json', 'session.json'];
const digestRaw = async () => Object.fromEntries(await Promise.all(RAW_FILES.map(async name => [
  name, createHash('sha256').update(await readFile(path.join(sessionDir, name))).digest('hex')
])));
const rawBefore = await digestRaw();

// ---- 証跡に作業機のパスを残さない（harness/wrapper-codex.md 2026-09-09 追記） ----
const sanitize = value => String(value)
  .split(scratch).join('<TMP>')
  .split(repoRoot).join('<WORKTREE>')
  .split(os.tmpdir()).join('<TMP>')
  .split(os.homedir()).join('<HOME>');
const observations = [];
const record = (step, data = {}) => {
  const entry = JSON.parse(sanitize(JSON.stringify({ step, ...data })));
  observations.push(entry);
  console.log(`[${step}]`, JSON.stringify(entry));
};

class CDP {
  constructor(url) { this.url = url; this.id = 0; this.pending = new Map(); }
  async connect() {
    this.socket = new WebSocket(this.url);
    await new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve, { once: true });
      this.socket.addEventListener('error', reject, { once: true });
    });
    this.socket.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      const pending = message.id && this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(JSON.stringify(message.error)));
      else pending.resolve(message.result);
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

const child = spawn(electron, [
  shellDir, project,
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${profile}`,
  '--no-sandbox'
], {
  env: { ...process.env, AKARI_HOME: akariHome, THEIA_CONFIG_DIR: profile },
  stdio: ['ignore', 'pipe', 'pipe']
});
child.stdout.on('data', chunk => process.stdout.write(`[electron] ${chunk}`));
child.stderr.on('data', chunk => process.stderr.write(`[electron!] ${chunk}`));
record('electron-spawned', { pid: child.pid });

let main;
let browser;
let view;
let failure;

const waitFor = async (label, predicate, timeoutMs = 90000) => {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    try { last = await predicate(); if (last) return last; }
    catch (error) { last = error instanceof Error ? error.message : String(error); }
    await sleep(250);
  }
  throw new Error(`timed out: ${label}; last=${JSON.stringify(last)?.slice(0, 400)}`);
};

const READ_VIEWER = `(() => {
  const widget = document.querySelector('[data-akari-ui="panel:session-viewer"]');
  if (!widget) return { mounted: false };
  const rows = [...widget.querySelectorAll('[data-viewer-utterance]')];
  return {
    mounted: true,
    header: widget.querySelector('[data-viewer-header]')?.textContent ?? null,
    time: widget.querySelector('[data-viewer-time]')?.textContent ?? null,
    audioMissing: widget.querySelector('[data-viewer-audio-missing]')?.textContent ?? null,
    audioReady: (() => {
      const audio = widget.querySelector('[data-viewer-audio]');
      return audio ? { hasSrc: Boolean(audio.currentSrc), currentTime: Number(audio.currentTime.toFixed(2)),
        paused: audio.paused, duration: Number.isFinite(audio.duration) ? Number(audio.duration.toFixed(2)) : null } : null;
    })(),
    utterances: rows.map(row => ({
      index: row.getAttribute('data-viewer-utterance'),
      active: row.hasAttribute('data-viewer-utterance-active'),
      low: row.hasAttribute('data-viewer-utterance-low'),
      at: row.querySelector('[data-viewer-utterance-time]')?.textContent ?? null,
      text: row.querySelector('[data-viewer-utterance-text]')?.textContent ?? null,
      target: row.querySelector('[data-viewer-utterance-target]')?.textContent ?? null
    })),
    transcriptEmpty: widget.querySelector('[data-viewer-transcript-empty]')?.textContent ?? null,
    diffSummary: widget.querySelector('[data-viewer-diff-summary]')?.textContent ?? null,
    diffLegacy: widget.querySelector('[data-viewer-diff-legacy]')?.textContent ?? null,
    diffRows: [...widget.querySelectorAll('[data-viewer-diff-row]')].map(row => ({
      item: row.getAttribute('data-viewer-diff-row'),
      kind: row.querySelector('[data-viewer-diff-kind]')?.textContent ?? null,
      detail: row.querySelector('[data-viewer-diff-detail]')?.textContent ?? null
    })),
    warnings: widget.querySelector('[data-viewer-warnings]')?.textContent ?? null
  };
})()`;

const findPreviewView = async (timeoutMs = 120000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const all = await browser.send('Target.getTargets').catch(() => undefined);
    for (const info of all?.targetInfos ?? []) {
      if (!['iframe', 'page', 'webview'].includes(info.type)) continue;
      if (!String(info.url ?? '').includes('webview')) continue;
      try {
        const { sessionId } = await browser.send('Target.attachToTarget',
          { targetId: info.targetId, flatten: true });
        await browser.send('Page.enable', {}, sessionId).catch(() => undefined);
        const tree = await browser.send('Page.getFrameTree', {}, sessionId);
        const frames = [];
        (function walk(node) { frames.push(node.frame); (node.childFrames ?? []).forEach(walk); })(tree.frameTree);
        for (const frame of frames) {
          try {
            const world = await browser.send('Page.createIsolatedWorld',
              { frameId: frame.id, worldName: 'akari-session-viewer' }, sessionId);
            const hit = await evaluate(browser,
              "Boolean(document.getElementById('preview-stage') && document.getElementById('pen-layer'))",
              world.executionContextId, sessionId);
            if (hit) return { sessionId, contextId: world.executionContextId };
          } catch { /* frame gone */ }
        }
      } catch { /* target changed */ }
    }
    await sleep(500);
  }
  throw new Error('preview webview context not found');
};

const inView = expression => evaluate(browser, expression, view.contextId, view.sessionId);

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
    for (let p = 3; p < data.length; p += 4) if (data[p] > 0) inkPixels += 1;
    bands.push(inkPixels);
  }
  return { bands, seek: Number(document.getElementById('seek').value),
    timeLabel: document.getElementById('time-label').textContent };
})())`).then(JSON.parse);

const clipShot = async (selector, file) => {
  const rect = await evaluate(main, `(() => {
    const node = document.querySelector(${JSON.stringify(selector)});
    if (!node) return null;
    const box = node.getBoundingClientRect();
    return { x: Math.floor(box.x), y: Math.floor(box.y),
      width: Math.ceil(box.width), height: Math.ceil(box.height) };
  })()`);
  if (!rect || rect.width < 1 || rect.height < 1) { record('screenshot-skipped', { selector }); return; }
  const { data } = await main.send('Page.captureScreenshot',
    { format: 'png', clip: { ...rect, scale: 1 }, captureBeyondViewport: false });
  await writeFile(path.join(here, file), Buffer.from(data, 'base64'));
};

const clickInMain = async selector => {
  const rect = await evaluate(main, `(() => {
    const node = document.querySelector(${JSON.stringify(selector)});
    if (!node) return null;
    const box = node.getBoundingClientRect();
    return { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) };
  })()`);
  if (!rect) throw new Error(`no element for ${selector}`);
  await main.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: rect.x, y: rect.y, button: 'none' });
  await main.send('Input.dispatchMouseEvent',
    { type: 'mousePressed', x: rect.x, y: rect.y, button: 'left', clickCount: 1 });
  await sleep(40);
  await main.send('Input.dispatchMouseEvent',
    { type: 'mouseReleased', x: rect.x, y: rect.y, button: 'left', clickCount: 1 });
  return rect;
};

try {
  const targets = await waitFor('devtools page target', async () => {
    const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json().catch(() => []);
    return list.find(target => target.type === 'page') ?? false;
  }, 120000);
  main = new CDP(targets.webSocketDebuggerUrl);
  await main.connect();
  await main.send('Page.enable');
  await main.send('Runtime.enable');
  const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
  browser = new CDP(version.webSocketDebuggerUrl);
  await browser.connect();
  await waitFor('theia ready', () => evaluate(main, 'Boolean(window.theia && window.theia.container)'), 120000);

  await evaluate(main, `(() => {
    window.__akariShell = () => {
      const keys = [...window.theia.container._bindingDictionary._map.keys()];
      const shellClass = keys.find(key => typeof key === 'function'
        && typeof key.prototype?.getCurrentWidget === 'function'
        && typeof key.prototype?.addWidget === 'function'
        && typeof key.prototype?.activateWidget === 'function');
      if (!shellClass) throw new Error('ApplicationShell binding not found');
      return window.theia.container.get(shellClass);
    };
    window.__akariCommand = async (id, argument) => {
      const keys = [...window.theia.container._bindingDictionary._map.keys()];
      const commandClass = keys.find(key => typeof key === 'function'
        && typeof key.prototype?.executeCommand === 'function'
        && typeof key.prototype?.registerCommand === 'function');
      await window.theia.container.get(commandClass).executeCommand(id, argument);
      return true;
    };
    return true;
  })()`);

  const tryCommand = async (id, argument, timeoutMs = 60000) => {
    const deadline = Date.now() + timeoutMs;
    let last = 'never attempted';
    while (Date.now() < deadline) {
      try {
        await evaluate(main, `window.__akariCommand(${JSON.stringify(id)}, ${JSON.stringify(argument ?? null)})`);
        return true;
      } catch (error) { last = error instanceof Error ? error.message : String(error); }
      await sleep(500);
    }
    record('command-failed', { id, error: String(last).slice(0, 200) });
    return false;
  };

  await tryCommand('akari.annotations.attachPassive');
  await tryCommand('akari.preview.ensureVisible', { editUri });
  await tryCommand('akari.review.open');
  await waitFor('timeline mounted',
    () => evaluate(main, "Boolean(document.querySelector('.akari-annotations-widget'))"), 120000);

  const panelRow = await waitFor('panel session row', () => evaluate(main, `(() => {
    const button = document.querySelector('[data-review-session-viewer="s-0001"]');
    return button ? { label: button.textContent, title: button.title } : false;
  })()`), 90000);
  record('panel-viewer-button', panelRow);
  await clipShot('.akari-review-panel-widget', 'l1-01-panel-viewer-button.png');

  // 1) 「見返す」でビューアが開く
  await clickInMain('[data-review-session-viewer="s-0001"]');
  const opened = await waitFor('viewer mounted', async () => {
    const state = await evaluate(main, READ_VIEWER);
    return state.mounted && state.utterances.length ? state : false;
  }, 90000);
  record('viewer-opened', opened);

  view = await findPreviewView();
  record('preview-view-attached', { attached: true });

  // 2) 発話 0（recT 1.0 → timelineT 0.5）へ移動 = プレイヘッド近傍の描線 A だけが出る
  await clickInMain('[data-viewer-utterance="0"]');
  await sleep(1500);
  const atFirst = await evaluate(main, READ_VIEWER);
  const inkFirst = await census();
  record('utterance-0-clicked', { viewer: atFirst, preview: inkFirst });
  await clipShot('[data-akari-ui="panel:session-viewer"]', 'l1-02-viewer-utterance-0.png');

  // 3) 実マウスで再生ボタンを押す（ユーザー操作 = autoplay ポリシーを満たす）
  await clickInMain('[data-viewer-play]');
  await sleep(2500);
  const playing = await evaluate(main, READ_VIEWER);
  const inkPlaying = await census();
  record('playing', { viewer: playing, preview: inkPlaying });
  await clipShot('[data-akari-ui="panel:session-viewer"]', 'l1-03-viewer-playing.png');
  await clickInMain('[data-viewer-play]');
  await sleep(600);
  record('paused', { viewer: await evaluate(main, READ_VIEWER) });

  // 4) 発話 1（recT 5.5 → timelineT 17.0）へ移動 = 描線 B だけが出る
  await clickInMain('[data-viewer-utterance="1"]');
  await sleep(1800);
  const atSecond = await evaluate(main, READ_VIEWER);
  const inkSecond = await census();
  record('utterance-1-clicked', { viewer: atSecond, preview: inkSecond });
  await clipShot('[data-akari-ui="panel:session-viewer"]', 'l1-04-viewer-utterance-1.png');

  // 5) 未コンパイル + v0 snapshot のセッション（s-0002）
  await tryCommand('akari.review.open');
  await waitFor('panel row s-0002',
    () => evaluate(main, "Boolean(document.querySelector('[data-review-session-viewer=\"s-0002\"]'))"), 60000);
  await clickInMain('[data-review-session-viewer="s-0002"]');
  const legacyView = await waitFor('viewer switched to s-0002', async () => {
    const state = await evaluate(main, READ_VIEWER);
    return state.mounted && String(state.header ?? '').includes('s-0002') ? state : false;
  }, 60000);
  record('legacy-session', legacyView);
  await clipShot('[data-akari-ui="panel:session-viewer"]', 'l1-05-viewer-legacy-session.png');

  // 6) 原本のバイト不変
  record('raw-invariant', {
    before: rawBefore, after: await digestRaw(),
    identical: JSON.stringify(rawBefore) === JSON.stringify(await digestRaw())
  });
} catch (error) {
  failure = error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error);
  record('failure', { message: sanitize(failure.split('\n')[0]) });
} finally {
  try { main?.close(); } catch { /* ignore */ }
  try { browser?.close(); } catch { /* ignore */ }
  if (child.pid !== undefined && child.exitCode === null) {
    child.kill('SIGTERM');
    await sleep(2500);
    if (child.exitCode === null) child.kill('SIGKILL');
    await sleep(1000);
  }
  await writeFile(path.join(here, 'l1-observations.json'),
    `${sanitize(JSON.stringify({ observations, failed: Boolean(failure) }, null, 2))}\n`);
}
if (failure) { console.error(failure); process.exitCode = 1; }
