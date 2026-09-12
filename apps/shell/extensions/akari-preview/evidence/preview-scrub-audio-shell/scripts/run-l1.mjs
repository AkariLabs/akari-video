#!/usr/bin/env node
/**
 * L1（実 shell = Theia / Electron・GPU 有効）— 出力プレビュー webview のスクラブ音配線を、タイムライン widget
 * （akari-annotations）のプレイヘッドを **実マウスでドラッグ**（CDP Input.dispatchMouseEvent → pointer イベント →
 * requestSeek → `akari.preview.seekOutput` → webview `akari-preview-seek` → requestScrub → rAF → seekTimelineTime → onSeek）して実測する。
 *
 *  - 構成（--configs）: nobgm（legacy <video> 経路・BGM なし）/ bgm（legacy・BGM あり）/ engine（frame-engine 経路 ON・BGM あり）/
 *    real（legacy・声入りの実素材・`--real=<file>` 必須）
 *  - 素材: mktemp 配下に ffmpeg lavfi で合成（1080p30 H.264 + AAC 48 kHz・60 秒・1 秒ごとに半音上がる階段音）。BGM は同じ階段を
 *    2 オクターブ下 + 6 Hz トレモロ（AAC m4a）。real は先頭 60 秒を映像だけ H.264 へ・音声は `-c:a copy`
 *  - 録音タップ（webview 側）: スクラブ音の AudioContext（`window.akari.scrubAudio.context`。legacy では BGM / SFX と共有）の
 *    destination へ向かう接続を tap GainNode → AudioWorklet（scrub-rec）へ迂回して 16 bit wav に落とす。既存の masterGain →
 *    meterAnalyser → destination も tap へ繋ぎ直す（BGM 断片が通る経路）
 *  - 計測フック: `window.akari.scrubAudio.onSeek` のラップ（到達時刻 = audioContext.currentTime）・`AudioBufferSourceNode.prototype.start`
 *    のラップ（断片の予約）・`AudioContext.prototype.suspend / resume` のラップ
 *  - HTTP 要求: webview の CDP Network.requestWillBeSent を全件記録（/media/<id> の Range / 全量、/asset/*.pcm の sidecar 読み）
 *  - 無音の確認（nobgm 構成）: 設定 OFF（PreferenceService で akari.preview.scrubAudio=false）/ globalMuted（akari.timeline.setMuted）/
 *    通常再生中（akari.preview.togglePlayback）の 3 つでドラッグしても録音が無音・断片 start 0 であること
 *
 * 隔離: AKARI_HOME / THEIA_CONFIG_DIR / --user-data-dir / プロジェクトはすべて mktemp 配下。Electron は detached にせず、同時 1 本。
 * 終了時に PID 指名で kill し、残存 0 件を確認してから一時ディレクトリを削除する。
 *
 * 検証専用スクリプト（製品コードではない・ラッパーが検証のために書いた）。
 * 使い方: node run-l1.mjs [--configs=nobgm,bgm,engine] [--patterns=a,b,c] [--real=<file>] [--keep-tmp]
 */
import assert from 'node:assert/strict';
import { exec, execSync, spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const here = path.dirname(fileURLToPath(import.meta.url));
const evidenceDir = path.resolve(here, '..');
const extensionRoot = path.resolve(evidenceDir, '../..');
const repoRoot = path.resolve(extensionRoot, '../../../..');
const shellRoot = path.join(repoRoot, 'apps/shell');
const FFMPEG = path.join(repoRoot, 'packages/media-bin/vendor/darwin-arm64/ffmpeg');
const FFPROBE = path.join(repoRoot, 'packages/media-bin/vendor/darwin-arm64/ffprobe');
const { CDP, evalOn, listTargets, waitFor } = await import(path.join(extensionRoot, 'evidence/frame-engine-boot/scripts/cdp-lib.mjs'));
const { analyzeRun, writeSummaryMarkdown } = await import(path.join(extensionRoot, 'evidence/preview-scrub-audio/scripts/analyze.mjs'));

const ELECTRON_BIN = [
  path.join(repoRoot, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'),
  path.join(shellRoot, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'),
].find(candidate => fs.existsSync(candidate));
assert.ok(ELECTRON_BIN, 'Electron binary not found');
assert.ok(fs.existsSync(path.join(shellRoot, 'lib/backend/main.js')), 'apps/shell is not built (lib/backend/main.js missing) — run npm run build in apps/shell');

const args = process.argv.slice(2);
const opt = (name, fallback) => (args.find(a => a.startsWith(`--${name}=`)) ?? '').slice(name.length + 3) || fallback;
const REAL = opt('real', '');
const keepTmp = args.includes('--keep-tmp');

// セッション = Electron 1 本。駆動レート 120 Hz は rAF（= 画面更新レート）が律速なので、
// Chromium の vsync / フレームレート上限を外した専用セッションで測る（GPU は有効のまま）。
// 実機の既定（60 Hz / ProMotion 120 Hz）の両方を再現するため。
const SESSIONS = {
  // legacy <video> 経路・BGM なし: 30 Hz の既存パターン（退行確認）+ 60 Hz の実機相当
  'nobgm-60': { config: 'nobgm', uncapFps: false, silentModes: [{ mode: 'off', pattern: 'a', hz: 30 }, { mode: 'muted', pattern: 'a', hz: 30 }, { mode: 'playing', pattern: 'a', hz: 30 }],
    runs: [{ pattern: 'a', hz: 30 }, { pattern: 'b', hz: 30 }, { pattern: 'c', hz: 30 }, { pattern: 'a', hz: 60 }, { pattern: 'c', hz: 60 }, { pattern: 'f', hz: 60 }, { pattern: 'd', hz: 60 }] },
  // 同じ構成を 120 Hz 駆動（vsync 解除）で
  'nobgm-120': { config: 'nobgm', uncapFps: true, silentModes: [], runs: [{ pattern: 'a', hz: 120 }, { pattern: 'f', hz: 120 }, { pattern: 'd', hz: 120 }] },
  // legacy・BGM あり
  'bgm-60': { config: 'bgm', uncapFps: false, silentModes: [], runs: [{ pattern: 'a', hz: 30 }, { pattern: 'f', hz: 60 }] },
  // frame-engine 経路
  'engine-60': { config: 'engine', uncapFps: false, silentModes: [], runs: [{ pattern: 'a', hz: 30 }, { pattern: 'f', hz: 60 }] },
  // 実写（声）— オーナーが耳で確かめる録音
  'real-60': { config: 'real', uncapFps: false, silentModes: [], runs: [{ pattern: 'r', hz: 30 }, { pattern: 'f', hz: 60 }] },
};
const SESSION_KEYS = opt('sessions', REAL ? 'real-60' : 'nobgm-60,nobgm-120,bgm-60,engine-60').split(',').filter(Boolean);
for (const key of SESSION_KEYS) assert.ok(SESSIONS[key], `session must be one of ${Object.keys(SESSIONS).join('|')}: ${key}`);
if (SESSION_KEYS.some(k => SESSIONS[k].config === 'real')) assert.ok(REAL && fs.existsSync(REAL), 'real session needs --real=<file>');

const MAIN_TABLE = Array.from({ length: 12 }, (_, k) => Math.round(440 * 2 ** (k / 12)));
const BGM_TABLE = Array.from({ length: 12 }, (_, k) => Math.round(110 * 2 ** (k / 12)));
const DURATION_S = 60;
const FPS = 30;
const FRAGMENT_MS = 40;
const VIEW_W = 1600;
const VIEW_H = 1000;
// 60 秒の素材をタイムライン全幅に出した状態での、実マウスの移動の軌跡。1 tick = 1 mousemove（駆動レートは run ごと）。
// speed = 走査する source 秒 / ドラッグの実時間秒（= 「早送り」の倍率）。
const SWEEP_END = DURATION_S - 1;
const PATTERNS = {
  // 録音は契約どおり各 ≤ 10 s。ドラッグの前後（押下・host → webview の遅延・最後の断片 40 ms）を録音に収めるため、a / r のドラッグは 9.5 s にする。
  a: { label: 'slow drag: 0 → 19 s in 9.5 s', seconds: 9.5, recordSec: 10, speed: 2, timeAt: (i, n) => 19 * i / n },
  b: { label: 'fast drag: 0 → 50 s in 3 s', seconds: 3, recordSec: 4, speed: 16.7, timeAt: (i, n) => 50 * i / n },
  c: { label: 'back-and-forth: 30 ↔ 35 s for 6 s (3 round trips)', seconds: 6, recordSec: 7, speed: 5, timeAt: (i, n) => {
    const period = n / 3;
    const phase = (i % period) / period;
    const tri = phase < 0.5 ? phase * 2 : 2 - phase * 2;
    return 30 + 5 * tri;
  } },
  // 実機のオーナー操作に相当する速さ（契約 指示 5）: タイムライン全長を 1 秒で走査。
  f: { label: `full-length sweep: 0 → ${SWEEP_END} s in 1 s`, seconds: 1, recordSec: 3, speed: SWEEP_END, timeAt: (i, n) => SWEEP_END * i / n },
  // 同・0.5 秒で往復（全長を行って戻る）。
  d: { label: `full-length round trip: 0 → ${SWEEP_END} → 0 s in 0.5 s`, seconds: 0.5, recordSec: 2, speed: SWEEP_END * 4, timeAt: (i, n) => {
    const phase = i / n;
    const tri = phase < 0.5 ? phase * 2 : 2 - phase * 2;
    return SWEEP_END * tri;
  } },
  r: { label: 'real footage slow drag: 0 → 19 s in 9.5 s', seconds: 9.5, recordSec: 10, speed: 2, timeAt: (i, n) => 19 * i / n },
};

// ------------------------------------------------------------------ helpers
const work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'akari-l1-scrub-shell-')));
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
const rangeSpan = range => { const m = /^bytes=(\d+)-(\d+)$/.exec(range ?? ''); return m ? Number(m[2]) - Number(m[1]) + 1 : null; };
// shell の配信 URL: /media/<id>（動画ストリーム）/ /asset/<id>.<ext>（素材: BGM m4a・画像・sidecar .pcm）/ /static/<hash>/<name>（資産）。
const summarizeRequests = requests => {
  // mediaRangeFetch = スクラブ音由来（initiator が scrub-audio.js）の fetch Range。engineRangeFetch = frame-engine 由来の fetch Range（映像デコード用・本票の対象外）。
  // moovFetch = スクラブ音由来で 8 KB を超える Range（= moov。src ごとに 1 回のはず）。scrubFull = スクラブ音由来の Range 無し要求（0 のはず）。
  const summary = { total: requests.length, mediaRange: 0, mediaRangeFetch: 0, mediaRangeMediaElement: 0, engineRangeFetch: 0, otherRangeFetch: 0, mediaFull: 0, scrubFull: 0, boxProbe: 0, moovFetch: 0, previewAudioApi: 0, sidecarPcm: 0, bgmAssetFull: 0, other: 0,
    scrubFetchMs: null, scrubRangeBytes: null };
  const scrubDurations = [];
  const scrubSpans = [];
  // moov 取得は Mp4AudioTrack#open() の「16 B の box ヘッダ読み × n → 大きい 1 本」でしか起きない。
  // 断片の窓は速度で最大 1 s（数十 KB）まで広がるので、サイズだけでは moov と区別できない。
  let lastProbeAt = -Infinity;
  for (const r of [...requests].sort((a, b) => a.at - b.at)) {
    if (/^\/asset\/[a-f0-9]{64}\.pcm$/.test(r.path)) summary.sidecarPcm++;
    else if (/^\/media\/[a-f0-9]{64}$/.test(r.path)) {
      if (r.range) {
        summary.mediaRange++;
        if (r.type === 'Fetch') {
          if (r.initiator === 'scrub') {
            summary.mediaRangeFetch++;
            const span = rangeSpan(r.range) ?? 0;
            if (span === 16) { summary.boxProbe++; lastProbeAt = r.at; }
            else if (span > 8192 && r.at - lastProbeAt <= 1000) summary.moovFetch++;
            else scrubSpans.push(span);
            if (r.doneAt !== null) scrubDurations.push(r.doneAt - r.at);
          } else if (r.initiator === 'engine') summary.engineRangeFetch++;
          else summary.otherRangeFetch++;
        } else summary.mediaRangeMediaElement++;
      } else { summary.mediaFull++; if (r.initiator === 'scrub') summary.scrubFull++; }
    } else if (/^\/asset\/[a-f0-9]{64}\.(m4a|mp3|wav|aac|ogg|opus|flac)$/.test(r.path)) { if (r.range) summary.mediaRange++; else summary.bgmAssetFull++; }
    else summary.other++;
  }
  const pct = (list, q) => round1(list[Math.min(list.length - 1, Math.floor(list.length * q))]);
  if (scrubDurations.length) {
    const sorted = [...scrubDurations].sort((a, b) => a - b);
    summary.scrubFetchMs = { n: sorted.length, p50: pct(sorted, 0.5), p90: pct(sorted, 0.9), p99: pct(sorted, 0.99), max: round1(sorted.at(-1)) };
  }
  if (scrubSpans.length) {
    const sorted = [...scrubSpans].sort((a, b) => a - b);
    summary.scrubRangeBytes = { n: sorted.length, p50: pct(sorted, 0.5), p95: pct(sorted, 0.95), max: sorted.at(-1), totalKb: round1(sorted.reduce((a, b) => a + b, 0) / 1024) };
  }
  return summary;
};
const psLines = () => execSync('ps -eo pid,ppid,%cpu,time,args', { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }).trim().split('\n').slice(1);
const psCount = needle => psLines().filter(line => line.includes(needle)).length;
const parsePsTime = text => { const parts = text.trim().split(':').map(Number).reverse(); return (parts[0] ?? 0) + (parts[1] ?? 0) * 60 + (parts[2] ?? 0) * 3600; };
async function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => { const { port } = probe.address(); probe.close(() => resolve(port)); });
  });
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
const CLICK_DELTA = 0.2;
const REFERENCE_WINDOW_SEC = 0.002;
const REFERENCE_MARGIN = 0.05;
// 録音のクリック候補（隣接差 > 0.2）を、鳴っていた断片の素材位置 ±2 ms の最大隣接差と比べ「素材由来 / artifact」に分ける（productize 票の harness と同じ判定）。
const makeClickChecker = referencePcm => (samples, sampleRate, rec0, seeks, firstArrival, lastArrival) => {
  const from = Math.max(1, Math.floor((firstArrival - rec0) * sampleRate));
  const to = Math.min(samples.length, Math.ceil((lastArrival + 0.1 - rec0) * sampleRate));
  const started = seeks.filter(k => k.mainStartedCtxSec !== null).sort((a, b) => a.mainStartedCtxSec - b.mainStartedCtxSec);
  const localMax = sourceSec => {
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

// ------------------------------------------------------------------ fixture
function buildFixture(config, project) {
  const fixture = { kind: config === 'real' ? 'real' : 'synthetic', config, generatedAt: new Date().toISOString(), commands: [] };
  const ffmpeg = (label, fargs) => {
    const full = ['-hide_banner', '-loglevel', 'error', '-y', ...fargs];
    fixture.commands.push({ label, command: `ffmpeg ${full.map(scrub).join(' ')}` });
    const started = Date.now();
    const result = spawnSync(FFMPEG, full, { encoding: 'utf8' });
    assert.equal(result.status, 0, `${label}: ${scrub(result.stderr)}`);
    return Date.now() - started;
  };
  fs.mkdirSync(path.join(project, 'assets'), { recursive: true });
  const withBgm = config === 'bgm' || config === 'engine';
  let edit;
  if (config !== 'real') {
    Object.assign(fixture, { mainTableHz: MAIN_TABLE, bgmTableHz: BGM_TABLE, durationSec: DURATION_S, withBgm });
    const mainExpr = `0.5*sin(2*PI*t*round(440*pow(2,mod(floor(t),12)/12)))`;
    const bgmExpr = `(0.35+0.15*sin(2*PI*6*t))*sin(2*PI*t*round(110*pow(2,mod(floor(t),12)/12)))`;
    const fontFile = ['/System/Library/Fonts/Helvetica.ttc', '/System/Library/Fonts/Supplemental/Arial.ttf'].find(f => fs.existsSync(f));
    fixture.mainEncodeMs = ffmpeg('main (1080p30 H.264 + AAC 48 kHz stereo, semitone staircase, drawtext timecode)', [
      '-f', 'lavfi', '-i', `testsrc2=size=1920x1080:rate=${FPS}`,
      '-f', 'lavfi', '-i', `aevalsrc=exprs='${mainExpr}|${mainExpr}':s=48000:c=stereo`,
      '-t', String(DURATION_S),
      ...(fontFile ? ['-vf', `drawtext=fontfile=${fontFile}:text='%{pts\\:hms}':fontsize=110:fontcolor=white:box=1:boxcolor=black@0.6:x=(w-tw)/2:y=h-th-80`] : []),
      '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '23', '-pix_fmt', 'yuv420p', '-g', String(FPS),
      '-c:a', 'aac', '-b:a', '128k', '-ar', '48000', '-movflags', '+faststart',
      path.join(project, 'assets/main.mp4'),
    ]);
    if (withBgm) {
      fixture.bgmEncodeMs = ffmpeg('bgm (AAC m4a, same staircase two octaves down + 6 Hz tremolo)', [
        '-f', 'lavfi', '-i', `aevalsrc=exprs='${bgmExpr}':s=48000:c=mono`, '-t', String(DURATION_S),
        '-c:a', 'aac', '-b:a', '96k', path.join(project, 'assets/bgm.m4a'),
      ]);
    }
    fixture.ffprobe = probeFile(path.join(project, 'assets/main.mp4'));
    assert.ok(fixture.ffprobe.streams.some(s => s.codec_type === 'audio' && s.codec_name === 'aac' && s.sample_rate === '48000'), 'main.mp4 must carry AAC 48 kHz');
    edit = {
      version: 2,
      output: { width: 1920, height: 1080, fps: FPS },
      sources: [
        { id: 'main', path: 'assets/main.mp4', proxy: null },
        ...(withBgm ? [{ id: 'a-bgm', path: 'assets/bgm.m4a', proxy: null }] : []),
      ],
      tracks: [
        { id: 'visual-main', lane: 'visual', items: [
          { id: 'cut-main', at: 0, duration: DURATION_S * FPS, source: { kind: 'media', src: 'main', in: 0, out: DURATION_S } }] },
        ...(withBgm ? [{ id: 'audio-bgm', lane: 'audio', items: [
          { id: 'bgm', at: 0, duration: 0, role: 'bgm', source: { kind: 'media', src: 'a-bgm', in: 0 }, gain_db: -6 }] }] : []),
      ],
    };
  } else {
    const original = probeFile(REAL);
    fixture.original = { streams: original.streams.map(s => ({ codec_type: s.codec_type, codec_name: s.codec_name, profile: s.profile, width: s.width, height: s.height, r_frame_rate: s.r_frame_rate, sample_rate: s.sample_rate, channels: s.channels })), durationSec: Number(original.format.duration) };
    const audio = original.streams.find(s => s.codec_type === 'audio');
    assert.ok(audio && audio.codec_name === 'aac', 'real footage must carry AAC audio (packets are copied as-is)');
    fixture.mainEncodeMs = ffmpeg('real (first 60 s; video → 1080p30 H.264; audio -c:a copy)', [
      '-ss', '0', '-t', String(DURATION_S), '-i', REAL,
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
  }
  fs.writeFileSync(path.join(project, 'edit.json'), `${JSON.stringify(edit, null, 2)}\n`);
  fixture.edit = edit;
  // クリック照合の参照: 素材の音声を 48 kHz mono に復号してメモリに持つ（ファイルには残さない）。
  const decoded = spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-i', path.join(project, 'assets/main.mp4'), '-vn', '-ac', '1', '-ar', '48000', '-f', 's16le', '-'], { maxBuffer: 1024 * 1024 * 1024 });
  assert.equal(decoded.status, 0, `reference decode failed: ${scrub(decoded.stderr?.toString() ?? '')}`);
  const buf = decoded.stdout;
  const samples = new Float32Array(buf.length / 2);
  for (let i = 0; i < samples.length; i++) samples[i] = buf.readInt16LE(i * 2) / 32768;
  fixture.referenceSeconds = +(samples.length / 48000).toFixed(2);
  return { fixture, referencePcm: { sampleRate: 48000, samples }, withBgm };
}

// ------------------------------------------------------------------ one session = one Electron
async function runConfig(sessionKey) {
  const session = SESSIONS[sessionKey];
  const config = session.config;
  const configWork = path.join(work, sessionKey);
  const project = path.join(configWork, 'project');
  const akariHome = path.join(configWork, 'akari-home');
  const userDataDir = path.join(configWork, 'electron-user-data');
  const theiaConfigDir = path.join(configWork, 'theia-config');
  for (const dir of [project, akariHome, userDataDir, theiaConfigDir]) fs.mkdirSync(dir, { recursive: true });
  console.log(`[${config}] fixture …`);
  const { fixture, referencePcm, withBgm } = buildFixture(config, project);
  const checkClicks = makeClickChecker(referencePcm);
  const frameEngine = config === 'engine';
  // 無音の確認（設定 OFF / globalMuted / 再生中）は nobgm セッションでだけ回す（AudioContext に scrub 以外の音源が無い）。
  const plan = [...session.silentModes, ...session.runs.map(r => ({ mode: 'on', ...r }))];
  const patternKeys = [...new Set(plan.map(r => r.pattern))];
  const cdpPort = await freePort();
  const electronLogPath = path.join(configWork, 'electron.log');
  const electronLog = fs.openSync(electronLogPath, 'w');
  // 120 Hz 駆動は rAF（= 画面更新レート）が律速になるため、vsync とフレームレート上限を外す（ProMotion 相当の再現。GPU は有効のまま）。
  const uncapArgs = session.uncapFps ? ['--disable-gpu-vsync', '--disable-frame-rate-limit'] : [];
  const electron = spawn(ELECTRON_BIN, [shellRoot, project, `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${userDataDir}`, '--no-sandbox',
    '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', ...uncapArgs], {
    detached: false, stdio: ['ignore', electronLog, electronLog],
    env: { ...process.env, AKARI_HOME: akariHome, THEIA_CONFIG_DIR: theiaConfigDir, AKARI_FRAME_ENGINE: frameEngine ? '1' : '0', ELECTRON_ENABLE_LOGGING: '0' },
  });
  const report = { config, session: sessionKey, uncapFps: session.uncapFps, startedAt: new Date().toISOString(),
    host: { platform: process.platform, arch: process.arch, node: process.version, cpus: os.cpus().length, model: os.cpus()[0]?.model, memGb: +(os.totalmem() / 2 ** 30).toFixed(1), loadAvgAtStart: os.loadavg().map(v => +v.toFixed(2)) },
    electron: { version: fs.readFileSync(path.join(path.dirname(path.dirname(path.dirname(path.dirname(ELECTRON_BIN)))), 'version'), 'utf8').trim() },
    fixture, frameEngine, tickHz: null, fragmentMs: FRAGMENT_MS,
    plan, patterns: Object.fromEntries(patternKeys.map(k => [k, { label: PATTERNS[k].label, seconds: PATTERNS[k].seconds, recordSec: PATTERNS[k].recordSec, speed: PATTERNS[k].speed }])), runs: [] };
  let main; let view; let ctxId; const contexts = [];
  let cleanupDone = false;
  const cleanup = async () => {
    if (cleanupDone) return;
    cleanupDone = true;
    try { view?.close(); } catch { /* noop */ }
    try { main?.close(); } catch { /* noop */ }
    const electronPid = electron.pid;
    const exited = new Promise(resolve => { if (electron.exitCode !== null) resolve(); else electron.once('exit', resolve); });
    try { electron.kill('SIGTERM'); } catch { /* already gone */ }
    await Promise.race([exited, sleep(6000)]);
    if (electron.exitCode === null) { try { electron.kill('SIGKILL'); } catch { /* noop */ } await sleep(500); }
    for (let attempt = 0; attempt < 10 && psCount(userDataDir) > 0; attempt++) {
      for (const line of psLines().filter(l => l.includes(userDataDir))) { const pid = Number(line.trim().split(/\s+/)[0]); if (pid && pid !== process.pid) { try { process.kill(pid, 'SIGKILL'); } catch { /* noop */ } } }
      await sleep(300);
    }
    await sleep(300);
    report.cleanup = {
      electronPid, electronExitCode: electron.exitCode, electronSignal: electron.signalCode,
      survivingElectronProcesses: psCount(userDataDir),
      survivingShellBackend: psCount(path.join(shellRoot, 'lib/backend/main.js')),
    };
    try { fs.closeSync(electronLog); } catch { /* noop */ }
  };
  const consoleLog = [];
  try {
    // ---------------- shell ready
    await waitFor('shell ready (CDP + initialized_layout → ready)', async () => {
      if (electron.exitCode !== null) throw new Error(`electron exited ${electron.exitCode}`);
      try { const r = await fetch(`http://127.0.0.1:${cdpPort}/json/version`, { signal: AbortSignal.timeout(1000) }); if (!r.ok) return false; } catch { return false; }
      return fs.readFileSync(electronLogPath, 'utf8').includes("Changed application state from 'initialized_layout' to 'ready'");
    }, 240000, 1000);
    const mainTarget = await waitFor('main page target', async () => (await listTargets(cdpPort)).find(t => t.type === 'page' && /localhost/u.test(t.url)) ?? (await listTargets(cdpPort)).find(t => t.type === 'page'), 30000, 250);
    main = new CDP(mainTarget.webSocketDebuggerUrl);
    await main.connect();
    main.on('Runtime.consoleAPICalled', p => { consoleLog.push({ where: 'main', type: p.type, text: p.args.map(a => a.value ?? a.description ?? '').join(' ').slice(0, 300) }); });
    main.on('Runtime.exceptionThrown', p => { consoleLog.push({ where: 'main', type: 'exception', text: String(p.exceptionDetails?.exception?.description ?? p.exceptionDetails?.text).slice(0, 500) }); });
    await main.send('Page.enable'); await main.send('Runtime.enable');
    await main.send('Emulation.setDeviceMetricsOverride', { width: VIEW_W, height: VIEW_H, deviceScaleFactor: 1, mobile: false });
    await main.send('Page.bringToFront');
    await waitFor('frontend ready', () => evalOn(main, `document.readyState === 'complete'`), 60000);
    await sleep(1500);
    await evalOn(main, `(() => { const b=[...document.querySelectorAll('button')].find(e=>e.textContent?.trim()==='開くだけ'); if(b)b.click(); return true; })()`);
    await sleep(800);
    const editUri = `file://${path.join(project, 'edit.json')}`;
    const COMMANDS = `(() => {
      const bindings=window.theia.container._bindingDictionary;
      const keys=[...bindings._map.keys()];
      const C=keys.find(k=>typeof k==='function' && typeof k.prototype?.executeCommand==='function' && typeof k.prototype?.registerCommand==='function');
      return window.theia.container.get(C);
    })()`;
    const PREFERENCES = `(() => {
      const bindings=window.theia.container._bindingDictionary;
      const keys=[...bindings._map.keys()];
      const S=keys.find(k=>typeof k==='symbol' && k.description==='PreferenceService');
      return window.theia.container.get(S);
    })()`;
    const SHELL = `(() => {
      const bindings=window.theia.container._bindingDictionary;
      const keys=[...bindings._map.keys()];
      const A=keys.find(k=>typeof k==='function' && typeof k.prototype?.activateWidget==='function' && typeof k.prototype?.getAreaFor==='function');
      return window.theia.container.get(A);
    })()`;
    const openResult = await evalOn(main, `(async () => await ${COMMANDS}.executeCommand('akari.preview.ensureVisible', { editUri: ${JSON.stringify(editUri)} }))()`);
    console.log(`[${config}] open preview: ${JSON.stringify(openResult)}`);
    // ---------------- webview（widget 生成直後に attach し、本文が読み込まれる前に Network 記録と CSP 迂回を仕込む）
    const webviewTarget = await waitFor('webview target', async () => (await listTargets(cdpPort)).find(t => t.type === 'iframe' && /webview\/index\.html/u.test(t.url)) || null, 90000, 100);
    view = new CDP(webviewTarget.webSocketDebuggerUrl);
    await view.connect();
    view.on('Runtime.executionContextCreated', p => contexts.push(p.context));
    view.on('Runtime.consoleAPICalled', p => { consoleLog.push({ where: 'webview', type: p.type, text: p.args.map(a => a.value ?? a.description ?? '').join(' ').slice(0, 300) }); });
    view.on('Runtime.exceptionThrown', p => { consoleLog.push({ where: 'webview', type: 'exception', text: String(p.exceptionDetails?.exception?.description ?? p.exceptionDetails?.text).slice(0, 500) }); });
    await view.send('Page.enable'); await view.send('Runtime.enable');
    // 録音ワークレット（blob: URL）は webview の CSP（script-src に blob: が無い）に弾かれるので、検証用に CDP で CSP を迂回する
    // （CSP 初期化時に効くため本文の読込前に立てる）。製品コード側の CSP は変更しない。読込に間に合わなかった場合は
    // ScriptProcessorNode にフォールバックする（installRecorder）。
    await view.send('Page.setBypassCSP', { enabled: true });
    await view.send('Network.enable');
    const networkLog = [];
    const networkStartedAt = performance.now();
    const requestsById = new Map();
    view.on('Network.requestWillBeSent', p => {
      const headers = p.request?.headers ?? {};
      const range = headers.Range ?? headers.range ?? null;
      let pathname = p.request?.url ?? '';
      try { pathname = new URL(p.request.url).pathname; } catch { /* keep raw */ }
      // initiator: スクラブ音（/static/<hash>/scrub-audio.js から fetch）か、frame-engine（frame-engine.js）か、それ以外か。
      const frames = p.initiator?.stack?.callFrames ?? [];
      const initiator = frames.some(f => /scrub-audio\.js/.test(f.url)) ? 'scrub'
        : frames.some(f => /frame-engine\.js/.test(f.url)) ? 'engine'
        : (p.initiator?.type ?? 'other');
      const entry = { at: performance.now() - networkStartedAt, path: pathname, method: p.request?.method ?? 'GET', range, type: p.type ?? null, initiator, doneAt: null, status: null };
      networkLog.push(entry);
      requestsById.set(p.requestId, entry);
    });
    view.on('Network.responseReceived', p => { const e = requestsById.get(p.requestId); if (e) e.status = p.response?.status ?? null; });
    view.on('Network.loadingFinished', p => { const e = requestsById.get(p.requestId); if (e) { e.doneAt = performance.now() - networkStartedAt; requestsById.delete(p.requestId); } });
    view.on('Network.loadingFailed', p => { const e = requestsById.get(p.requestId); if (e) { e.doneAt = performance.now() - networkStartedAt; e.status = 'failed'; requestsById.delete(p.requestId); } });
    // タイムライン widget が復元済みなら開かない（開いている状態で akari.annotations.open を叩くと「タイムラインを作成」ダイアログが出る）。
    const timelineAlready = await evalOn(main, `Boolean(document.querySelector('.akari-annotations-widget'))`);
    if (!timelineAlready) {
      await evalOn(main, `(() => { void ${COMMANDS}.executeCommand('akari.annotations.open'); return true; })()`).catch(e => console.warn(`[${config}] timeline open: ${e.message}`));
    }
    // タイムライン widget（akari-annotations）が見えて、strip が幅を持つまで待つ。
    const timelineInfo = await waitFor('timeline widget visible', () => evalOn(main, `(() => {
      const shell = ${SHELL};
      const w = shell.widgets.find(w => w.id === 'akari-annotations-widget' || (w.node && w.node.classList && w.node.classList.contains('akari-annotations-widget')));
      if (!w || !w.isVisible) return null;
      const strip = w.strip && w.strip.getBoundingClientRect();
      if (!strip || strip.width < 200) return null;
      return { id: w.id, strip: { left: strip.left, top: strip.top, width: strip.width, height: strip.height }, viewStart: w.viewStart, visibleDuration: w.visibleDuration(), total: w.totalDuration() };
    })()`), 90000, 500);
    console.log(`[${config}] timeline: ${JSON.stringify(timelineInfo)}`);
    const findContext = async () => {
      for (const id of [...contexts.map(c => c.id).reverse(), undefined]) {
        try { if (await evalOn(view, `Boolean(document.getElementById('preview-stage'))`, id)) { ctxId = id; return true; } } catch { /* other context */ }
      }
      return false;
    };
    await waitFor('preview stage in webview', findContext, 120000, 300);
    const vEval = async (expr, timeoutMs) => {
      const params = { expression: expr, returnByValue: true, awaitPromise: true, ...(ctxId !== undefined ? { contextId: ctxId } : {}) };
      const r = await view.send('Runtime.evaluate', params, timeoutMs ?? 60000);
      if (r.exceptionDetails) throw new Error('evaluate failed: ' + JSON.stringify(r.exceptionDetails).slice(0, 800));
      return r.result.value;
    };
    const readyExpr = `(() => {
      const v = document.getElementById('preview-video');
      const stage = document.getElementById('preview-stage');
      const dbg = window.akari && window.akari.scrubAudioDebug ? window.akari.scrubAudioDebug() : null;
      const engineActive = stage && stage.dataset.frameEngineActive === 'true';
      const engineReady = document.getElementById('frame-engine-preview')?.dataset.frameEngineReady === 'true';
      const bgmOk = ${withBgm && !frameEngine ? '!!(window.akari && window.akari.previewAudio && window.akari.previewAudio.scrubBgm && window.akari.previewAudio.scrubBgm(0))' : 'true'};
      const legacyOk = ${frameEngine ? 'engineActive && engineReady' : 'v && v.readyState >= 1'};
      return { dbg, engineActive, engineReady, videoReadyState: v ? v.readyState : -1, bgmOk, legacyOk,
        ok: !!(dbg && dbg.controller && dbg.enabled && window.akari.scrubAudio && legacyOk && bgmOk) };
    })()`;
    try {
      await waitFor('preview ready (scrubAudio controller + media)', async () => (await vEval(readyExpr)).ok, 120000, 300);
    } catch (error) {
      console.error(`[${config}] ready diag:`, JSON.stringify(await vEval(readyExpr).catch(e => ({ evalError: String(e) }))));
      console.error(`[${config}] console:`, JSON.stringify(consoleLog.slice(-30)));
      throw error;
    }
    // ---------------- recorder tap（ページ読込後に scrub の AudioContext へ仕込む）
    // ワークレットの blob: 読込は CSP 初期化時の bypass が要る。本文の読込に bypass が間に合わなかった
    // （= addModule が AbortError）場合は edit.json に未使用 source を 1 つ足して rebuild（setHTML）させ、
    // 新しい文書でもう一度仕込む。それでも駄目なら ScriptProcessorNode に落とす。
    const installRecorder = () => vEval(`(async () => {
      const s = window.akari.scrubAudio;
      const ctx = s.context;
      if (!window.__scrubTap) {
        const origConnect = AudioNode.prototype.connect;
        const tap = new GainNode(ctx);
        origConnect.call(tap, ctx.destination);
        ctx.__tap = tap;
        window.__scrubTap = { ctx, tap, origConnect, rerouted: [] };
        AudioNode.prototype.connect = function (dest, ...rest) {
          if (dest instanceof AudioDestinationNode && dest.context.__tap && this !== dest.context.__tap && !this.__isTapRecorder) {
            return origConnect.call(this, dest.context.__tap, ...rest);
          }
          return origConnect.call(this, dest, ...rest);
        };
        // legacy の masterGain → meterAnalyser → destination（BGM 断片が通る）を tap へ繋ぎ直す。
        const meter = window.akari.legacyAudioMeterAnalyser;
        if (meter && meter.context === ctx) { try { meter.disconnect(); } catch {} origConnect.call(meter, tap); window.__scrubTap.rerouted.push('legacyAudioMeterAnalyser'); }
        window.__scrubStarts = [];
        window.__scrubCtxOps = [];
        const origStart = AudioBufferSourceNode.prototype.start;
        AudioBufferSourceNode.prototype.start = function (when, offset, duration) {
          try {
            window.__scrubStarts.push({ ctxNow: this.context.currentTime, perfMs: performance.now(), when: when ?? null, offset: offset ?? null, duration: duration ?? null,
              bufferDuration: this.buffer ? this.buffer.duration : null, bufferRate: this.buffer ? this.buffer.sampleRate : null, bufferChannels: this.buffer ? this.buffer.numberOfChannels : null, sameContext: this.context === ctx });
          } catch {}
          return origStart.apply(this, arguments);
        };
        for (const op of ['suspend', 'resume']) {
          const orig = AudioContext.prototype[op];
          AudioContext.prototype[op] = function () {
            window.__scrubCtxOps.push({ op, ctxSec: this.currentTime, perfMs: performance.now(), stateBefore: this.state, scrubCtx: this === ctx });
            return orig.apply(this, arguments);
          };
        }
      }
      if (ctx.state !== 'running') await ctx.resume();
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
      let node = null; let recorderKind = 'worklet';
      const rec = window.__rec = { node: null, chunks: [], recording: false, clock: [], timer: 0 };
      try {
        await ctx.audioWorklet.addModule(url);
        node = new AudioWorkletNode(ctx, 'scrub-rec', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
        node.port.onmessage = e => { if (rec.recording) rec.chunks.push(e.data); };
      } catch (error) {
        // CSP で worklet を読めない環境向けフォールバック: ScriptProcessorNode（16384 フレーム = 341 ms ごと・main thread）。
        recorderKind = 'script-processor:' + String(error && error.message || error);
        node = ctx.createScriptProcessor(16384, 1, 1);
        node.onaudioprocess = event => {
          const input = event.inputBuffer.getChannelData(0);
          const out = event.outputBuffer.getChannelData(0); out.fill(0);
          if (!rec.recording) return;
          rec.chunks.push({ frame: Math.round(event.playbackTime * ctx.sampleRate), samples: Float32Array.from(input) });
        };
      }
      node.__isTapRecorder = true;
      rec.node = node; rec.kind = recorderKind;
      window.__scrubTap.origConnect.call(window.__scrubTap.tap, node);
      window.__scrubTap.origConnect.call(node, ctx.destination);
      rec.start = async () => {
        if (ctx.state !== 'running') await ctx.resume();
        rec.chunks = []; rec.clock = []; rec.recording = true;
        rec.startCtxSec = ctx.currentTime; rec.startPerfMs = performance.now();
        rec.timer = setInterval(() => { const ts = ctx.getOutputTimestamp(); rec.clock.push({ perfMs: performance.now(), ctxSec: ctx.currentTime, outCtx: ts.contextTime, outPerf: ts.performanceTime, state: ctx.state }); }, 100);
      };
      rec.stop = async () => {
        clearInterval(rec.timer);
        if (node.port) node.port.postMessage('flush');
        await new Promise(r => setTimeout(r, recorderKind === 'worklet' ? 150 : 400));
        rec.recording = false;
        const chunks = rec.chunks.slice().sort((x, y) => x.frame - y.frame);
        let total = 0; const gaps = [];
        for (let i = 0; i < chunks.length; i++) { total += chunks[i].samples.length; if (i > 0) { const expected = chunks[i - 1].frame + chunks[i - 1].samples.length; if (chunks[i].frame !== expected) gaps.push({ at: chunks[i].frame, missing: chunks[i].frame - expected }); } }
        const pcm = new Int16Array(total); let o = 0; let peak = 0;
        for (const c of chunks) for (let i = 0; i < c.samples.length; i++) { const s = Math.max(-1, Math.min(1, c.samples[i])); peak = Math.max(peak, Math.abs(s)); pcm[o++] = Math.round(s * 32767); }
        const bytes = new Uint8Array(pcm.buffer); let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
        return { sampleRate: ctx.sampleRate, firstFrame: chunks[0]?.frame ?? -1, frames: total, gaps, peak, startCtxSec: rec.startCtxSec, startPerfMs: rec.startPerfMs, clock: rec.clock, base64: btoa(bin), state: ctx.state };
      };
      if (!s.__origOnSeek) {
        s.__origOnSeek = s.onSeek;
        window.__scrubSeeks = [];
        let seq = 0;
        s.onSeek = function (input) {
          window.__scrubSeeks.push({ seq: ++seq, arrivedCtxSec: ctx.currentTime, arrivedPerfMs: performance.now(), outputTime: input.outputTime, sourceTime: input.sourceTime, src: input.src, isPlaying: !!input.isPlaying, mutedFacade: null });
          return s.__origOnSeek.call(s, input);
        };
      }
      return recorderKind;
    })()`);
    let recorderKind = await installRecorder();
    report.recorderInstall = [{ attempt: 1, recorder: recorderKind }];
    if (recorderKind !== 'worklet') {
      console.warn(`[${config}] worklet recorder unavailable in the first document (${recorderKind}); forcing a preview rebuild so the CSP bypass applies`);
      report.networkBeforeReload = { summary: summarizeRequests(networkLog) };
      const contextsBefore = contexts.length;
      const editPath = path.join(project, 'edit.json');
      const current = JSON.parse(fs.readFileSync(editPath, 'utf8'));
      current.sources.push({ id: 'spare-for-harness-reload', path: 'assets/main.mp4', proxy: null });
      fs.writeFileSync(editPath, `${JSON.stringify(current, null, 2)}\n`);
      fixture.reloadedWithUnusedSource = true;
      await waitFor('preview rebuilt (new document)', async () => {
        if (contexts.length <= contextsBefore) return false;
        if (!(await findContext())) return false;
        try { return (await vEval(readyExpr)).ok && !(await vEval(`Boolean(window.__scrubTap)`)); } catch { return false; }
      }, 120000, 300);
      await sleep(1500);
      networkLog.length = 0;
      recorderKind = await installRecorder();
      report.recorderInstall.push({ attempt: 2, recorder: recorderKind });
    }
    await sleep(1500);
    report.networkAtOpen = { summary: summarizeRequests(networkLog), requests: networkLog.map(r => ({ ...r, at: round1(r.at) })) };
    console.log(`[${config}] requests at open: ${JSON.stringify(report.networkAtOpen.summary)} recorder=${recorderKind}`);
    const pageInfo = await vEval(`(() => {
      const s = window.akari.scrubAudio; const ctx = s.context; const v = document.getElementById('preview-video');
      const stage = document.getElementById('preview-stage');
      const bgm = window.akari.previewAudio && window.akari.previewAudio.scrubBgm ? window.akari.previewAudio.scrubBgm(0) : null;
      return { sampleRate: ctx.sampleRate, baseLatency: ctx.baseLatency, outputLatency: ctx.outputLatency, state: ctx.state, tapped: !!ctx.__tap, rerouted: window.__scrubTap.rerouted, recorder: window.__rec.kind,
        frameEngineActive: stage.dataset.frameEngineActive === 'true', previewAudio: !!window.akari.previewAudio, sharedContextWithPreviewAudio: !!(window.akari.previewAudio && window.akari.legacyAudioMeterAnalyser && window.akari.legacyAudioMeterAnalyser.context === ctx),
        videoSrc: v.currentSrc, videoDuration: v.duration, videoReadyState: v.readyState, videoVolume: v.volume, videoMuted: v.muted,
        bgmDuration: bgm && bgm.node && bgm.node._buffer ? bgm.node._buffer.duration : null, bgmSpec: bgm ? bgm.spec : null,
        userAgent: navigator.userAgent, hasAudioDecoder: typeof AudioDecoder === 'function', scrubDebug: window.akari.scrubAudioDebug(),
        scrubMode: s.mode, scrubEnabled: s.enabled, scrubLastError: s.lastError ?? null, initialScrubAudioEnabled: window.__akariPreview.scrubAudioEnabled,
        scrubBundleGlobal: typeof window.AkariScrubAudio, innerSize: [innerWidth, innerHeight] };
    })()`);
    pageInfo.videoSrc = scrub(pageInfo.videoSrc);
    report.page = pageInfo;
    console.log(`[${config}] page: ${JSON.stringify(pageInfo)}`);
    assert.ok(pageInfo.tapped, 'tap must be installed');
    assert.equal(pageInfo.scrubEnabled, true, 'scrub audio must default to enabled');
    assert.equal(pageInfo.initialScrubAudioEnabled, true, 'initial state scrubAudioEnabled must be true by default');
    if (!frameEngine) assert.equal(pageInfo.sharedContextWithPreviewAudio, withBgm, withBgm ? 'legacy + BGM: scrub must share the previewAudio context' : 'nobgm: previewAudio is null (hasAudio false) but scrub has its own context');
    if (config !== 'real') {
      // 実素材のフレーム（オーナーの実録画）は証跡に残さない。合成素材の構成だけスクリーンショットを撮る。
      const shot = await main.send('Page.captureScreenshot', { format: 'jpeg', quality: 50 });
      fs.writeFileSync(path.join(evidenceDir, `${sessionKey}-shell.jpg`), Buffer.from(shot.data, 'base64'));
    }
    // ---------------- drag driver（実マウス）
    // プレイヘッドのつまみの位置と、その点で実際にヒットする要素（通知トーストなどが被っていないか）。被っていれば
    // Theia の通知を閉じてから測り直す（別レーンの負荷で起動が遅れると、プロジェクト同意やトラック整理の通知が後から出ることがある）。
    const timelineState = async () => {
      for (let attempt = 0; attempt < 3; attempt++) {
        const st = await evalOn(main, `(() => {
          const shell = ${SHELL};
          const w = shell.widgets.find(w => w.id === 'akari-annotations-widget' || (w.node && w.node.classList && w.node.classList.contains('akari-annotations-widget')));
          const strip = w.strip.getBoundingClientRect();
          const handle = w.playheadHandle.getBoundingClientRect();
          const x = handle.left + handle.width / 2; const y = handle.top + handle.height / 2;
          const hit = document.elementFromPoint(x, y);
          const hitOk = !!hit && (hit === w.playheadHandle || w.playheadHandle.contains(hit));
          return { strip: { left: strip.left, top: strip.top, width: strip.width, height: strip.height }, handle: { x, y, width: handle.width, height: handle.height },
            viewStart: w.viewStart, visibleDuration: w.visibleDuration(), playheadT: w.playheadT, hitOk, hitTag: hit ? (hit.tagName + '.' + String(hit.className).slice(0, 60)) : null };
        })()`);
        if (st.hitOk) return st;
        const covering = await evalOn(main, `(() => {
          const dialog = document.querySelector('.dialogOverlay');
          const text = dialog ? (dialog.querySelector('.dialogTitle')?.textContent + ' | ' + (dialog.querySelector('.dialogContent')?.textContent ?? '').slice(0, 200)) : null;
          const buttons = dialog ? [...dialog.querySelectorAll('button')].map(b => b.textContent?.trim()) : [];
          return { text, buttons };
        })()`);
        console.warn(`[${config}] playhead handle is covered by ${st.hitTag} (${JSON.stringify(covering)}); dismissing dialog / notifications and retrying`);
        report.coveredBy = report.coveredBy ?? [];
        report.coveredBy.push({ hitTag: st.hitTag, ...covering });
        await evalOn(main, `(() => {
          const dialog = document.querySelector('.dialogOverlay');
          if (dialog) {
            const close = dialog.querySelector('.dialogClose') || [...dialog.querySelectorAll('button')].find(b => /閉じる|キャンセル|Cancel|Close|OK/i.test(b.textContent ?? '')) || dialog.querySelector('button');
            if (close) close.click();
          }
          for (const b of document.querySelectorAll('.theia-notification-list .theia-notification-list-item-container .codicon-close, .theia-notification-list button[title="Clear"], .theia-notification-actions button')) { try { b.click(); } catch {} }
          const open = [...document.querySelectorAll('button')].find(e => e.textContent?.trim() === '開くだけ'); if (open) open.click();
          return true;
        })()`);
        await main.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }).catch(() => undefined);
        await main.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }).catch(() => undefined);
        await sleep(800);
      }
      throw new Error('playhead handle is not hittable');
    };
    // x は小数のまま渡す（macOS のトラックパッド / 高解像度マウスと同じく pointermove の clientX が小数になり、
    // 30 Hz の各 tick が別の時刻の seek になる。整数 px に丸めると同じ時刻の seek が連続して断片を鳴らし直す）。
    const mouse = (type, x, y, extra = {}) => main.send('Input.dispatchMouseEvent', { type, x: Math.round(x * 1000) / 1000, y: Math.round(y), button: 'left', ...(type === 'mouseMoved' ? { buttons: 1 } : type === 'mousePressed' ? { buttons: 1, clickCount: 1 } : {}), ...extra });
    const dragPattern = async (pattern, tickHz) => {
      const n = Math.round(pattern.seconds * tickHz);
      const st = await timelineState();
      const xAt = t => st.strip.left + (t - st.viewStart) / st.visibleDuration * st.strip.width;
      await main.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round(st.handle.x), y: Math.round(st.handle.y), button: 'none' });
      await sleep(40);
      await mouse('mousePressed', st.handle.x, st.handle.y);
      await sleep(40);
      const started = performance.now();
      const sendTimes = [];
      // 120 Hz（8.3 ms 間隔）では CDP の往復待ちが tick を食うので ack を待たずに送る（CDP は順序保証）。
      // 送出は Promise を集めて最後にまとめて待つ。
      const inFlight = [];
      for (let i = 0; i < n; i++) {
        const due = started + (i * 1000) / tickHz;
        let wait = due - performance.now();
        while (wait > 1.2) { await sleep(wait - 1); wait = due - performance.now(); }
        while (performance.now() < due) { /* 1 ms 未満はスピンで詰める（sleep の分解能が足りない） */ }
        sendTimes.push(performance.now() - started);
        inFlight.push(mouse('mouseMoved', xAt(pattern.timeAt(i, n)), st.handle.y).catch(() => undefined));
      }
      const xEnd = xAt(pattern.timeAt(n - 1, n));
      inFlight.push(mouse('mouseReleased', xEnd, st.handle.y).catch(() => undefined));
      await Promise.all(inFlight);
      return { started, sendTimes, pxPerSec: st.strip.width / st.visibleDuration, handleY: st.handle.y, stripLeft: st.strip.left, hitTag: st.hitTag, playheadTBefore: st.playheadT };
    };
    const roleOf = line => {
      if (!line.includes(userDataDir)) return null;
      if (line.includes('--type=renderer')) return 'renderer';
      if (line.includes('--type=gpu-process')) return 'gpu';
      if (line.includes('audio.mojom.AudioService')) return 'audio-service';
      if (line.includes('--type=utility')) return 'utility-other';
      if (line.includes('--type=')) return 'other';
      return 'browser-main';
    };
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
      exec('ps -eo pid,ppid,%cpu,time,args', { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }, (error, stdout) => { cpuInFlight = false; if (!error) sink.push(...parseCpu(stdout, now)); });
    };
    const sampleCpu = () => parseCpu(execSync('ps -eo pid,ppid,%cpu,time,args', { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }), performance.now());
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
        cpu[role].pct += pct; cpu[role].psMax = Math.max(cpu[role].psMax, ...list.map(s => s.cpuPct)); cpu[role].pids++;
      }
      for (const role of Object.keys(cpu)) { cpu[role].pct = round1(cpu[role].pct); cpu[role].psMax = round1(cpu[role].psMax); }
      return cpu;
    };
    const attachStarts = (seeks, starts) => {
      const sorted = [...seeks].sort((a, b) => a.arrivedCtxSec - b.arrivedCtxSec);
      for (const start of starts) {
        let owner = null;
        for (const s of sorted) { if (s.arrivedCtxSec <= start.ctxNow + 1e-6) owner = s; else break; }
        if (!owner) continue;
        const isMain = start.bufferDuration !== null && start.bufferDuration < 5;
        if (isMain) { owner.mainStartedCtxSec = start.when; owner.mainStartedPerfMs = start.perfMs; owner.mainOffsetSec = start.offset; owner.mainDurationSec = start.duration; owner.windowSec = start.bufferDuration; owner.windowRate = start.bufferRate; }
        else { owner.bgmStartedCtxSec = start.when; owner.bgmOffsetSec = start.offset; }
      }
      for (const s of sorted) { s.mainStartedCtxSec ??= null; s.bgmStartedCtxSec ??= null; s.bgmOffsetSec ??= null; s.skipped = s.isPlaying ? 'playing' : (s.mainStartedCtxSec === null && s.bgmStartedCtxSec === null ? 'superseded-or-skipped' : null); s.error = null; }
      return sorted;
    };
    // モード切替（設定 / globalMuted / 再生）。
    const setPreference = async enabled => {
      await evalOn(main, `(async () => { await ${PREFERENCES}.set('akari.preview.scrubAudio', ${enabled}); return true; })()`);
      await waitFor(`webview scrub controllerEnabled=${enabled}`, async () => { const d = await vEval(`window.akari.scrubAudioDebug()`); return d.enabled === enabled && (enabled ? d.controllerEnabled === true : d.controllerEnabled === false); }, 15000, 200);
    };
    const setMuted = async muted => {
      await evalOn(main, `(() => { window.dispatchEvent(new CustomEvent('akari.timeline.setMuted', { detail: { editUri: ${JSON.stringify(editUri)}, muted: ${muted} } })); return true; })()`);
      await waitFor(`webview globalMuted=${muted}`, async () => (await vEval(`document.getElementById('preview-video').dataset.akariGlobalMuted`)) === String(muted), 15000, 200);
    };
    const togglePlayback = async playing => {
      // コマンドの Promise は待たない（host 側で解決が遅れることがある）。webview 側の再生状態で待つ。
      await evalOn(main, `(() => { void ${COMMANDS}.executeCommand('akari.preview.togglePlayback', { editUri: ${JSON.stringify(editUri)} }); return true; })()`);
      await waitFor(`webview playing=${playing}`, async () => (await vEval(`document.getElementById('play-toggle').getAttribute('aria-pressed') === 'true' || !document.getElementById('preview-video').paused`)) === playing, 15000, 200);
    };
    let currentMode = 'on';
    const applyMode = async mode => {
      if (currentMode === mode) return;
      if (currentMode === 'off') await setPreference(true);
      if (currentMode === 'muted') await setMuted(false);
      if (currentMode === 'playing') await togglePlayback(false);
      if (mode === 'off') await setPreference(false);
      if (mode === 'muted') await setMuted(true);
      if (mode === 'playing') await togglePlayback(true);
      currentMode = mode;
    };
    {
      for (const entry of plan) {
        const { mode, pattern: key, hz } = entry;
        await applyMode(mode);
        const pattern = PATTERNS[key];
        const runId = `${config}-${mode}-${key}-${hz}hz`;
        console.log(`[run] ${runId}: ${pattern.label}`);
        const runStartedAt = performance.now() - networkStartedAt;
        try {
          const before = await vEval(`(async () => { window.__scrubSeeks.length = 0; window.__scrubStarts.length = 0; window.__scrubCtxOps.length = 0;
            const ctx = window.akari.scrubAudio.context; if (ctx.state !== 'running') await ctx.resume(); return window.akari.scrubAudioDebug(); })()`);
          await sleep(500);
          const samples = [];
          samples.push(...sampleCpu());
          const sampler = setInterval(() => sampleCpuAsync(samples), 200);
          await vEval(`window.__rec.start()`);
          const drag = await dragPattern(pattern, hz);
          const remaining = pattern.recordSec * 1000 - (performance.now() - drag.started);
          if (remaining > 0) await sleep(remaining);
          clearInterval(sampler);
          await sleep(250);
          samples.push(...sampleCpu());
          const recording = await vEval(`window.__rec.stop()`, 120000);
          const hooks = await vEval(`({ seeks: window.__scrubSeeks.slice(), starts: window.__scrubStarts.slice(), ctxOps: window.__scrubCtxOps.slice(), lastError: window.akari.scrubAudio.lastError ?? null, mode: window.akari.scrubAudio.mode, debug: window.akari.scrubAudioDebug(), playing: !document.getElementById('preview-video').paused })`);
          const requests = networkLog.filter(r => r.at >= runStartedAt).map(r => ({ ...r, at: round1(r.at - runStartedAt), doneAt: r.doneAt === null ? null : round1(r.doneAt - runStartedAt) }));
          const pcm = Buffer.from(recording.base64, 'base64');
          const int16 = new Int16Array(pcm.buffer, pcm.byteOffset, pcm.length / 2);
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
          const stats = { mode: hooks.mode, fragmentMs: FRAGMENT_MS, lastError: hooks.lastError, seeks, starts: hooks.starts.length, ctxOps: hooks.ctxOps, debugBefore: before, debugAfter: hooks.debug, playingDuringRun: hooks.playing,
            summary: { count: seeks.length, played, skipped: seeks.length - played, errors: 0 } };
          const run = { id: runId, config, session: sessionKey, mode, pattern: key, label: `${pattern.label} @ ${hz} Hz`, ticks: Math.round(pattern.seconds * hz), tickHz: hz,
            patternSpeed: pattern.speed, dragSeconds: pattern.seconds, uncapFps: session.uncapFps,
            drag: { pxPerSec: round1(drag.pxPerSec * 10) / 10, sendJitterMaxMs: round1(Math.max(...drag.sendTimes.map((t, i) => Math.abs(t - i * 1000 / hz)))), hitTag: drag.hitTag, playheadTBefore: drag.playheadTBefore, loadAvg: os.loadavg().map(v => +v.toFixed(2)) },
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
          report.failedRuns.push({ id: runId, config, mode, pattern: key, error: message.slice(0, 800), consoleTail: consoleLog.slice(-10).map(e => ({ ...e, text: scrub(e.text) })) });
          try { await mouse('mouseReleased', VIEW_W / 2, VIEW_H / 2); } catch { /* noop */ }
          try { await vEval(`(() => { try { window.__rec && clearInterval(window.__rec.timer); window.__rec && (window.__rec.recording = false); window.akari?.scrubAudio?.stop?.(); } catch {} return true; })()`); } catch { /* page may be gone */ }
          await sleep(800);
        }
      }
      await applyMode('on');
    }
    report.console = consoleLog.slice(0, 200).map(e => ({ ...e, text: scrub(e.text) }));
    report.networkAll = { summary: summarizeRequests(networkLog), byPath: Object.entries(networkLog.reduce((acc, r) => { const key = `${r.method} ${r.path.replace(/[a-f0-9]{64}/, '<id>').replace(/\/static\/[a-f0-9]+\//, '/static/<hash>/')}${r.range ? ' [Range]' : ''} (${r.type})`; acc[key] = (acc[key] ?? 0) + 1; return acc; }, {})).sort((a, b) => b[1] - a[1]).slice(0, 40),
      moovFetches: networkLog.filter(r => r.type === 'Fetch' && r.initiator === 'scrub' && r.range && (rangeSpan(r.range) ?? 0) > 8192 && r.at < 60000).map(r => ({ at: round1(r.at), path: r.path.replace(/[a-f0-9]{64}/, '<id>'), range: r.range, ms: r.doneAt !== null ? round1(r.doneAt - r.at) : null })).slice(0, 12) };
    const cacheDir = path.join(project, '.akari', 'cache');
    const listCache = dir => fs.existsSync(dir) ? fs.readdirSync(dir, { recursive: true }).map(f => ({ file: String(f), bytes: (() => { try { return fs.statSync(path.join(dir, String(f))).size; } catch { return null; } })() })) : [];
    report.projectCache = { dir: scrub(cacheDir), entries: listCache(cacheDir) };
  } catch (error) {
    console.error(`[${config}] failed:`, scrub(error?.stack ?? error));
    report.error = scrub(error?.stack ?? String(error));
    report.consoleOnFailure = consoleLog.slice(-40).map(e => ({ ...e, text: scrub(e.text) }));
  } finally {
    await cleanup();
  }
  report.finishedAt = new Date().toISOString();
  try { report.electronLogTail = scrub(fs.readFileSync(electronLogPath, 'utf8').slice(-3000)); } catch { /* noop */ }
  const suffix = `-${sessionKey}`;
  if (report.error) {
    fs.writeFileSync(path.join(evidenceDir, `l1-raw${suffix}-failed.json`), `${JSON.stringify(report, null, 2)}\n`);
    return false;
  }
  fs.writeFileSync(path.join(evidenceDir, `l1-raw${suffix}.json`), `${JSON.stringify(report, null, 2)}\n`);
  const analysis = analyzeRun(report, evidenceDir);
  analysis.config = config;
  analysis.session = sessionKey;
  analysis.uncapFps = session.uncapFps;
  fs.writeFileSync(path.join(evidenceDir, `l1-results${suffix}.json`), `${JSON.stringify(analysis, null, 2)}\n`);
  writeSummaryMarkdown(analysis, path.join(evidenceDir, `l1-summary${suffix}.md`));
  console.log(fs.readFileSync(path.join(evidenceDir, `l1-summary${suffix}.md`), 'utf8'));
  console.log(`[${sessionKey}] cleanup: ${JSON.stringify(report.cleanup)}`);
  return !(report.failedRuns?.length);
}

let allOk = true;
for (const key of SESSION_KEYS) {
  const ok = await runConfig(key);
  allOk = allOk && ok;
  await sleep(1500);
}
if (!keepTmp) fs.rmSync(work, { recursive: true, force: true });
console.log(`[done] ${allOk ? 'all runs ok' : 'some runs failed'}; surviving shell backend processes for this worktree: ${psCount(path.join(shellRoot, 'lib/backend/main.js'))}`);
process.exit(allOk ? 0 : 1);
