#!/usr/bin/env node
/**
 * L0 の A/B 証跡 — 上のトラックに拡縮（PiP）を付けて内部モデルで `layers` へ退避された
 * 動画クリップの音が、書き出し（render-cut CLI）で鳴るようになったことを実測する。
 *
 * 修正前（基点）は本 worktree を汚さないよう、基点コミットの git worktree を
 * そのまま CLI として使う（node_modules と media-bin/vendor だけ symlink）。
 *
 * 計測: 1 秒ごとに周波数が変わるトーン（300 + 100*floor(t) Hz）を持つ 10 秒素材を
 * 下段（source 0-6s → 出力 0-6s）と上段（source 6-10s → 出力 2-6s・scale 0.5）に置き、
 * 重なり区間 2-6s で 2 つの周波数が同時に立っているかを Goertzel で測る。
 *
 * 使い方: node evidence/layer-audio-mix/l0-cli-layer-audio.mjs <基点 worktree の絶対パス>
 * 検証専用スクリプト（製品コードではない・ラッパーが検証のために書いた）。
 */
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const baseRoot = process.argv[2];
if (!baseRoot) throw new Error('usage: l0-cli-layer-audio.mjs <base-worktree-path>');

const FFMPEG = path.join(repoRoot, 'packages/media-bin/vendor/darwin-arm64/ffmpeg');
const FFPROBE = path.join(repoRoot, 'packages/media-bin/vendor/darwin-arm64/ffprobe');
const CLI_AFTER = path.join(repoRoot, 'packages/render-cut/bin/render-cut.mjs');
const CLI_BEFORE = path.join(baseRoot, 'packages/render-cut/bin/render-cut.mjs');

const work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'layer-audio-l0-')));

const ffmpeg = (args) => {
  const result = spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr);
};
const sha256 = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
// gpu-export の Electron はこの機械では 3〜4 回に 1 回ハングする（他レーンと GPU を取り合う）。
// 制限時間を切って掃除し、同じ入力でやり直す。回数と所要は証跡に残す。
const RENDER_TIMEOUT_MS = 240_000;
const sweep = (needle) => {
  const listed = spawnSync('/bin/ps', ['-eo', 'pid,args'], { encoding: 'utf8' }).stdout ?? '';
  const pids = listed.split('\n').filter((line) => line.includes(needle))
    .map((line) => Number(line.trim().split(/\s+/u)[0])).filter(Number.isInteger);
  for (const pid of pids) { try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ } }
  return pids.length;
};
const render = (cli, projectRoot, outName) => {
  const attempts = [];
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const startedAt = Date.now();
    const result = spawnSync(process.execPath, [cli, projectRoot, '--out', outName, '--force'],
      { encoding: 'utf8', cwd: projectRoot, timeout: RENDER_TIMEOUT_MS, killSignal: 'SIGKILL' });
    const swept = sweep(projectRoot);
    const lines = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim().split('\n');
    const outcome = {
      attempt, exitCode: result.status, timedOut: result.signal === 'SIGKILL' || result.error?.code === 'ETIMEDOUT',
      elapsedSec: Number(((Date.now() - startedAt) / 1000).toFixed(1)), sweptProcesses: swept,
      lastLine: lines[lines.length - 1] ?? '',
    };
    attempts.push(outcome);
    if (result.status === 0 || !outcome.timedOut) {
      return { exitCode: result.status, lastLine: outcome.lastLine, attempts };
    }
  }
  return { exitCode: null, lastLine: 'timed out after 3 attempts', attempts };
};
const probe = (file) => JSON.parse(spawnSync(FFPROBE, ['-v', 'error', '-show_entries',
  'format=duration:stream=codec_type,codec_name,duration', '-of', 'json', file], { encoding: 'utf8' }).stdout);

// Goertzel（0.25 秒窓 = 48kHz / 12000 サンプルで各トーンが整数周期になる）。
const tones = (file) => {
  const pcm = spawnSync(FFMPEG, ['-v', 'error', '-i', file, '-map', '0:a:0', '-ac', '1', '-ar', '48000',
    '-f', 'f32le', 'pipe:1'], { maxBuffer: 1 << 28 }).stdout;
  const amplitude = (frequency, at) => {
    const rate = 48000;
    const count = rate / 4;
    const start = Math.round(at * rate);
    if ((start + count) * 4 > pcm.length) return null;
    const coefficient = 2 * Math.cos((2 * Math.PI * frequency) / rate);
    let previous = 0;
    let beforePrevious = 0;
    for (let i = 0; i < count; i += 1) {
      const value = pcm.readFloatLE((start + i) * 4) + coefficient * previous - beforePrevious;
      beforePrevious = previous;
      previous = value;
    }
    return Number(((2 * Math.sqrt(Math.max(0, previous ** 2 + beforePrevious ** 2
      - coefficient * previous * beforePrevious))) / count).toFixed(5));
  };
  // 出力 t での期待周波数: 下段 = source t、上段 = source 6+(t-2) = t+4。
  return [0.5, 1.5, 2.5, 3.5, 4.5, 5.5].map((at) => ({
    at,
    lower: { hz: 300 + 100 * Math.floor(at), amplitude: amplitude(300 + 100 * Math.floor(at), at) },
    upper: { hz: 300 + 100 * Math.floor(at + 4), amplitude: amplitude(300 + 100 * Math.floor(at + 4), at) },
    inOverlap: at >= 2,
  }));
};

const makeProject = (name, editDoc) => {
  const root = path.join(work, name);
  fs.mkdirSync(path.join(root, 'assets'), { recursive: true });
  const wav = path.join(root, 'source.wav');
  ffmpeg(['-f', 'lavfi', '-i', 'aevalsrc=0.5*sin(2*PI*(300+100*floor(t))*t):d=10:s=48000', '-ac', '1', wav]);
  ffmpeg(['-f', 'lavfi', '-i', 'color=c=0x203040:s=320x180:r=30:d=10', '-i', wav,
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k',
    '-shortest', path.join(root, 'assets/source.mp4')]);
  fs.rmSync(wav);
  fs.writeFileSync(path.join(root, 'edit.json'), `${JSON.stringify(editDoc, null, 2)}\n`);
  return root;
};

const visual = (id, items, extra = {}) => ({ id, lane: 'visual', items, ...extra });
const media = (src, inSec, outSec, extra = {}) => ({ kind: 'media', src, in: inSec, out: outSec, ...extra });
const baseEdit = {
  version: 2,
  output: { width: 320, height: 180, fps: 30 },
  sources: [{ id: 'main', path: 'assets/source.mp4' }],
};
// tracks[] の配列順は画面の下から上。上段（配列の後ろ）に transform（拡縮）を付けると
// internal-model の needsCrossTrackLayers が真になり、その item だけ layers へ退避される。
const pipUpper = (sourceExtra = {}, itemExtra = {}) => ({
  id: 'upper', at: 60, duration: 120, transform: { scale: 0.5 },
  source: media('main', 6, 10, sourceExtra), ...itemExtra,
});
const lower = { id: 'lower', at: 0, duration: 180, source: media('main', 0, 6) };

const report = {
  baseCommit: execFileSync('git', ['-C', baseRoot, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim(),
  headCommit: execFileSync('git', ['-C', repoRoot, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim(),
  ffmpeg: spawnSync(FFMPEG, ['-version'], { encoding: 'utf8' }).stdout.split('\n')[0],
  node: process.version,
  cases: {},
};

const scrub = (value) => value
  .split(repoRoot).join('<WORKTREE>')
  .split(baseRoot).join('<BASE-WORKTREE>')
  .split(work).join('<TMP>')
  .split(os.homedir()).join('<HOME>');
const outPath = path.join(repoRoot, 'evidence/layer-audio-mix/l0-cli-layer-audio.json');
fs.mkdirSync(path.dirname(outPath), { recursive: true });
// ハングしても途中までの実測が残るよう、ケースごとに書き出す。
const flush = () => fs.writeFileSync(outPath, `${scrub(JSON.stringify(report, null, 2))}\n`);

// --- (1) PiP（transform 付き = layers 送り）の音 ---------------------------------
{
  const root = makeProject('pip', { ...baseEdit, tracks: [
    visual('visual-lower', [lower]),
    visual('visual-upper', [pipUpper()]),
  ] });
  const layersOf = JSON.parse(execFileSync(process.execPath, ['-e', `
    const s = require(${JSON.stringify(path.join(repoRoot, 'packages/edit-store/lib/index.js'))});
    const doc = JSON.parse(require('node:fs').readFileSync(${JSON.stringify(path.join(root, 'edit.json'))}, 'utf8'));
    const legacy = s.projectLegacyEdit(s.readInternalEdit(doc));
    process.stdout.write(JSON.stringify({ cutIds: legacy.cuts.map(c => c.src + '@' + c.at),
      layerIds: legacy.layers.map(l => l.id) }));
  `], { encoding: 'utf8' }));
  const before = render(CLI_BEFORE, root, 'before.mp4');
  const after = render(CLI_AFTER, root, 'after.mp4');
  report.cases.pipLayerAudio = {
    routing: layersOf,
    before: { ...before, tones: fs.existsSync(path.join(root, 'before.mp4')) ? tones(path.join(root, 'before.mp4')) : null },
    after: {
      ...after,
      probe: fs.existsSync(path.join(root, 'after.mp4')) ? probe(path.join(root, 'after.mp4')) : null,
      tones: fs.existsSync(path.join(root, 'after.mp4')) ? tones(path.join(root, 'after.mp4')) : null,
    },
  };
  flush();
}

// --- (2) PiP + インスペクターのミュート（source.mute = true） ---------------------
{
  const root = makeProject('pip-muted', { ...baseEdit, tracks: [
    visual('visual-lower', [lower]),
    visual('visual-upper', [pipUpper({ mute: true })]),
  ] });
  const after = render(CLI_AFTER, root, 'after.mp4');
  report.cases.pipLayerMuted = {
    after: { ...after, tones: fs.existsSync(path.join(root, 'after.mp4')) ? tones(path.join(root, 'after.mp4')) : null },
  };
  flush();
}

// --- (3) PiP + インスペクターの音量 -6 dB（source.gain_db） -----------------------
{
  const root = makeProject('pip-gain', { ...baseEdit, tracks: [
    visual('visual-lower', [lower]),
    visual('visual-upper', [pipUpper({ gain_db: -6 })]),
  ] });
  const after = render(CLI_AFTER, root, 'after.mp4');
  report.cases.pipLayerGain = {
    after: { ...after, tones: fs.existsSync(path.join(root, 'after.mp4')) ? tones(path.join(root, 'after.mp4')) : null },
  };
  flush();
}

// --- (4) 単一トラック（レイヤー無し）の書き出しが基点と byte 一致 ------------------
for (const [name, items] of [
  ['singleTrackSequential', [
    { id: 'c1', at: 0, duration: 90, source: media('main', 0.7, 3.7) },
    { id: 'c2', at: 90, duration: 90, source: media('main', 5, 8) },
  ]],
  ['singleTrackWithGapAmix', [
    { id: 'c1', at: 0, duration: 90, source: media('main', 0.7, 3.7) },
    { id: 'c2', at: 120, duration: 90, source: media('main', 5, 8) },
  ]],
]) {
  const root = makeProject(name, { ...baseEdit, tracks: [visual('v1', items)] });
  const before = render(CLI_BEFORE, root, 'before.mp4');
  const after = render(CLI_AFTER, root, 'after.mp4');
  report.cases[name] = {
    before, after,
    beforeSha256: sha256(path.join(root, 'before.mp4')),
    afterSha256: sha256(path.join(root, 'after.mp4')),
    byteIdentical: sha256(path.join(root, 'before.mp4')) === sha256(path.join(root, 'after.mp4')),
  };
  flush();
}

// --- 判定 ---------------------------------------------------------------------
const overlapOf = (tonesValue) => (tonesValue ?? []).filter((row) => row.inOverlap);
report.verdict = {
  beforeUpperSilentInOverlap: overlapOf(report.cases.pipLayerAudio.before.tones)
    .every((row) => (row.upper.amplitude ?? 0) < 0.02),
  afterBothTonesAudibleInOverlap: overlapOf(report.cases.pipLayerAudio.after.tones)
    .every((row) => row.lower.amplitude > 0.05 && row.upper.amplitude > 0.05),
  afterUpperSilentBeforeOverlap: (report.cases.pipLayerAudio.after.tones ?? [])
    .filter((row) => !row.inOverlap)
    .every((row) => row.upper.amplitude < 0.02 && row.lower.amplitude > 0.05),
  mutedUpperSilentInOverlap: overlapOf(report.cases.pipLayerMuted.after.tones)
    .every((row) => (row.upper.amplitude ?? 0) < 0.02 && row.lower.amplitude > 0.05),
  // -6 dB は振幅 1/2。既定（gain 無し）の同時刻の実測値に対する比で見る。
  gainMinus6HalvesUpper: overlapOf(report.cases.pipLayerGain.after.tones).every((row, index) => {
    const reference = overlapOf(report.cases.pipLayerAudio.after.tones)[index]?.upper.amplitude ?? 0;
    const ratio = reference > 0 ? row.upper.amplitude / reference : 0;
    return ratio > 0.45 && ratio < 0.56;
  }),
  singleTrackByteIdentical: report.cases.singleTrackSequential.byteIdentical
    && report.cases.singleTrackWithGapAmix.byteIdentical,
};

flush();
fs.rmSync(work, { recursive: true, force: true });
console.log(scrub(JSON.stringify(report.verdict, null, 2)));
