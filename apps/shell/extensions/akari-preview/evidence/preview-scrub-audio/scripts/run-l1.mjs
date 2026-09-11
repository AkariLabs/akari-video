#!/usr/bin/env node
/**
 * L1（実機 Electron・GPU 有効）— 出力プレビュー（preview-server の <video> 要素経路 = ?frameEngine=0）で
 * タイムラインのシーク（WebSocket 経由 `{ type: 'seek', time }`）を 30 Hz で流し、スクラブ音の候補
 * A / B / C を同じ土俵で実測する（スパイク票「出力プレビューのスクラブ音」手順 1〜4）。
 *
 *  - 素材: mktemp 配下に ffmpeg lavfi で合成（1080p30 H.264 + AAC 48 kHz・3 分・1 秒ごとに半音上がる階段音 +
 *    drawtext タイムコード）。BGM は同じ階段を 2 オクターブ下 + 6 Hz トレモロ（別音色）で AAC (m4a)。
 *    素材ファイル自体は証跡に入れない（生成コマンドを fixture.json に残す）
 *  - 録音タップ: ページ読込前に AudioContext / AudioNode.connect を差し替え、destination へ向かう接続を
 *    tap GainNode へ迂回させる。tap → AudioWorklet（scrub-rec）で全出力をモノラル float で受け、16 bit wav に落とす
 *  - 駆動: Node 側から preview-server の WebSocket に `{ type: 'seek', time }` を 30 Hz で送る（サーバが webview へ中継）
 *  - 計測: 各 seek の到達時刻（ページ側 audioContext.currentTime）と録音の音程一致から遅延を出す（analyze.mjs）。
 *    CPU は ps の累積 CPU 時間の差分を 200 ms 間隔で取る
 *
 * 隔離: AKARI_HOME / --user-data-dir / プロジェクトはすべて mktemp 配下。Electron は detached にせず、同時 1 本。
 * 終了時に PID 指名で kill し、残存 0 件を確認してから一時ディレクトリを削除する。
 *
 * 検証専用スクリプト（製品コードではない・ラッパーが検証のために書いた）。
 * 使い方: node run-l1.mjs [--modes=off,A,B,C] [--patterns=a,b,c] [--keep-tmp]
 */
import assert from 'node:assert/strict';
import { exec, execSync, spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { analyzeRun, writeSummaryMarkdown } from './analyze.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const evidenceDir = path.resolve(here, '..');
const repoRoot = path.resolve(here, '../../../../../../..');
const shellRoot = path.join(repoRoot, 'apps/shell');
const previewServerDir = path.join(repoRoot, 'packages/preview-server');
const FFMPEG = path.join(repoRoot, 'packages/media-bin/vendor/darwin-arm64/ffmpeg');
const FFPROBE = path.join(repoRoot, 'packages/media-bin/vendor/darwin-arm64/ffprobe');
const bootScripts = path.join(shellRoot, 'extensions/akari-preview/evidence/frame-engine-boot/scripts');
const { CDP, evalOn, listTargets, waitFor } = await import(path.join(bootScripts, 'cdp-lib.mjs'));

const ELECTRON_BIN = [
  path.join(repoRoot, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'),
  path.join(shellRoot, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'),
].find(candidate => fs.existsSync(candidate));
assert.ok(ELECTRON_BIN, 'Electron binary not found');

const args = process.argv.slice(2);
const opt = (name, fallback) => (args.find(a => a.startsWith(`--${name}=`)) ?? '').slice(name.length + 3) || fallback;
const MODES = opt('modes', 'off,A,B,C').split(',');
const PATTERN_KEYS = opt('patterns', 'a,b,c,d').split(',');
const keepTmp = args.includes('--keep-tmp');

// 階段音: 1 秒ごとに半音ずつ上がり 12 秒で 1 周。周波数を整数 Hz に丸めると sin(2π f t) が
// 整数秒の境界で位相 0 になり、境界で位相が飛ばない（= 素材側にクリックが無い）。
const MAIN_TABLE = Array.from({ length: 12 }, (_, k) => Math.round(440 * 2 ** (k / 12)));
const BGM_TABLE = Array.from({ length: 12 }, (_, k) => Math.round(110 * 2 ** (k / 12)));
const DURATION_S = 180;
const FPS = 30;
const TICK_HZ = 30;
const FRAGMENT_MS = 40;
const PATTERNS = {
  a: { label: 'slow: 0 → 20 s in 10 s (≈67 ms/tick)', seconds: 10, recordSec: 10, timeAt: (i, n) => 20 * i / n },
  b: { label: 'fast: 0 → 120 s in 3 s (≈1.3 s/tick)', seconds: 3, recordSec: 4, timeAt: (i, n) => 120 * i / n },
  c: { label: 'back-and-forth: 30 ↔ 35 s for 6 s (3 round trips)', seconds: 6, recordSec: 7, timeAt: (i, n) => {
    const period = n / 3;
    const phase = (i % period) / period;
    const tri = phase < 0.5 ? phase * 2 : 2 - phase * 2;
    return 30 + 5 * tri;
  } },
  // 契約外の追加: 5 Hz（200 ms 間隔）なら次の seek に追い越されないので、A / B の media 要素の
  // 「シーク完了までの時間」と 1 断片の素の遅延がそのまま測れる（30 Hz では次の seek が先に来て superseded になる）。
  d: { label: 'slow-rate: 0 → 20 s in 4 s at 5 Hz (no supersede)', seconds: 4, recordSec: 5, tickHz: 5, timeAt: (i, n) => 20 * i / n },
};

// ------------------------------------------------------------------ helpers
const work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'akari-l1-scrub-audio-')));
const project = path.join(work, 'project');
const akariHome = path.join(work, 'akari-home');
const userDataDir = path.join(work, 'electron-user-data');
for (const dir of [project, path.join(project, 'assets'), akariHome, userDataDir]) fs.mkdirSync(dir, { recursive: true });
const scrub = value => String(value)
  .split(repoRoot).join('<WORKTREE>').split(work).join('<TMP>')
  .split(fs.realpathSync(os.tmpdir())).join('<TMP>').split(os.tmpdir()).join('<TMP>')
  .split(os.homedir()).join('<HOME>');
const round1 = v => Math.round(v * 10) / 10;
// 要求の分類: 本編 media への Range 取得（C の断片 fetch / media 要素の部分取得）と、preview-audio sidecar（前処理の産物）への要求。
const summarizeRequests = requests => {
  const summary = { total: requests.length, mediaRange: 0, mediaFull: 0, previewAudioApi: 0, sidecarPcm: 0, other: 0 };
  for (const r of requests) {
    if (/\/api\/preview-audio/.test(r.path)) summary.previewAudioApi++;
    else if (/\.pcm$|preview-audio\//.test(r.path)) summary.sidecarPcm++;
    else if (/\/assets\/.*\.(mp4|m4a|mov|mkv|webm)$/i.test(r.path)) { if (r.range) summary.mediaRange++; else summary.mediaFull++; }
    else summary.other++;
  }
  return summary;
};
const psLines = () => execSync('ps -eo pid,ppid,%cpu,time,args', { encoding: 'utf8' }).trim().split('\n').slice(1);
const psCount = needle => psLines().filter(line => line.includes(needle)).length;
const parsePsTime = text => {
  const parts = text.trim().split(':').map(Number).reverse();
  return (parts[0] ?? 0) + (parts[1] ?? 0) * 60 + (parts[2] ?? 0) * 3600;
};
async function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => { const { port } = probe.address(); probe.close(() => resolve(port)); });
  });
}
async function waitForHttp(url, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { const r = await fetch(url, { signal: AbortSignal.timeout(1000) }); if (r.ok) return; } catch { /* retry */ }
    await sleep(100);
  }
  throw new Error(`server not ready: ${url}`);
}
function writeWav(file, int16, sampleRate) {
  const header = Buffer.alloc(44);
  const dataBytes = int16.length * 2;
  header.write('RIFF', 0); header.writeUInt32LE(36 + dataBytes, 4); header.write('WAVE', 8);
  header.write('fmt ', 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24); header.writeUInt32LE(sampleRate * 2, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
  header.write('data', 36); header.writeUInt32LE(dataBytes, 40);
  fs.writeFileSync(file, Buffer.concat([header, Buffer.from(int16.buffer, int16.byteOffset, dataBytes)]));
}

// ------------------------------------------------------------------ fixture
const fixture = { generatedAt: new Date().toISOString(), mainTableHz: MAIN_TABLE, bgmTableHz: BGM_TABLE, durationSec: DURATION_S, commands: [] };
const ffmpeg = (label, fargs) => {
  const full = ['-hide_banner', '-loglevel', 'error', '-y', ...fargs];
  fixture.commands.push({ label, command: `ffmpeg ${full.map(scrub).join(' ')}` });
  const started = Date.now();
  const result = spawnSync(FFMPEG, full, { encoding: 'utf8' });
  assert.equal(result.status, 0, `${label}: ${result.stderr}`);
  return Date.now() - started;
};
const mainExpr = `0.5*sin(2*PI*t*round(440*pow(2,mod(floor(t),12)/12)))`;
const bgmExpr = `(0.35+0.15*sin(2*PI*6*t))*sin(2*PI*t*round(110*pow(2,mod(floor(t),12)/12)))`;
const fontFile = ['/System/Library/Fonts/Helvetica.ttc', '/System/Library/Fonts/Supplemental/Arial.ttf'].find(f => fs.existsSync(f));
console.log('[fixture] encoding 1080p30 H.264 + AAC 3 min …');
fixture.mainEncodeMs = ffmpeg('main (1080p30 H.264 + AAC 48 kHz stereo, semitone staircase, drawtext timecode)', [
  '-f', 'lavfi', '-i', `testsrc2=size=1920x1080:rate=${FPS}`,
  '-f', 'lavfi', '-i', `aevalsrc=exprs='${mainExpr}|${mainExpr}':s=48000:c=stereo`,
  '-t', String(DURATION_S),
  ...(fontFile ? ['-vf', `drawtext=fontfile=${fontFile}:text='%{pts\\:hms}':fontsize=110:fontcolor=white:box=1:boxcolor=black@0.6:x=(w-tw)/2:y=h-th-80`] : []),
  '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '23', '-pix_fmt', 'yuv420p', '-g', String(FPS),
  '-c:a', 'aac', '-b:a', '128k', '-ar', '48000', '-movflags', '+faststart',
  path.join(project, 'assets/main.mp4'),
]);
fixture.bgmEncodeMs = ffmpeg('bgm (AAC m4a, same staircase two octaves down + 6 Hz tremolo)', [
  '-f', 'lavfi', '-i', `aevalsrc=exprs='${bgmExpr}':s=48000:c=mono`, '-t', String(DURATION_S),
  '-c:a', 'aac', '-b:a', '96k', path.join(project, 'assets/bgm.m4a'),
]);
const probe = spawnSync(FFPROBE, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', path.join(project, 'assets/main.mp4')], { encoding: 'utf8' });
assert.equal(probe.status, 0, probe.stderr);
const probed = JSON.parse(probe.stdout);
fixture.ffprobe = {
  streams: probed.streams.map(s => ({ codec_type: s.codec_type, codec_name: s.codec_name, profile: s.profile, width: s.width, height: s.height,
    r_frame_rate: s.r_frame_rate, sample_rate: s.sample_rate, channels: s.channels, duration: s.duration, bit_rate: s.bit_rate })),
  format: { format_name: probed.format.format_name, duration: probed.format.duration, size: probed.format.size },
};
assert.ok(fixture.ffprobe.streams.some(s => s.codec_type === 'audio' && s.codec_name === 'aac' && s.sample_rate === '48000'), 'main.mp4 must carry AAC 48 kHz');
// v2 形式（version 0 はサーバが拒む）。本編 1 本（in 0 → 180 s）+ BGM 1 本（同じ階段音・別音色・-6 dB）。
const edit = {
  version: 2,
  output: { width: 1920, height: 1080, fps: FPS },
  sources: [
    { id: 'main', path: 'assets/main.mp4', proxy: null },
    { id: 'a-bgm', path: 'assets/bgm.m4a', proxy: null },
  ],
  tracks: [
    { id: 'visual-main', lane: 'visual', items: [
      { id: 'cut-main', at: 0, duration: DURATION_S * FPS, source: { kind: 'media', src: 'main', in: 0, out: DURATION_S } }] },
    { id: 'audio-bgm', lane: 'audio', items: [
      { id: 'bgm', at: 0, duration: 0, role: 'bgm', source: { kind: 'media', src: 'a-bgm', in: 0 }, gain_db: -6 }] },
  ],
};
fs.writeFileSync(path.join(project, 'edit.json'), `${JSON.stringify(edit, null, 2)}\n`);
fixture.edit = edit;
console.log(`[fixture] main ${fixture.mainEncodeMs} ms / bgm ${fixture.bgmEncodeMs} ms; ffprobe audio = ${JSON.stringify(fixture.ffprobe.streams.find(s => s.codec_type === 'audio'))}`);

// ------------------------------------------------------------------ server + electron
const port = await freePort();
const cdpPort = await freePort();
const serverLogPath = path.join(work, 'server.log');
let serverLog = '';
const server = spawn('node', ['src/server.mjs', project, '--port', String(port), '--no-lint'], {
  cwd: previewServerDir, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, AKARI_HOME: akariHome },
});
server.stdout.on('data', c => { serverLog += c; });
server.stderr.on('data', c => { serverLog += c; });
const base = `http://127.0.0.1:${port}`;
await waitForHttp(`${base}/api/codec-info`);
console.log(`[server] preview-server on ${port}`);

let electronLog = '';
const electron = spawn(ELECTRON_BIN, [path.join(here, 'electron-main.cjs'), `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${userDataDir}`, '--no-sandbox'], {
  detached: false, stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, AKARI_HOME: akariHome, AKARI_SCRUB_URL: 'about:blank', ELECTRON_ENABLE_LOGGING: '0' },
});
electron.stdout.on('data', c => { electronLog += c; });
electron.stderr.on('data', c => { electronLog += c; });
const report = { startedAt: new Date().toISOString(), host: { platform: process.platform, arch: process.arch, node: process.version, cpus: os.cpus().length, model: os.cpus()[0]?.model, memGb: +(os.totalmem() / 2 ** 30).toFixed(1), loadAvgAtStart: os.loadavg().map(v => +v.toFixed(2)) },
  electron: { version: fs.readFileSync(path.join(path.dirname(path.dirname(path.dirname(path.dirname(ELECTRON_BIN)))), 'version'), 'utf8').trim() },
  fixture, tickHz: TICK_HZ, fragmentMs: FRAGMENT_MS, patterns: Object.fromEntries(Object.entries(PATTERNS).map(([k, p]) => [k, { label: p.label, seconds: p.seconds, recordSec: p.recordSec, tickHz: p.tickHz ?? TICK_HZ }])), runs: [] };
let cdp;
let cleanupDone = false;
async function cleanup() {
  if (cleanupDone) return;
  cleanupDone = true;
  try { cdp?.close(); } catch { /* noop */ }
  const electronPid = electron.pid;
  const exited = new Promise(resolve => { if (electron.exitCode !== null) resolve(); else electron.once('exit', resolve); });
  try { electron.kill('SIGTERM'); } catch { /* already gone */ }
  await Promise.race([exited, sleep(5000)]);
  if (electron.exitCode === null) { try { electron.kill('SIGKILL'); } catch { /* noop */ } await sleep(500); }
  // 子プロセス（renderer / GPU / utility）は user-data-dir を引数に持つ。指名で kill して 0 件を確認する。
  for (let attempt = 0; attempt < 10 && psCount(userDataDir) > 0; attempt++) {
    for (const line of psLines().filter(l => l.includes(userDataDir))) { const pid = Number(line.trim().split(/\s+/)[0]); if (pid && pid !== process.pid) { try { process.kill(pid, 'SIGKILL'); } catch { /* noop */ } } }
    await sleep(300);
  }
  try { server.kill('SIGTERM'); } catch { /* noop */ }
  await sleep(300);
  report.cleanup = {
    electronPid, electronExitCode: electron.exitCode, electronSignal: electron.signalCode,
    survivingElectronProcesses: psCount(userDataDir),
    survivingElectronMainScript: psCount('electron-main.cjs'),
    survivingShellBackend: psCount(path.join(shellRoot, 'lib/backend/main.js')),
    survivingPreviewServer: psCount(`src/server.mjs ${project}`),
  };
  try { fs.writeFileSync(serverLogPath, serverLog); } catch { /* noop */ }
}
process.on('SIGINT', async () => { await cleanup(); process.exit(130); });

try {
  const pageTarget = await waitFor('electron page target', async () => (await listTargets(cdpPort)).find(t => t.type === 'page'), 30000, 250);
  cdp = new CDP(pageTarget.webSocketDebuggerUrl);
  await cdp.connect();
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  // 前処理なしの証拠: ページが出す HTTP 要求を全部記録する（Range 付き media 取得か / preview-audio sidecar (.pcm) を触っていないか）。
  await cdp.send('Network.enable');
  const networkLog = [];
  cdp.on('Network.requestWillBeSent', p => {
    const headers = p.request?.headers ?? {};
    const range = headers.Range ?? headers.range ?? null;
    let pathname = p.request?.url ?? '';
    try { pathname = new URL(p.request.url).pathname; } catch { /* keep raw */ }
    networkLog.push({ at: performance.now(), path: pathname, method: p.request?.method ?? 'GET', range, type: p.type ?? null });
  });
  // 録音の base64 化（最大 10 秒 = 約 1.3 MB の文字列）は既定 20 s の CDP タイムアウトでは足りないことがあるので長めに待つ。
  const evalOnLong = async (expression, timeoutMs = 90000) => {
    const response = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, timeoutMs);
    if (response.exceptionDetails) throw new Error(`evaluate failed: ${JSON.stringify(response.exceptionDetails).slice(0, 1200)}`);
    return response.result.value;
  };
  const consoleLog = globalThis.__consoleLog = [];
  cdp.on('Runtime.consoleAPICalled', p => { consoleLog.push({ type: p.type, text: p.args.map(a => a.value ?? a.description ?? '').join(' ').slice(0, 300) }); });
  cdp.on('Runtime.exceptionThrown', p => { consoleLog.push({ type: 'exception', text: String(p.exceptionDetails?.exception?.description ?? p.exceptionDetails?.text).slice(0, 500) }); });
  // ページが作り直された（reload / crash）ときの手掛かり。
  for (const event of ['Page.frameNavigated', 'Page.loadEventFired', 'Runtime.executionContextsCleared', 'Inspector.targetCrashed', 'Page.frameRequestedNavigation']) {
    cdp.on(event, params => consoleLog.push({ type: event, at: new Date().toISOString(), text: JSON.stringify(params ?? {}).slice(0, 300) }));
  }
  await cdp.send('Inspector.enable').catch(() => undefined);

  // 録音タップ: destination へ向かう connect() を tap GainNode へ迂回（ページのスクリプトより前に仕込む）。
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
    const OrigCtx = window.AudioContext;
    const origConnect = AudioNode.prototype.connect;
    window.__scrubTap = { contexts: [], origConnect };
    class TappedAudioContext extends OrigCtx {
      constructor(...a) {
        super(...a);
        const tap = new GainNode(this);
        origConnect.call(tap, this.destination);
        this.__tap = tap;
        window.__scrubTap.contexts.push(this);
      }
    }
    window.AudioContext = TappedAudioContext;
    window.webkitAudioContext = TappedAudioContext;
    AudioNode.prototype.connect = function (dest, ...rest) {
      if (dest instanceof AudioDestinationNode && dest.context.__tap && this !== dest.context.__tap && !this.__isTapRecorder) {
        return origConnect.call(this, dest.context.__tap, ...rest);
      }
      return origConnect.call(this, dest, ...rest);
    };
  })();` });
  await cdp.send('Page.navigate', { url: `${base}/?frameEngine=0` });
  const readyExpr = `(() => {
    const v = document.getElementById('preview-video');
    return { href: location.href, akari: !!window.akari, scrubAudio: !!window.akari?.scrubAudio, baseAudio: !!window.akari?.baseAudioDebug?.context,
      bgmNode: !!window.akari?.audioDebug?.bgmNode, bgmBuffer: !!window.akari?.audioDebug?.bgmNode?._buffer, videoReadyState: v?.readyState ?? -1, videoSrc: v?.currentSrc ?? null,
      ok: !!(window.akari && window.akari.scrubAudio && window.akari.baseAudioDebug && window.akari.baseAudioDebug.context
        && window.akari.audioDebug && window.akari.audioDebug.bgmNode && window.akari.audioDebug.bgmNode._buffer && v && v.readyState >= 1) };
  })()`;
  try {
    await waitFor('preview app ready (scrubAudio + base audio graph + bgm buffer + video metadata)', async () => (await evalOn(cdp, readyExpr)).ok, 90000, 250);
  } catch (error) {
    const diag = await evalOn(cdp, readyExpr).catch(e => ({ evalError: String(e) }));
    console.error('[diag] ready state:', JSON.stringify(diag));
    console.error('[diag] console:', JSON.stringify(consoleLog.slice(0, 40)));
    throw error;
  }
  const pageInfo = await evalOn(cdp, `(() => {
    const ctx = window.akari.baseAudioDebug.context;
    const v = document.getElementById('preview-video');
    const b = window.akari.audioDebug.bgmNode._buffer;
    return { sampleRate: ctx.sampleRate, baseLatency: ctx.baseLatency, outputLatency: ctx.outputLatency, state: ctx.state, tapped: !!ctx.__tap,
      videoSrc: v.currentSrc, videoDuration: v.duration, videoReadyState: v.readyState, bgmDuration: b.duration, bgmChannels: b.numberOfChannels,
      userAgent: navigator.userAgent, hasAudioDecoder: typeof AudioDecoder === 'function', scrubMode: window.akari.scrubAudio.mode,
      devicePixelRatio: devicePixelRatio, innerSize: [innerWidth, innerHeight] };
  })()`);
  pageInfo.videoSrc = scrub(pageInfo.videoSrc);
  report.page = pageInfo;
  console.log('[page]', JSON.stringify(pageInfo));
  assert.ok(pageInfo.tapped, 'AudioContext tap must be installed');
  assert.equal(pageInfo.scrubMode, 'off', 'scrub audio must default to off');

  // 録音ワークレット（tap → worklet → destination。worklet の出力は無音。入力を mono 化して 100 ms ごとに main へ送る）。
  // ページが作り直されたとき（reload / renderer 復帰）にも入れ直せるよう関数にしておく。
  const installRecorder = () => evalOn(cdp, `(async () => {
    const ctx = window.akari.baseAudioDebug.context;
    const code = \`class Rec extends AudioWorkletProcessor {
      constructor() { super(); this.buf = []; this.n = 0; this.startFrame = -1; this.port.onmessage = e => { if (e.data === 'flush') this.flush(); }; }
      flush() {
        if (this.n > 0) { const out = new Float32Array(this.n); let o = 0; for (const b of this.buf) { out.set(b, o); o += b.length; }
          this.port.postMessage({ frame: this.startFrame, samples: out }, [out.buffer]); }
        this.buf = []; this.n = 0; this.startFrame = -1;
      }
      process(inputs) {
        const inp = inputs[0]; const len = 128; const mono = new Float32Array(len);
        if (inp && inp.length) { for (const ch of inp) for (let i = 0; i < len; i++) mono[i] += ch[i]; for (let i = 0; i < len; i++) mono[i] /= inp.length; }
        if (this.startFrame < 0) this.startFrame = currentFrame;
        this.buf.push(mono); this.n += len; if (this.n >= 4800) this.flush();
        return true;
      }
    }
    registerProcessor('scrub-rec', Rec);\`;
    const url = URL.createObjectURL(new Blob([code], { type: 'application/javascript' }));
    await ctx.audioWorklet.addModule(url);
    const node = new AudioWorkletNode(ctx, 'scrub-rec', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
    node.__isTapRecorder = true;
    window.__scrubTap.origConnect.call(ctx.__tap, node);
    window.__scrubTap.origConnect.call(node, ctx.destination);
    const rec = window.__rec = { node, chunks: [], recording: false, clock: [], timer: 0 };
    node.port.onmessage = e => { if (rec.recording) rec.chunks.push(e.data); };
    rec.start = async () => {
      if (ctx.state !== 'running') await ctx.resume();
      rec.chunks = []; rec.clock = []; rec.recording = true;
      rec.startCtxSec = ctx.currentTime; rec.startPerfMs = performance.now();
      rec.timer = setInterval(() => { const ts = ctx.getOutputTimestamp(); rec.clock.push({ perfMs: performance.now(), ctxSec: ctx.currentTime, outCtx: ts.contextTime, outPerf: ts.performanceTime, state: ctx.state }); }, 100);
    };
    rec.stop = async () => {
      clearInterval(rec.timer);
      node.port.postMessage('flush'); await new Promise(r => setTimeout(r, 150));
      rec.recording = false;
      const chunks = rec.chunks.slice().sort((x, y) => x.frame - y.frame);
      let total = 0; const gaps = [];
      for (let i = 0; i < chunks.length; i++) { total += chunks[i].samples.length; if (i > 0) { const expected = chunks[i - 1].frame + chunks[i - 1].samples.length; if (chunks[i].frame !== expected) gaps.push({ at: chunks[i].frame, missing: chunks[i].frame - expected }); } }
      const pcm = new Int16Array(total); let o = 0; let peak = 0;
      for (const c of chunks) for (let i = 0; i < c.samples.length; i++) { const s = Math.max(-1, Math.min(1, c.samples[i])); peak = Math.max(peak, Math.abs(s)); pcm[o++] = Math.round(s * 32767); }
      const bytes = new Uint8Array(pcm.buffer); let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
      return { sampleRate: ctx.sampleRate, firstFrame: chunks[0]?.frame ?? -1, frames: total, gaps, peak, startCtxSec: rec.startCtxSec, startPerfMs: rec.startPerfMs, clock: rec.clock, base64: btoa(bin), state: ctx.state };
    };
    return true;
  })()`);
  await installRecorder();
  await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => undefined);
  const shot = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 55 });
  fs.writeFileSync(path.join(evidenceDir, 'preview-in-electron.jpg'), Buffer.from(shot.data, 'base64'));

  // WebSocket で seek を送る（サーバが `{ type: 'seek', time }` を webview へ中継する経路）。
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', reject, { once: true }); });
  const sendSeek = time => ws.send(JSON.stringify({ type: 'seek', time }));

  // CPU サンプラ: ps の累積 CPU 時間の差分（200 ms 間隔）。role は Chromium の --type / utility-sub-type から。
  const roleOf = line => {
    if (line.includes('src/server.mjs')) return 'preview-server';
    if (!line.includes(userDataDir) && !line.includes('electron-main.cjs')) return null;
    if (line.includes('--type=renderer')) return 'renderer';
    if (line.includes('--type=gpu-process')) return 'gpu';
    if (line.includes('audio.mojom.AudioService')) return 'audio-service';
    if (line.includes('--type=utility')) return 'utility-other';
    if (line.includes('--type=')) return 'other';
    return 'browser-main';
  };
  // 非同期で ps を叩く（execSync だとイベントループが 50〜100 ms 止まり、30 Hz の seek 送信が団子になって
  // preview-server の mini-ws が 1 TCP チャンク中の 2 個目以降のフレームを落とす — 実測 90 発中 16 発欠落）。
  const parseCpu = (text, now) => text.trim().split('\n').slice(1).map(line => {
    const m = line.trim().match(/^(\d+)\s+(\d+)\s+([\d.]+)\s+(\S+)\s+(.*)$/);
    if (!m) return null;
    const role = roleOf(m[5]);
    if (!role) return null;
    return { t: now, pid: Number(m[1]), role, cpuPct: Number(m[3]), cpuSec: parsePsTime(m[4]) };
  }).filter(Boolean);
  let cpuInFlight = false;
  const sampleCpuAsync = sink => {
    if (cpuInFlight) return;
    cpuInFlight = true;
    const now = performance.now();
    exec('ps -eo pid,ppid,%cpu,time,args', { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }, (error, stdout) => {
      cpuInFlight = false;
      if (!error) sink.push(...parseCpu(stdout, now));
    });
  };
  const sampleCpu = () => parseCpu(execSync('ps -eo pid,ppid,%cpu,time,args', { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }), performance.now());

  for (const mode of MODES) {
    for (const key of PATTERN_KEYS) {
      const pattern = PATTERNS[key];
      const tickHz = pattern.tickHz ?? TICK_HZ;
      const n = pattern.seconds * tickHz;
      const runId = `${mode}-${key}`;
      console.log(`[run] ${runId}: ${pattern.label}`);
      const runStartedAt = performance.now();
      try {
      // 直前の run でページが作り直されていたら録音タップを入れ直す（__rec が消えている）。
      const recorderAlive = await evalOn(cdp, `!!(window.__rec && window.akari && window.akari.scrubAudio)`).catch(() => false);
      if (!recorderAlive) {
        console.warn(`[run] ${runId}: recorder missing (page recreated?) — waiting for app and reinstalling`);
        await waitFor('preview app ready again', async () => (await evalOn(cdp, readyExpr)).ok, 90000, 250);
        await installRecorder();
      }
      await evalOn(cdp, `(async () => { const s = window.akari.scrubAudio; s.mode = ${JSON.stringify(mode)}; s.fragmentMs = ${FRAGMENT_MS}; s.reset();
        const ctx = window.akari.baseAudioDebug.context; if (ctx.state !== 'running') await ctx.resume(); return s.mode; })()`);
      if (mode === 'C') {
        // moov の取得は mode=C にした時 or 最初の seek で 1 回。計測に混ぜないよう、先に 1 回だけ seek して完了を待つ（プレビューを開いた時の 1 回に相当）。
        sendSeek(0.5);
        await sleep(1500);
        await evalOn(cdp, `window.akari.scrubAudio.reset()`);
      }
      // 直前のモードの断片が残らないよう少し待ってから録音開始。
      await sleep(600);
      const samples = [];
      samples.push(...sampleCpu());
      const sampler = setInterval(() => sampleCpuAsync(samples), 200);
      await evalOn(cdp, `window.__rec.start()`);
      const started = performance.now();
      const sendTimes = [];
      for (let i = 0; i < n; i++) {
        const due = started + (i * 1000) / tickHz;
        const wait = due - performance.now();
        if (wait > 0) await sleep(wait);
        sendTimes.push(performance.now() - started);
        sendSeek(pattern.timeAt(i, n));
      }
      const remaining = pattern.recordSec * 1000 - (performance.now() - started);
      if (remaining > 0) await sleep(remaining);
      clearInterval(sampler);
      await sleep(250);
      samples.push(...sampleCpu());
      const recording = await evalOnLong(`window.__rec.stop()`);
      const stats = await evalOn(cdp, `window.akari.scrubAudio.stats()`);
      const requests = networkLog.filter(r => r.at >= runStartedAt).map(r => ({ ...r, at: round1(r.at - runStartedAt) }));
      const pcm = Buffer.from(recording.base64, 'base64');
      const int16 = new Int16Array(pcm.buffer, pcm.byteOffset, pcm.length / 2);
      // 契約: 各 ≤ 10 秒・16 bit。
      const maxFrames = pattern.recordSec * recording.sampleRate;
      const trimmed = int16.length > maxFrames ? int16.subarray(0, maxFrames) : int16;
      const wavName = `${runId}.wav`;
      writeWav(path.join(evidenceDir, wavName), trimmed, recording.sampleRate);
      const seeks = (stats.seeks ?? []).map(s => ({ ...s, src: s.src ? scrub(s.src) : s.src }));
      const run = { id: runId, mode, pattern: key, label: pattern.label, ticks: n, tickHz, sendJitterMs: { max: Math.max(...sendTimes.map((t, i) => Math.abs(t - i * 1000 / tickHz))) },
        wav: wavName, recording: { sampleRate: recording.sampleRate, firstFrame: recording.firstFrame, frames: trimmed.length, droppedTailFrames: int16.length - trimmed.length, gaps: recording.gaps, peak: recording.peak,
          startCtxSec: recording.startCtxSec, startPerfMs: recording.startPerfMs, clock: recording.clock, stateAtEnd: recording.state },
        stats: { ...stats, seeks }, cpu: samples,
        network: { requests, summary: summarizeRequests(requests) } };
      report.runs.push(run);
      console.log(`[run] ${runId}: seeks=${seeks.length} played=${stats.summary?.played} skipped=${stats.summary?.skipped} errors=${stats.summary?.errors} peak=${recording.peak.toFixed(3)} gaps=${recording.gaps.length} net=${JSON.stringify(run.network.summary)}`);
      await sleep(400);
      } catch (error) {
        // 1 run の失敗で全体を落とさない（前回は A-a の録音回収で CDP タイムアウト → 全滅した）。記録して次へ。
        const message = scrub(error?.stack ?? String(error));
        console.error(`[run] ${runId}: FAILED — ${message.split('\n')[0]}`);
        report.failedRuns = report.failedRuns ?? [];
        report.failedRuns.push({ id: runId, mode, pattern: key, error: message.slice(0, 800), consoleTail: consoleLog.slice(-10).map(e => ({ ...e, text: scrub(e.text) })) });
        try { await evalOn(cdp, `(() => { try { window.__rec && clearInterval(window.__rec.timer); window.__rec && (window.__rec.recording = false); window.akari?.scrubAudio?.stop?.(); } catch {} return true; })()`); } catch { /* page may be gone */ }
        await sleep(800);
      }
    }
  }
  ws.close();
  report.console = consoleLog.slice(0, 200).map(e => ({ ...e, text: scrub(e.text) }));
  // ページ読込〜全 run を通した要求の総覧（前処理の有無の証拠。sidecar (.pcm) / preview-audio API を webview が触ったか）。
  report.networkAll = { summary: summarizeRequests(networkLog), byPath: Object.entries(networkLog.reduce((acc, r) => { const key = `${r.method} ${r.path}${r.range ? ' [Range]' : ''}`; acc[key] = (acc[key] ?? 0) + 1; return acc; }, {})).sort((a, b) => b[1] - a[1]).slice(0, 40) };
  // 前処理禁止の確認: プロジェクト配下のキャッシュに本編 (main.mp4) 由来の sidecar / PCM が無いこと。
  const cacheDir = path.join(project, '.akari', 'cache');
  const listCache = dir => fs.existsSync(dir) ? fs.readdirSync(dir, { recursive: true }).map(f => ({ file: String(f), bytes: (() => { try { return fs.statSync(path.join(dir, String(f))).size; } catch { return null; } })() })) : [];
  report.projectCache = { dir: scrub(cacheDir), entries: listCache(cacheDir) };
  report.projectFilesAfterRun = fs.readdirSync(project, { recursive: true }).map(String).filter(f => !f.startsWith('.akari/cache')).sort();
} catch (error) {
  console.error('[harness] failed:', error?.stack ?? error);
  console.error('[harness] page console (tail):', JSON.stringify(report.consoleOnFailure = (globalThis.__consoleLog ?? []).slice(-40).map(e => ({ ...e, text: scrub(e.text) })), null, 1));
  process.exitCode = 1;
} finally {
  await cleanup();
}
report.finishedAt = new Date().toISOString();
report.serverLogTail = scrub(serverLog.slice(-4000));
report.electronLogTail = scrub(electronLog.slice(-2000));
if (process.exitCode === 1) {
  fs.writeFileSync(path.join(evidenceDir, 'l1-raw-failed.json'), `${JSON.stringify(report, null, 2)}\n`);
  process.exit(1);
}
if (report.failedRuns?.length) console.warn(`[harness] ${report.failedRuns.length} run(s) failed: ${report.failedRuns.map(r => r.id).join(', ')}`);
fs.writeFileSync(path.join(evidenceDir, 'l1-raw.json'), `${JSON.stringify(report, null, 2)}\n`);
const analysis = analyzeRun(report, evidenceDir);
fs.writeFileSync(path.join(evidenceDir, 'l1-results.json'), `${JSON.stringify(analysis, null, 2)}\n`);
writeSummaryMarkdown(analysis, path.join(evidenceDir, 'l1-summary.md'));
console.log(fs.readFileSync(path.join(evidenceDir, 'l1-summary.md'), 'utf8'));
console.log('[cleanup]', JSON.stringify(report.cleanup));
if (!keepTmp) fs.rmSync(work, { recursive: true, force: true });
