#!/usr/bin/env node
// 宣言（declarations.json）+ 音源 → ビートマップ（拍グリッド / 拍別音量 / 波形エンベロープ）
//
//   node beatmap.mjs <project> <track-id> [--track <wav>] [--out <path>] [--declarations <path>]
//
// 出力 JSON: { bpm, beat, offset, duration, sections, hits, beats[], beat_intensity[], env30[] }
// 生成時に「区間境界・キメが計算拍とどれだけズレているか」を stderr へ出す（宣言の健全性チェック）。
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';

const args = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const positional = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));
const [projectArg, trackId] = positional;
if (!projectArg || !trackId) {
  console.error('usage: beatmap.mjs <project> <track-id> [--track <wav>] [--out <path>] [--declarations <path>]');
  process.exit(1);
}
const projectRoot = resolve(projectArg);

const declPath = flag('declarations') ?? [
  join(projectRoot, 'assets', 'audio', 'declarations.json'),
  join(homedir(), '.akari', 'assets', 'audio', 'declarations.json'),
].find(existsSync);
if (!declPath || !existsSync(declPath)) {
  console.error('declarations.json が見つかりません。--declarations で指定するか、declare-audio で宣言を付けてください。');
  process.exit(1);
}
const decl = JSON.parse(readFileSync(declPath, 'utf8'))[trackId];
if (!decl) {
  console.error(`宣言に "${trackId}" がありません（${declPath}）。declare-audio で付けてください。`);
  process.exit(1);
}
if (!Number.isFinite(decl.bpm) || !Number.isFinite(decl.beat_offset_s)) {
  console.error(`"${trackId}" に bpm / beat_offset_s がありません。宣言が不完全です。`);
  process.exit(1);
}

const trackPath = flag('track') ?? [
  join(projectRoot, 'assets', 'bgm', `${trackId}.wav`),
  join(projectRoot, 'assets', 'audio', trackId, 'track.wav'),
  join(homedir(), '.akari', 'assets', 'audio', trackId, 'track.wav'),
].find(existsSync);
if (!trackPath || !existsSync(trackPath)) {
  console.error('音源が見つかりません。--track で wav を指定してください。');
  process.exit(1);
}

const ffprobe = (a) => execFileSync('ffprobe', a, { encoding: 'utf8' }).trim();
const duration = Number(ffprobe(['-v', 'error', '-show_entries', 'format=duration',
  '-of', 'default=noprint_wrappers=1:nokey=1', trackPath]));
if (!Number.isFinite(duration) || duration <= 0) {
  console.error('ffprobe が音源の尺を返しませんでした。');
  process.exit(1);
}

// --- 30fps の RMS エンベロープ（mono 8kHz へ落として十分）
const FPS = 30, SR = 8000;
const pcm = execFileSync('ffmpeg',
  ['-v', 'error', '-i', trackPath, '-ac', '1', '-ar', String(SR), '-f', 's16le', '-'],
  { maxBuffer: 1 << 28 });
const samplesPerFrame = Math.floor(SR / FPS);
const env = [];
for (let i = 0; i + samplesPerFrame <= pcm.length / 2; i += samplesPerFrame) {
  let sum = 0;
  for (let k = 0; k < samplesPerFrame; k += 2) {
    const v = pcm.readInt16LE((i + k) * 2);
    sum += v * v;
  }
  env.push(Math.sqrt(sum / (samplesPerFrame / 2)));
}
const peak = Math.max(...env, 1);
const env30 = env.map((e) => Math.round((e / peak) * 1000) / 1000);

// --- 拍グリッド
const beatLength = 60 / decl.bpm;
const beats = [];
for (let t = decl.beat_offset_s; t < duration; t += beatLength) {
  beats.push(Math.round(t * 1000) / 1000);
}
const beatIntensity = beats.map((b) => {
  const f0 = Math.max(0, Math.floor(b * FPS));
  const f1 = Math.min(env30.length, Math.ceil((b + beatLength) * FPS));
  const window = env30.slice(f0, f1);
  return window.length ? Math.max(...window) : 0;
});

// --- 宣言の健全性: 区間境界・キメが計算拍からどれだけズレているか
const nearest = (t) => beats.reduce((best, b) => (Math.abs(b - t) < Math.abs(best - t) ? b : best), beats[0] ?? 0);
let worst = 0;
const report = [];
for (const s of decl.sections ?? []) {
  const d = nearest(s.start_sec) - s.start_sec;
  worst = Math.max(worst, Math.abs(d));
  report.push(`  section ${String(s.label).padEnd(8)} ${s.start_sec.toFixed(2)}s → 拍とのズレ ${(d * 1000).toFixed(0)}ms`);
}
for (const h of decl.hit_points ?? []) {
  const d = nearest(h) - h;
  worst = Math.max(worst, Math.abs(d));
  report.push(`  hit      ${h.toFixed(3)}s → 拍とのズレ ${(d * 1000).toFixed(0)}ms`);
}
console.error(`ビートマップ: BPM ${decl.bpm} / 頭拍 ${decl.beat_offset_s}s / ${beats.length} 拍 / ${(beats.length / 4).toFixed(1)} 小節`);
console.error(report.join('\n'));
if (worst > 0.06) {
  console.error(`\n⚠ 最大ズレ ${(worst * 1000).toFixed(0)}ms — BPM か頭拍の宣言を疑ってください（declare-audio で耳の答え合わせを）。`);
} else {
  console.error(`\n✓ 区間・キメはすべて計算拍と ±${(worst * 1000).toFixed(0)}ms 以内で一致しています。`);
}

const outPath = resolve(flag('out') ?? join(projectRoot, '.akari', 'work', 'beatmap.json'));
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify({
  track_id: trackId,
  track_path: trackPath,
  bpm: decl.bpm,
  beat: Math.round(beatLength * 1e6) / 1e6,
  offset: decl.beat_offset_s,
  duration,
  time_signature: decl.time_signature ?? '4/4',
  sections: decl.sections ?? [],
  hits: decl.hit_points ?? [],
  beats,
  beat_intensity: beatIntensity,
  env30,
}));
console.log(outPath);
