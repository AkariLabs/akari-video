#!/usr/bin/env node
// GPU と OSR の書き出し（同じ fixture）を、字幕の区間の全フレームで画素比較する（ラッパー作成の検証スクリプト）。
// 使い方: node compare.mjs <osr.mp4> <gpu.mp4> <out.json> [--sheet-dir=<dir>]
// 量（フレームごと・1280×720）:
//   hl     = 塗りの色（done_color / 既定 #ffd94a）に最も近く距離 < 80 の画素数（= 塗られた面積）
//   hcx / hcy = 塗りの画素の重心（フレーム比）。hw = 塗りの画素の横の外接幅（上下左右 0.5% の外れ値を落とす・フレーム比）
//   ink の重心・外接矩形（既存の gpu-caption-motion-css-parity と同じ定義）
//   d32 = 画素の最大チャネル差 > 32 の画素数（GPU と OSR の画素差の量）・meanAbs = 平均絶対差（0〜255）
// 許容差は既存の GPU⇔OSR の一致の流儀: 重心 ±0.002・矩形 ±0.007（フレーム比）。塗りの面積は hl の比 0.9〜1.1 か差 ≤ 0.5% of 文字の画素。
import { spawn, spawnSync } from 'node:child_process';
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { ROWS, STEP, CUE_SECONDS, FPS, W, H, WORDS } from './fixture.mjs';

const [osrFile, gpuFile, outFile] = process.argv.slice(2);
const SHEET_DIR = process.argv.find(v => v.startsWith('--sheet-dir='))?.slice(12);
const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const CENTROID_TOL = 0.002, RECT_TOL = 0.007;
const FRAME = W * H * 3;
const round = (v, d = 4) => v === null || v === undefined || Number.isNaN(v) ? null : Math.round(v * 10 ** d) / 10 ** d;
const hex = (value) => [1, 3, 5].map(i => Number.parseInt(value.slice(i, i + 2), 16));
const highlightOf = (karaoke) => hex(karaoke.done_color ?? '#ffd94a');

async function* frames(file) {
  const child = spawn(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-i', file, ...(process.env.MATRIX709 === '1' ? ['-vf', 'scale=in_color_matrix=bt709:in_range=tv:out_range=pc'] : []), '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { stdio: ['ignore', 'pipe', 'inherit'] });
  let pending = Buffer.alloc(0);
  for await (const chunk of child.stdout) {
    pending = pending.length ? Buffer.concat([pending, chunk]) : chunk;
    while (pending.length >= FRAME) {
      yield Buffer.from(pending.subarray(0, FRAME));
      pending = pending.subarray(FRAME);
    }
  }
}

function background(d) {
  const values = [[], [], []];
  for (const [x0, y0] of [[0, 0], [W - 16, 0], [0, H - 16], [W - 16, H - 16]]) for (let y = y0; y < y0 + 16; y++) for (let x = x0; x < x0 + 16; x++) {
    const i = (y * W + x) * 3; values[0].push(d[i]); values[1].push(d[i + 1]); values[2].push(d[i + 2]);
  }
  return values.map(v => v.sort((a, b) => a - b)[v.length >> 1]);
}
const q = (arr, p) => { if (!arr.length) return null; const s = Float64Array.from(arr).sort(); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };

function measure(d, hl) {
  const bg = background(d);
  let ink = 0, sx = 0, sy = 0, hlCount = 0, hx = 0, hy = 0;
  const xs = [], ys = [], hxs = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 3;
    const r = d[i], g = d[i + 1], b = d[i + 2];
    const diff = Math.max(Math.abs(r - bg[0]), Math.abs(g - bg[1]), Math.abs(b - bg[2]));
    if (diff <= 12) continue;
    const w = diff / 255;
    ink += w; sx += w * (x + 0.5); sy += w * (y + 0.5);
    if (diff > 60) { xs.push(x); ys.push(y); }
    const dh = Math.hypot(r - hl[0], g - hl[1], b - hl[2]);
    const dw = Math.hypot(r - 255, g - 255, b - 255);
    if (dh < 80 && dh < dw) { hlCount += 1; hx += x + 0.5; hy += y + 0.5; hxs.push(x); }
  }
  const out = { ink: round(ink / (W * H), 6), hl: hlCount };
  if (ink > 0) {
    Object.assign(out, { cx: round(sx / ink / W), cy: round(sy / ink / H) });
    const left = q(xs, 0.005), right = q(xs, 0.995), top = q(ys, 0.005), bottom = q(ys, 0.995);
    out.w = left === null ? 0 : round((right - left + 1) / W);
    out.h = top === null ? 0 : round((bottom - top + 1) / H);
  }
  if (hlCount > 0) {
    out.hcx = round(hx / hlCount / W); out.hcy = round(hy / hlCount / H);
    const l = q(hxs, 0.005), r = q(hxs, 0.995);
    out.hw = round((r - l + 1) / W);
  }
  return out;
}

function pixelDiff(a, b) {
  let d32 = 0, sum = 0, max = 0;
  for (let i = 0; i < FRAME; i += 3) {
    const m = Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2]));
    sum += m; if (m > max) max = m; if (m > 32) d32 += 1;
  }
  return { d32, meanAbs: round(sum / (W * H), 3), maxAbs: max };
}

// 字幕ごとの「塗りの境目」の時刻（字幕内の相対秒）: 語の始まり・文字の境目（char）・語の途中（smooth / 従来）
function boundaryTimes(karaoke) {
  const times = new Set([0.1]);
  for (const [text, s, e] of WORDS) {
    times.add(s); times.add(e);
    const n = Array.from(text).length;
    for (let k = 1; k < n; k++) times.add(s + (e - s) * k / n);
    times.add((s + e) / 2);
  }
  times.add(2.9);
  return [...times].map(t => Math.round(t * FPS)).filter(f => f >= 0 && f < CUE_SECONDS * FPS).sort((a, b) => a - b);
}

const cueOf = (frame) => {
  const t = frame / FPS;
  const index = Math.floor(t / STEP);
  if (index >= ROWS.length || t - index * STEP >= CUE_SECONDS) return null;
  return { index, local: frame - index * STEP * FPS };
};

const perFrame = [];
const sheetFrames = [];
const osrIt = frames(osrFile)[Symbol.asyncIterator]();
const gpuIt = frames(gpuFile)[Symbol.asyncIterator]();
for (let frame = 0; ; frame += 1) {
  const [o, g] = await Promise.all([osrIt.next(), gpuIt.next()]);
  if (o.done || g.done) { if (!(o.done && g.done)) perFrame.push({ frame, error: `frame count differs (osr done=${o.done} gpu done=${g.done})` }); break; }
  const cue = cueOf(frame);
  if (!cue) continue;
  const [id, karaoke] = ROWS[cue.index];
  const hl = highlightOf(karaoke);
  const osr = measure(o.value, hl), gpu = measure(g.value, hl);
  const entry = { frame, id, local: cue.local, t: round(cue.local / FPS, 3), osr, gpu, px: pixelDiff(o.value, g.value) };
  const ok = [];
  if (osr.ink && gpu.ink) ok.push(Math.abs(gpu.cx - osr.cx) <= CENTROID_TOL, Math.abs(gpu.cy - osr.cy) <= CENTROID_TOL, Math.abs(gpu.w - osr.w) <= RECT_TOL, Math.abs(gpu.h - osr.h) <= RECT_TOL);
  else ok.push(!osr.ink && !gpu.ink);
  const textPixels = Math.max(1, Math.round(osr.ink * W * H));
  entry.hlRatio = osr.hl ? round(gpu.hl / osr.hl, 3) : (gpu.hl ? null : 1);
  entry.hlDiffShare = round(Math.abs(gpu.hl - osr.hl) / textPixels, 4);
  if (osr.hl > 50 || gpu.hl > 50) {
    ok.push((entry.hlRatio !== null && entry.hlRatio >= 0.9 && entry.hlRatio <= 1.1) || entry.hlDiffShare <= 0.005);
    if (osr.hl > 50 && gpu.hl > 50) ok.push(Math.abs(gpu.hcx - osr.hcx) <= CENTROID_TOL, Math.abs(gpu.hcy - osr.hcy) <= CENTROID_TOL, Math.abs(gpu.hw - osr.hw) <= RECT_TOL);
  }
  entry.within = ok.every(Boolean);
  perFrame.push(entry);
  if (SHEET_DIR && boundaryTimes(karaoke).includes(cue.local)) sheetFrames.push(frame);
}

const summary = { frames: perFrame.length, within: perFrame.filter(e => e.within).length, byCaption: {} };
for (const [id, karaoke, label] of ROWS) {
  const list = perFrame.filter(e => e.id === id);
  const boundary = boundaryTimes(karaoke);
  summary.byCaption[id] = {
    label, karaoke, frames: list.length, within: list.filter(e => e.within).length,
    outside: list.filter(e => !e.within).map(e => e.local),
    maxD32: Math.max(...list.map(e => e.px.d32)), maxMeanAbs: Math.max(...list.map(e => e.px.meanAbs)),
    maxAbsDhcx: round(Math.max(0, ...list.filter(e => e.osr.hl > 50 && e.gpu.hl > 50).map(e => Math.abs(e.gpu.hcx - e.osr.hcx)))),
    maxAbsDhw: round(Math.max(0, ...list.filter(e => e.osr.hl > 50 && e.gpu.hl > 50).map(e => Math.abs(e.gpu.hw - e.osr.hw)))),
    hlRatioRange: [Math.min(...list.filter(e => e.hlRatio !== null && (e.osr.hl > 50 || e.gpu.hl > 50)).map(e => e.hlRatio)), Math.max(...list.filter(e => e.hlRatio !== null && (e.osr.hl > 50 || e.gpu.hl > 50)).map(e => e.hlRatio))],
    boundary: list.filter(e => boundary.includes(e.local)).map(e => ({ local: e.local, t: e.t, osrHl: e.osr.hl, gpuHl: e.gpu.hl, hlRatio: e.hlRatio, dhcx: e.osr.hl > 50 && e.gpu.hl > 50 ? round(e.gpu.hcx - e.osr.hcx) : null, dhw: e.osr.hl > 50 && e.gpu.hl > 50 ? round(e.gpu.hw - e.osr.hw) : null, d32: e.px.d32, meanAbs: e.px.meanAbs, within: e.within })),
  };
}
await writeFile(outFile, `${JSON.stringify({ osrFile: path.basename(osrFile), gpuFile: path.basename(gpuFile), tolerance: { centroid: CENTROID_TOL, rect: RECT_TOL, hlRatio: [0.9, 1.1], hlDiffShare: 0.005 }, summary, perFrame }, null, 2)}\n`);
console.log(JSON.stringify({ frames: summary.frames, within: summary.within }));
for (const [id, s] of Object.entries(summary.byCaption)) console.log(`${id}\t${s.label}\twithin ${s.within}/${s.frames}\toutside=${JSON.stringify(s.outside)}\tmaxD32=${s.maxD32}\tmaxMeanAbs=${s.maxMeanAbs}\tdhcx<=${s.maxAbsDhcx}\tdhw<=${s.maxAbsDhw}\thlRatio=${JSON.stringify(s.hlRatioRange)}`);

if (SHEET_DIR) {
  await mkdir(SHEET_DIR, { recursive: true });
  // 境目の時刻ごとに OSR | GPU の字幕の帯を横に並べる（字幕ごとに 1 枚）
  for (const [index, [id, karaoke]] of ROWS.entries()) {
    const frames = boundaryTimes(karaoke).map(local => index * STEP * FPS + local);
    const band = `crop=${W * 0.7}:${H * 0.22}:${W * 0.15}:${H * 0.76},scale=448:-2`;
    const select = frames.map(f => `eq(n\\,${f})`).join('+');
    const filter = `[0:v]select='${select}',${band},setpts=N/TB[o];[1:v]select='${select}',${band},setpts=N/TB[g];[o][g]hstack=inputs=2,tile=1x${frames.length}[out]`;
    const file = path.join(SHEET_DIR, `sheet-${id}.png`);
    const x = spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-i', osrFile, '-i', gpuFile, '-filter_complex', filter, '-map', '[out]', '-frames:v', '1', '-fps_mode', 'passthrough', file], { encoding: 'utf8' });
    if (x.status !== 0) console.error(`sheet ${id}: ${x.stderr.slice(-300)}`);
  }
}
