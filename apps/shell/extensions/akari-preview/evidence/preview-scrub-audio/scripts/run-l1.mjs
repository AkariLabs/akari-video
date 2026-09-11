#!/usr/bin/env node
/**
 * L1（実機 Electron・GPU 有効）— 出力プレビュー（preview-server の <video> 要素経路 = ?frameEngine=0）で
 * タイムラインのシーク（WebSocket 経由 `{ type: 'seek', time }`）を流し、製品化したスクラブ音（C 案・既定 ON）を
 * `off` / `on` で実測する（製品化票「スクラブ音の製品化（C 案）」手順 8）。
 *
 *  - 素材（synthetic）: mktemp 配下に ffmpeg lavfi で合成（1080p30 H.264 + AAC 48 kHz・3 分・1 秒ごとに半音上がる階段音 +
 *    drawtext タイムコード）。BGM は同じ階段を 2 オクターブ下 + 6 Hz トレモロ（別音色）で AAC (m4a)
 *  - 素材（real・`--real=<file>`）: 実写 1 本を先頭 60 秒だけ 1080p30 H.264 + AAC-LC（音声はパケットをそのまま複製）へ切り出す。
 *    素材ファイル・元のパス・ファイル名は証跡に入れない（`fixture.real` には ffprobe の形式情報だけ残す）
 *  - 録音タップ: ページ読込前に AudioContext / AudioNode.connect を差し替え、destination へ向かう接続を
 *    tap GainNode へ迂回させる。tap → AudioWorklet（scrub-rec）で全出力をモノラル float で受け、16 bit wav に落とす
 *  - 計測フック（製品コードに計測 API を置かないため、ページ側で差し替える）:
 *      · `window.akari.scrubAudio.onSeek` をラップして seek 到達時刻（audioContext.currentTime）を記録
 *      · `AudioBufferSourceNode.prototype.start` をラップして断片の予約時刻 / offset / duration を記録
 *      · `AudioContext.prototype.suspend / resume` をラップして idle suspend の発火を記録
 *  - 駆動: Node 側から preview-server の WebSocket に `{ type: 'seek', time }` を送る（サーバが webview へ中継）
 *  - HTTP 要求: CDP `Network.requestWillBeSent` で全件記録（Range / 全量 / sidecar / moov の回数）
 *
 * 隔離: AKARI_HOME / --user-data-dir / プロジェクトはすべて mktemp 配下。Electron は detached にせず、同時 1 本。
 * 終了時に PID 指名で kill し、残存 0 件を確認してから一時ディレクトリを削除する。
 *
 * 検証専用スクリプト（製品コードではない・ラッパーが検証のために書いた）。
 * 使い方: node run-l1.mjs [--modes=off,on] [--patterns=a,b,c,d] [--real=<file>] [--idle] [--keep-tmp]
 *   --real を渡すと real 素材で走る（パターンは r のみ・出力は real-<mode>-r.wav / l1-raw-real.json / l1-results-real.json / l1-summary-real.md）
 *   --idle を渡すと最後に「seek が 30 秒来なければ suspend」を実測する（約 35 秒追加）
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
const REAL = opt('real', '');
const MODES = opt('modes', 'off,on').split(',');
const PATTERN_KEYS = REAL ? ['r'] : opt('patterns', 'a,b,c,d').split(',');
const keepTmp = args.includes('--keep-tmp');
const measureIdle = args.includes('--idle');
const suffix = REAL ? '-real' : '';
const wavPrefix = REAL ? 'real-' : '';
for (const mode of MODES) assert.ok(['off', 'on'].includes(mode), `mode must be off|on: ${mode}`);

// 階段音: 1 秒ごとに半音ずつ上がり 12 秒で 1 周。周波数を整数 Hz に丸めると sin(2π f t) が
// 整数秒の境界で位相 0 になり、境界で位相が飛ばない（= 素材側にクリックが無い）。
const MAIN_TABLE = Array.from({ length: 12 }, (_, k) => Math.round(440 * 2 ** (k / 12)));
const BGM_TABLE = Array.from({ length: 12 }, (_, k) => Math.round(110 * 2 ** (k / 12)));
const DURATION_S = 180;
const REAL_DURATION_S = 60;
const FPS = 30;
const TICK_HZ = 30;
const FRAGMENT_MS = 40;
const IDLE_SUSPEND_MS = 30000;
const PATTERNS = {
  a: { label: 'slow: 0 → 20 s in 10 s (≈67 ms/tick)', seconds: 10, recordSec: 10, timeAt: (i, n) => 20 * i / n },
  b: { label: 'fast: 0 → 120 s in 3 s (≈1.3 s/tick)', seconds: 3, recordSec: 4, timeAt: (i, n) => 120 * i / n },
  c: { label: 'back-and-forth: 30 ↔ 35 s for 6 s (3 round trips)', seconds: 6, recordSec: 7, timeAt: (i, n) => {
    const period = n / 3;
    const phase = (i % period) / period;
    const tri = phase < 0.5 ? phase * 2 : 2 - phase * 2;
    return 30 + 5 * tri;
  } },
  // 5 Hz（200 ms 間隔）: seek が整数秒（= 半音の境界）ちょうどに落ちる。elst / priming 適用の効果（境界で前の音が混ざらない）を見るパターン。
  d: { label: 'slow-rate: 0 → 20 s in 4 s at 5 Hz (seeks land on integer seconds)', seconds: 4, recordSec: 5, tickHz: 5, timeAt: (i, n) => 20 * i / n },
  // 実素材: 10 秒のゆっくりドラッグ（a と同じ軌跡）。音程解析は使わず、クリック / 無音 / 要求だけを見る。
  r: { label: 'real footage slow drag: 0 → 20 s in 10 s (≈67 ms/tick)', seconds: 10, recordSec: 10, timeAt: (i, n) => 20 * i / n },
};

// ------------------------------------------------------------------ helpers
const work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'akari-l1-scrub-audio-')));
const project = path.join(work, 'project');
const akariHome = path.join(work, 'akari-home');
const userDataDir = path.join(work, 'electron-user-data');
for (const dir of [project, path.join(project, 'assets'), akariHome, userDataDir]) fs.mkdirSync(dir, { recursive: true });
const realBase = REAL ? path.basename(REAL) : null;
const realDir = REAL ? path.dirname(path.resolve(REAL)) : null;
const scrub = value => {
  let text = String(value)
    .split(repoRoot).join('<WORKTREE>').split(work).join('<TMP>')
    .split(fs.realpathSync(os.tmpdir())).join('<TMP>').split(os.tmpdir()).join('<TMP>');
  if (REAL) text = text.split(realDir).join('<REAL-DIR>').split(realBase).join('<REAL-FILE>');
  return text.split(os.homedir()).join('<HOME>');
};
const round1 = v => Math.round(v * 10) / 10;
// 要求の分類: 本編 media への Range 取得（C の断片 fetch / media 要素の部分取得）と、preview-audio sidecar（前処理の産物）への要求。
// moov = fetch() 由来（CDP type=Fetch）で 8 KB を超える Range（断片は約 1.3 KB・box ヘッダ探索は 16 B）。
const rangeSpan = range => { const m = /^bytes=(\d+)-(\d+)$/.exec(range ?? ''); return m ? Number(m[2]) - Number(m[1]) + 1 : null; };
const summarizeRequests = requests => {
  const summary = { total: requests.length, mediaRange: 0, mediaRangeFetch: 0, mediaRangeMediaElement: 0, mediaFull: 0, moovFetch: 0, previewAudioApi: 0, sidecarPcm: 0, other: 0 };
  for (const r of requests) {
    if (/\/api\/preview-audio/.test(r.path)) summary.previewAudioApi++;
    else if (/\.pcm$|preview-audio\//.test(r.path)) summary.sidecarPcm++;
    else if (/\/assets\/.*\.(mp4|m4a|mov|mkv|webm)$/i.test(r.path)) {
      if (r.range) {
        summary.mediaRange++;
        if (r.type === 'Fetch') { summary.mediaRangeFetch++; if ((rangeSpan(r.range) ?? 0) > 8192) summary.moovFetch++; } else summary.mediaRangeMediaElement++;
      } else summary.mediaFull++;
    } else summary.other++;
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
const probeFile = file => {
  const probe = spawnSync(FFPROBE, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file], { encoding: 'utf8' });
  assert.equal(probe.status, 0, probe.stderr);
  const probed = JSON.parse(probe.stdout);
  return {
    streams: probed.streams.map(s => ({ codec_type: s.codec_type, codec_name: s.codec_name, profile: s.profile, width: s.width, height: s.height,
      r_frame_rate: s.r_frame_rate, sample_rate: s.sample_rate, channels: s.channels, duration: s.duration, bit_rate: s.bit_rate })),
    format: { format_name: probed.format.format_name, duration: probed.format.duration, size: probed.format.size },
  };
};

// ------------------------------------------------------------------ fixture
const fixture = { kind: REAL ? 'real' : 'synthetic', generatedAt: new Date().toISOString(), commands: [] };
const ffmpeg = (label, fargs) => {
  const full = ['-hide_banner', '-loglevel', 'error', '-y', ...fargs];
  fixture.commands.push({ label, command: `ffmpeg ${full.map(scrub).join(' ')}` });
  const started = Date.now();
  const result = spawnSync(FFMPEG, full, { encoding: 'utf8' });
  assert.equal(result.status, 0, `${label}: ${scrub(result.stderr)}`);
  return Date.now() - started;
};
let edit;
if (!REAL) {
  Object.assign(fixture, { mainTableHz: MAIN_TABLE, bgmTableHz: BGM_TABLE, durationSec: DURATION_S });
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
  fixture.ffprobe = probeFile(path.join(project, 'assets/main.mp4'));
  assert.ok(fixture.ffprobe.streams.some(s => s.codec_type === 'audio' && s.codec_name === 'aac' && s.sample_rate === '48000'), 'main.mp4 must carry AAC 48 kHz');
  // v2 形式（version 0 はサーバが拒む）。本編 1 本（in 0 → 180 s）+ BGM 1 本（同じ階段音・別音色・-6 dB）。
  edit = {
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
  console.log(`[fixture] main ${fixture.mainEncodeMs} ms / bgm ${fixture.bgmEncodeMs} ms; ffprobe audio = ${JSON.stringify(fixture.ffprobe.streams.find(s => s.codec_type === 'audio'))}`);
} else {
  assert.ok(fs.existsSync(REAL), 'real footage not found');
  const original = probeFile(REAL);
  fixture.original = { streams: original.streams.map(s => ({ codec_type: s.codec_type, codec_name: s.codec_name, profile: s.profile, width: s.width, height: s.height, r_frame_rate: s.r_frame_rate, sample_rate: s.sample_rate, channels: s.channels })), durationSec: Number(original.format.duration) };
  const audio = original.streams.find(s => s.codec_type === 'audio');
  assert.ok(audio && audio.codec_name === 'aac', 'real footage must carry AAC audio (packets are copied as-is)');
  console.log('[fixture] cutting real footage: first 60 s → 1080p30 H.264 (video re-encoded) + AAC-LC (audio packets copied) …');
  fixture.mainEncodeMs = ffmpeg('real (first 60 s; video → 1080p30 H.264; audio -c:a copy)', [
    '-ss', '0', '-t', String(REAL_DURATION_S), '-i', REAL,
    '-map', '0:v:0', '-map', '0:a:0',
    '-vf', `scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,fps=${FPS}`,
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p', '-g', String(FPS),
    '-c:a', 'copy', '-movflags', '+faststart',
    path.join(project, 'assets/main.mp4'),
  ]);
  fixture.ffprobe = probeFile(path.join(project, 'assets/main.mp4'));
  assert.ok(fixture.ffprobe.streams.some(s => s.codec_type === 'audio' && s.codec_name === 'aac'), 'main.mp4 must carry AAC');
  fixture.durationSec = Number(fixture.ffprobe.format.duration);
  edit = {
    version: 2,
    output: { width: 1920, height: 1080, fps: FPS },
    sources: [{ id: 'main', path: 'assets/main.mp4', proxy: null }],
    tracks: [
      { id: 'visual-main', lane: 'visual', items: [
        { id: 'cut-main', at: 0, duration: Math.floor(fixture.durationSec * FPS), source: { kind: 'media', src: 'main', in: 0, out: fixture.durationSec } }] },
    ],
  };
  console.log(`[fixture] real cut ${fixture.mainEncodeMs} ms; ffprobe = ${JSON.stringify(fixture.ffprobe.streams)}`);
}
fs.writeFileSync(path.join(project, 'edit.json'), `${JSON.stringify(edit, null, 2)}\n`);
fixture.edit = edit;
const hasBgm = !REAL;

// クリック判定の参照: 素材の音声そのものを 48 kHz mono（録音タップと同じ (L+R)/2）に復号してメモリに持つ（ファイルには残さない）。
// 実素材（声）は素材自体に隣接サンプル差 > 0.2 の過渡があるので、録音のクリック候補を素材の同じ位置と突き合わせ、
// 素材に無い不連続（= 断片の継ぎ目で生じた artifact）だけを数える。
const referencePcm = (() => {
  const result = spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-i', path.join(project, 'assets/main.mp4'), '-vn', '-ac', '1', '-ar', '48000', '-f', 's16le', '-'], { maxBuffer: 1024 * 1024 * 1024 });
  assert.equal(result.status, 0, `reference decode failed: ${scrub(result.stderr?.toString() ?? '')}`);
  const buf = result.stdout;
  const out = new Float32Array(buf.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = buf.readInt16LE(i * 2) / 32768;
  return { sampleRate: 48000, samples: out };
})();
fixture.referenceSeconds = +(referencePcm.samples.length / referencePcm.sampleRate).toFixed(2);
const CLICK_DELTA = 0.2;
const REFERENCE_WINDOW_SEC = 0.002;
const REFERENCE_MARGIN = 0.05;
// 録音（Int16 → float）のクリック候補ごとに、その時点で鳴っていた断片（直近の main start）から素材上の位置へ写し、素材の ±2 ms の最大隣接差と比べる。
const checkClicks = (samples, sampleRate, rec0, seeks, firstArrival, lastArrival) => {
  const from = Math.max(1, Math.floor((firstArrival - rec0) * sampleRate));
  const to = Math.min(samples.length, Math.ceil((lastArrival + 0.1 - rec0) * sampleRate));
  const started = seeks.filter(k => k.mainStartedCtxSec !== null).sort((a, b) => a.mainStartedCtxSec - b.mainStartedCtxSec);
  const localMax = (sourceSec) => {
    const centre = Math.round(sourceSec * referencePcm.sampleRate);
    const half = Math.round(REFERENCE_WINDOW_SEC * referencePcm.sampleRate);
    let max = 0;
    for (let i = Math.max(1, centre - half); i < Math.min(referencePcm.samples.length, centre + half); i++) {
      const d = Math.abs(referencePcm.samples[i] - referencePcm.samples[i - 1]);
      if (d > max) max = d;
    }
    return max;
  };
  const out = [];
  for (let i = from; i < to; i++) {
    const delta = Math.abs(samples[i] - samples[i - 1]);
    if (delta <= CLICK_DELTA) continue;
    const t = rec0 + i / sampleRate;
    let ownerIndex = -1;
    for (let j = 0; j < started.length; j++) { if (started[j].mainStartedCtxSec <= t + 1e-6) ownerIndex = j; else break; }
    const candidates = [];
    for (const k of [started[ownerIndex], started[ownerIndex - 1]].filter(Boolean)) {
      const sourceSec = k.sourceTime + (t - k.mainStartedCtxSec);
      candidates.push({ sourceSec: +sourceSec.toFixed(5), sinceStartMs: +((t - k.mainStartedCtxSec) * 1000).toFixed(2), sourceLocalMaxDelta: +localMax(sourceSec).toFixed(3) });
    }
    const best = candidates.reduce((a, b) => (!a || b.sourceLocalMaxDelta > a.sourceLocalMaxDelta ? b : a), null);
    out.push({ t: +t.toFixed(5), delta: +delta.toFixed(3), ...(best ?? { sourceSec: null, sinceStartMs: null, sourceLocalMaxDelta: null }), inSource: !!best && delta <= best.sourceLocalMaxDelta + REFERENCE_MARGIN });
  }
  return out;
};

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
  fixture, tickHz: TICK_HZ, fragmentMs: FRAGMENT_MS, patterns: Object.fromEntries(Object.entries(PATTERNS).filter(([k]) => PATTERN_KEYS.includes(k)).map(([k, p]) => [k, { label: p.label, seconds: p.seconds, recordSec: p.recordSec, tickHz: p.tickHz ?? TICK_HZ }])), runs: [] };
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
  // 前処理なしの証拠: ページが出す HTTP 要求を全部記録する（Range 付き media 取得か / preview-audio sidecar (.pcm) を触っていないか / moov は 1 回か）。
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
  for (const event of ['Page.frameNavigated', 'Page.loadEventFired', 'Runtime.executionContextsCleared', 'Inspector.targetCrashed', 'Page.frameRequestedNavigation']) {
    cdp.on(event, params => consoleLog.push({ type: event, at: new Date().toISOString(), text: JSON.stringify(params ?? {}).slice(0, 300) }));
  }
  await cdp.send('Inspector.enable').catch(() => undefined);

  // 録音タップ + 計測フック（ページのスクリプトより前に仕込む）。
  //  - destination へ向かう connect() を tap GainNode へ迂回
  //  - AudioBufferSourceNode.start をラップして断片の予約（ctx 時刻・when・offset・duration・buffer 長）を記録
  //  - AudioContext.suspend / resume をラップして idle suspend の発火を記録
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
    const OrigCtx = window.AudioContext;
    const origConnect = AudioNode.prototype.connect;
    window.__scrubTap = { contexts: [], origConnect };
    window.__scrubStarts = [];
    window.__scrubCtxOps = [];
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
    const origStart = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (when, offset, duration) {
      try {
        window.__scrubStarts.push({ ctxNow: this.context.currentTime, perfMs: performance.now(), when: when ?? null, offset: offset ?? null, duration: duration ?? null,
          bufferDuration: this.buffer ? this.buffer.duration : null, bufferRate: this.buffer ? this.buffer.sampleRate : null, bufferChannels: this.buffer ? this.buffer.numberOfChannels : null });
      } catch {}
      return origStart.apply(this, arguments);
    };
    for (const op of ['suspend', 'resume']) {
      const orig = OrigCtx.prototype[op];
      OrigCtx.prototype[op] = function () {
        window.__scrubCtxOps.push({ op, ctxSec: this.currentTime, perfMs: performance.now(), stateBefore: this.state });
        return orig.apply(this, arguments);
      };
    }
  })();` });
  await cdp.send('Page.navigate', { url: `${base}/?frameEngine=0` });
  const readyExpr = `(() => {
    const v = document.getElementById('preview-video');
    const bgmOk = ${hasBgm ? '!!(window.akari?.audioDebug?.bgmNode && window.akari.audioDebug.bgmNode._buffer)' : 'true'};
    return { href: location.href, akari: !!window.akari, scrubAudio: !!window.akari?.scrubAudio, baseAudio: !!window.akari?.baseAudioDebug?.context,
      bgmNode: !!window.akari?.audioDebug?.bgmNode, bgmBuffer: !!window.akari?.audioDebug?.bgmNode?._buffer, videoReadyState: v?.readyState ?? -1, videoSrc: v?.currentSrc ?? null,
      ok: !!(window.akari && window.akari.scrubAudio && window.akari.baseAudioDebug && window.akari.baseAudioDebug.context && bgmOk && v && v.readyState >= 1) };
  })()`;
  try {
    await waitFor('preview app ready (scrubAudio + base audio graph + video metadata)', async () => (await evalOn(cdp, readyExpr)).ok, 90000, 250);
  } catch (error) {
    const diag = await evalOn(cdp, readyExpr).catch(e => ({ evalError: String(e) }));
    console.error('[diag] ready state:', JSON.stringify(diag));
    console.error('[diag] console:', JSON.stringify(consoleLog.slice(0, 40)));
    throw error;
  }
  const pageInfo = await evalOn(cdp, `(() => {
    const ctx = window.akari.baseAudioDebug.context;
    const v = document.getElementById('preview-video');
    const b = window.akari.audioDebug?.bgmNode?._buffer ?? null;
    const s = window.akari.scrubAudio;
    return { sampleRate: ctx.sampleRate, baseLatency: ctx.baseLatency, outputLatency: ctx.outputLatency, state: ctx.state, tapped: !!ctx.__tap,
      videoSrc: v.currentSrc, videoDuration: v.duration, videoReadyState: v.readyState, videoVolume: v.volume, videoMuted: v.muted,
      bgmDuration: b ? b.duration : null, bgmChannels: b ? b.numberOfChannels : null,
      userAgent: navigator.userAgent, hasAudioDecoder: typeof AudioDecoder === 'function',
      scrubMode: s.mode, scrubEnabled: s.enabled, scrubActive: s.active, scrubLastError: s.lastError ?? null,
      scrubApi: Object.keys(s).concat(Object.getOwnPropertyNames(s)).filter((k, i, a) => a.indexOf(k) === i).sort(),
      devicePixelRatio: devicePixelRatio, innerSize: [innerWidth, innerHeight] };
  })()`);
  pageInfo.videoSrc = scrub(pageInfo.videoSrc);
  report.page = pageInfo;
  console.log('[page]', JSON.stringify(pageInfo));
  assert.ok(pageInfo.tapped, 'AudioContext tap must be installed');
  // 契約 5: 既定 ON（URL に ?scrubAudio を付けていない）。
  assert.equal(pageInfo.scrubMode, 'on', 'scrub audio must default to on');
  assert.equal(pageInfo.scrubEnabled, true, 'scrub audio must default to enabled');

  // moov の先読みが開いた時の 1 回で済んでいるか: ページ読込〜ready までの要求を残す。
  await sleep(1500);
  report.networkAtOpen = { summary: summarizeRequests(networkLog), requests: networkLog.map(r => ({ ...r, at: round1(r.at) })) };
  console.log('[open] requests:', JSON.stringify(report.networkAtOpen.summary));

  // 録音ワークレット（tap → worklet → destination。worklet の出力は無音。入力を mono 化して 100 ms ごとに main へ送る）+ onSeek のラップ。
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
    // onSeek のラップ: 製品側に計測 API は無いので、到達時刻（audioContext.currentTime）をここで記録する。
    const s = window.akari.scrubAudio;
    if (!s.__origOnSeek) {
      s.__origOnSeek = s.onSeek;
      window.__scrubSeeks = [];
      let seq = 0;
      s.onSeek = function (input) {
        window.__scrubSeeks.push({ seq: ++seq, arrivedCtxSec: ctx.currentTime, arrivedPerfMs: performance.now(), outputTime: input.outputTime, sourceTime: input.sourceTime, src: input.src, isPlaying: !!input.isPlaying });
        return s.__origOnSeek.call(s, input);
      };
    }
    return true;
  })()`);
  await installRecorder();
  await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => undefined);
  if (!REAL) {
    const shot = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 55 });
    fs.writeFileSync(path.join(evidenceDir, 'preview-in-electron.jpg'), Buffer.from(shot.data, 'base64'));
  }

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
  // preview-server の mini-ws が 1 TCP チャンク中の 2 個目以降のフレームを落とす）。
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
  // CPU サンプルは role 別の集計だけ残す（生サンプルは raw を肥大させる）。
  const summarizeCpu = samples => {
    const byPid = new Map();
    for (const sample of samples) { if (!byPid.has(sample.pid)) byPid.set(sample.pid, []); byPid.get(sample.pid).push(sample); }
    const cpu = {};
    for (const list of byPid.values()) {
      if (list.length < 2) continue;
      const first = list[0]; const last = list.at(-1);
      const wall = (last.t - first.t) / 1000;
      if (wall <= 0) continue;
      const pct = ((last.cpuSec - first.cpuSec) / wall) * 100;
      const role = first.role;
      cpu[role] = cpu[role] ?? { pct: 0, psMax: 0, pids: 0 };
      cpu[role].pct += pct;
      cpu[role].psMax = Math.max(cpu[role].psMax, ...list.map(s => s.cpuPct));
      cpu[role].pids++;
    }
    for (const role of Object.keys(cpu)) { cpu[role].pct = round1(cpu[role].pct); cpu[role].psMax = round1(cpu[role].psMax); }
    return cpu;
  };

  // 断片の予約（BufferSource.start）を seek に割り当てる: 本編断片 = buffer が短い（デコード窓 < 1 s）、BGM 断片 = 長い buffer。
  const attachStarts = (seeks, starts) => {
    const sorted = [...seeks].sort((a, b) => a.arrivedCtxSec - b.arrivedCtxSec);
    for (const start of starts) {
      let owner = null;
      for (const s of sorted) { if (s.arrivedCtxSec <= start.ctxNow + 1e-6) owner = s; else break; }
      if (!owner) continue;
      const isMain = start.bufferDuration !== null && start.bufferDuration < 1;
      if (isMain) { owner.mainStartedCtxSec = start.when; owner.mainStartedPerfMs = start.perfMs; owner.mainOffsetSec = start.offset; owner.mainDurationSec = start.duration; owner.windowSec = start.bufferDuration; owner.windowRate = start.bufferRate; }
      else { owner.bgmStartedCtxSec = start.when; owner.bgmOffsetSec = start.offset; }
    }
    for (const s of sorted) { s.mainStartedCtxSec ??= null; s.bgmStartedCtxSec ??= null; s.bgmOffsetSec ??= null; s.skipped = s.isPlaying ? 'playing' : (s.mainStartedCtxSec === null && s.bgmStartedCtxSec === null ? 'superseded-or-skipped' : null); s.error = null; }
    return sorted;
  };

  let lastSeekPerfMs = null;
  for (const mode of MODES) {
    for (const key of PATTERN_KEYS) {
      const pattern = PATTERNS[key];
      const tickHz = pattern.tickHz ?? TICK_HZ;
      const n = pattern.seconds * tickHz;
      const runId = `${wavPrefix}${mode}-${key}`;
      console.log(`[run] ${runId}: ${pattern.label}`);
      const runStartedAt = performance.now();
      try {
      const recorderAlive = await evalOn(cdp, `!!(window.__rec && window.akari && window.akari.scrubAudio && window.akari.scrubAudio.__origOnSeek)`).catch(() => false);
      if (!recorderAlive) {
        console.warn(`[run] ${runId}: recorder missing (page recreated?) — waiting for app and reinstalling`);
        await waitFor('preview app ready again', async () => (await evalOn(cdp, readyExpr)).ok, 90000, 250);
        await installRecorder();
      }
      const modeSet = await evalOn(cdp, `(async () => { const s = window.akari.scrubAudio; s.mode = ${JSON.stringify(mode)}; s.fragmentMs = ${FRAGMENT_MS};
        window.__scrubSeeks.length = 0; window.__scrubStarts.length = 0; window.__scrubCtxOps.length = 0;
        const ctx = window.akari.baseAudioDebug.context; if (ctx.state !== 'running') await ctx.resume(); return { mode: s.mode, enabled: s.enabled, active: s.active, lastError: s.lastError ?? null }; })()`);
      assert.equal(modeSet.mode, mode);
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
      lastSeekPerfMs = performance.now();
      const remaining = pattern.recordSec * 1000 - (performance.now() - started);
      if (remaining > 0) await sleep(remaining);
      clearInterval(sampler);
      await sleep(250);
      samples.push(...sampleCpu());
      const recording = await evalOnLong(`window.__rec.stop()`);
      const hooks = await evalOn(cdp, `({ seeks: window.__scrubSeeks.slice(), starts: window.__scrubStarts.slice(), ctxOps: window.__scrubCtxOps.slice(), lastError: window.akari.scrubAudio.lastError ?? null, mode: window.akari.scrubAudio.mode })`);
      const requests = networkLog.filter(r => r.at >= runStartedAt).map(r => ({ ...r, at: round1(r.at - runStartedAt) }));
      const pcm = Buffer.from(recording.base64, 'base64');
      const int16 = new Int16Array(pcm.buffer, pcm.byteOffset, pcm.length / 2);
      // 契約: 各 ≤ 10 秒・16 bit。
      const maxFrames = pattern.recordSec * recording.sampleRate;
      const trimmed = int16.length > maxFrames ? int16.subarray(0, maxFrames) : int16;
      const wavName = `${runId}.wav`;
      writeWav(path.join(evidenceDir, wavName), trimmed, recording.sampleRate);
      const seeks = attachStarts(hooks.seeks.map(s => ({ ...s, src: s.src ? scrub(s.src) : s.src })), hooks.starts);
      const played = seeks.filter(s => s.mainStartedCtxSec !== null || s.bgmStartedCtxSec !== null).length;
      const rec0 = recording.firstFrame / recording.sampleRate;
      const floatSamples = new Float32Array(trimmed.length);
      for (let i = 0; i < trimmed.length; i++) floatSamples[i] = trimmed[i] / 32768;
      const arrivals = seeks.map(k => k.arrivedCtxSec);
      const clickCheck = arrivals.length ? checkClicks(floatSamples, recording.sampleRate, rec0, seeks, Math.min(...arrivals), Math.max(...arrivals)) : [];
      const stats = { mode: hooks.mode, fragmentMs: FRAGMENT_MS, lastError: hooks.lastError, seeks, starts: hooks.starts.length, ctxOps: hooks.ctxOps,
        summary: { count: seeks.length, played, skipped: seeks.length - played, errors: 0 } };
      const run = { id: runId, mode, pattern: key, label: pattern.label, ticks: n, tickHz, sendJitterMs: { max: Math.max(...sendTimes.map((t, i) => Math.abs(t - i * 1000 / tickHz))) },
        wav: wavName, recording: { sampleRate: recording.sampleRate, firstFrame: recording.firstFrame, frames: trimmed.length, droppedTailFrames: int16.length - trimmed.length, gaps: recording.gaps, peak: recording.peak,
          startCtxSec: recording.startCtxSec, startPerfMs: recording.startPerfMs, clock: recording.clock, stateAtEnd: recording.state },
        stats, cpu: summarizeCpu(samples), clickCheck,
        network: { requests, summary: summarizeRequests(requests) } };
      report.runs.push(run);
      console.log(`[run] ${runId}: seeks=${seeks.length} played=${played} starts=${hooks.starts.length} lastError=${hooks.lastError} peak=${recording.peak.toFixed(3)} gaps=${recording.gaps.length} clicks=${clickCheck.length} (inSource ${clickCheck.filter(c => c.inSource).length}) net=${JSON.stringify(run.network.summary)}`);
      await sleep(400);
      } catch (error) {
        const message = scrub(error?.stack ?? String(error));
        console.error(`[run] ${runId}: FAILED — ${message.split('\n')[0]}`);
        report.failedRuns = report.failedRuns ?? [];
        report.failedRuns.push({ id: runId, mode, pattern: key, error: message.slice(0, 800), consoleTail: consoleLog.slice(-10).map(e => ({ ...e, text: scrub(e.text) })) });
        try { await evalOn(cdp, `(() => { try { window.__rec && clearInterval(window.__rec.timer); window.__rec && (window.__rec.recording = false); window.akari?.scrubAudio?.stop?.(); } catch {} return true; })()`); } catch { /* page may be gone */ }
        await sleep(800);
      }
    }
  }

  // idle suspend（契約 5）: 最後の seek から 30 秒 seek が来なければ audioContext.suspend() される。on で 1 回だけ実測する。
  if (measureIdle && MODES.includes('on')) {
    console.log('[idle] measuring idle suspend (≈ 35 s) …');
    await evalOn(cdp, `(async () => { const s = window.akari.scrubAudio; s.mode = 'on'; window.__scrubCtxOps.length = 0; const ctx = window.akari.baseAudioDebug.context; if (ctx.state !== 'running') await ctx.resume(); return true; })()`);
    await sleep(500);
    const idleSeekAt = performance.now();
    sendSeek(12.5);
    await sleep(1000);
    const stateAfter1s = await evalOn(cdp, `window.akari.baseAudioDebug.context.state`);
    await sleep(IDLE_SUSPEND_MS + 3500);
    const idle = await evalOn(cdp, `({ state: window.akari.baseAudioDebug.context.state, ops: window.__scrubCtxOps.slice(), lastError: window.akari.scrubAudio.lastError ?? null })`);
    const suspendOp = idle.ops.find(op => op.op === 'suspend');
    report.idleSuspend = { stateAfter1s, stateAfter33s: idle.state, suspendCalled: !!suspendOp, suspendAfterSeekMs: suspendOp ? round1(suspendOp.perfMs - (await evalOn(cdp, `window.__scrubSeeks.at(-1)?.arrivedPerfMs ?? null`) ?? suspendOp.perfMs)) : null,
      ops: idle.ops.map(op => ({ ...op, perfMs: round1(op.perfMs) })), lastError: idle.lastError, harnessSeekSentMsAgo: round1(performance.now() - idleSeekAt) };
    // suspend 後の seek で resume して鳴るか（復帰）。
    await evalOn(cdp, `(() => { window.__scrubSeeks.length = 0; window.__scrubStarts.length = 0; window.__scrubCtxOps.length = 0; return true; })()`);
    sendSeek(13.5);
    await sleep(800);
    const wake = await evalOn(cdp, `({ state: window.akari.baseAudioDebug.context.state, ops: window.__scrubCtxOps.slice(), starts: window.__scrubStarts.length, seeks: window.__scrubSeeks.length })`);
    report.idleSuspend.wake = { stateAfterSeek: wake.state, resumeCalled: wake.ops.some(op => op.op === 'resume'), starts: wake.starts, seeks: wake.seeks };
    console.log('[idle]', JSON.stringify(report.idleSuspend));
  }
  ws.close();
  report.console = consoleLog.slice(0, 200).map(e => ({ ...e, text: scrub(e.text) }));
  // ページ読込〜全 run を通した要求の総覧（前処理の有無の証拠。sidecar (.pcm) / preview-audio API を webview が触ったか / moov は何回か）。
  report.networkAll = { summary: summarizeRequests(networkLog), byPath: Object.entries(networkLog.reduce((acc, r) => { const key = `${r.method} ${r.path}${r.range ? ' [Range]' : ''} (${r.type})`; acc[key] = (acc[key] ?? 0) + 1; return acc; }, {})).sort((a, b) => b[1] - a[1]).slice(0, 40),
    moovFetches: networkLog.filter(r => r.type === 'Fetch' && r.range && (rangeSpan(r.range) ?? 0) > 8192).map(r => ({ at: round1(r.at), path: r.path, range: r.range })) };
  // 前処理禁止の確認: プロジェクト配下のキャッシュに本編 (main.mp4) 由来の sidecar / PCM が無いこと。
  const cacheDir = path.join(project, '.akari', 'cache');
  const listCache = dir => fs.existsSync(dir) ? fs.readdirSync(dir, { recursive: true }).map(f => ({ file: String(f), bytes: (() => { try { return fs.statSync(path.join(dir, String(f))).size; } catch { return null; } })() })) : [];
  report.projectCache = { dir: scrub(cacheDir), entries: listCache(cacheDir) };
  report.projectFilesAfterRun = fs.readdirSync(project, { recursive: true }).map(String).filter(f => !f.startsWith('.akari/cache')).sort();
} catch (error) {
  console.error('[harness] failed:', scrub(error?.stack ?? error));
  console.error('[harness] page console (tail):', JSON.stringify(report.consoleOnFailure = (globalThis.__consoleLog ?? []).slice(-40).map(e => ({ ...e, text: scrub(e.text) })), null, 1));
  process.exitCode = 1;
} finally {
  await cleanup();
}
report.finishedAt = new Date().toISOString();
report.serverLogTail = scrub(serverLog.slice(-4000));
report.electronLogTail = scrub(electronLog.slice(-2000));
if (process.exitCode === 1) {
  fs.writeFileSync(path.join(evidenceDir, `l1-raw${suffix}-failed.json`), `${JSON.stringify(report, null, 2)}\n`);
  process.exit(1);
}
if (report.failedRuns?.length) console.warn(`[harness] ${report.failedRuns.length} run(s) failed: ${report.failedRuns.map(r => r.id).join(', ')}`);
fs.writeFileSync(path.join(evidenceDir, `l1-raw${suffix}.json`), `${JSON.stringify(report, null, 2)}\n`);
const analysis = analyzeRun(report, evidenceDir);
fs.writeFileSync(path.join(evidenceDir, `l1-results${suffix}.json`), `${JSON.stringify(analysis, null, 2)}\n`);
writeSummaryMarkdown(analysis, path.join(evidenceDir, `l1-summary${suffix}.md`));
console.log(fs.readFileSync(path.join(evidenceDir, `l1-summary${suffix}.md`), 'utf8'));
console.log('[cleanup]', JSON.stringify(report.cleanup));
if (!keepTmp) fs.rmSync(work, { recursive: true, force: true });
