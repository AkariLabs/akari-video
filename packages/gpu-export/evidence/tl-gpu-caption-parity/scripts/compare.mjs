#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CASES, PHASES, ROOT } from './fixture.mjs';

const W = 640, H = 360;
const unsupported = new Set(['typewriter-gradient']);
const ffmpeg = process.env.FFMPEG || 'ffmpeg';
const evidence = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const round = (value, digits = 4) => Number(value.toFixed(digits));
function decode(file, frames = 1) {
  const result = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-i', file,
    '-frames:v', String(frames), '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'],
  { maxBuffer: 128 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`decode failed: ${path.basename(file)}`);
  return result.stdout;
}
function metric(pixels) {
  const bg = [pixels[0], pixels[1], pixels[2]];
  let ink = 0, sx = 0, sy = 0;
  const xs = [], ys = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 3;
    const delta = Math.max(Math.abs(pixels[i] - bg[0]), Math.abs(pixels[i + 1] - bg[1]), Math.abs(pixels[i + 2] - bg[2]));
    if (delta <= 12) continue;
    const weight = delta / 255;
    ink += weight; sx += weight * (x + .5); sy += weight * (y + .5);
    if (delta > 60) { xs.push(x); ys.push(y); }
  }
  if (ink === 0) return { ink: 0, cx: 0, cy: 0, w: 0, h: 0, top: null, bottom: null };
  const q = (array, fraction) => {
    if (!array.length) return null;
    array.sort((a, b) => a - b);
    return array[Math.min(array.length - 1, Math.floor(fraction * array.length))];
  };
  const left = q(xs, .005), right = q(xs, .995), top = q(ys, .005), bottom = q(ys, .995);
  return { ink: round(ink / (W * H), 6), cx: round(sx / ink / W, 6), cy: round(sy / ink / H, 6),
    w: left === null ? 0 : round((right - left + 1) / W, 6),
    h: top === null ? 0 : round((bottom - top + 1) / H, 6), top, bottom };
}
function diffFraction(gpu, osr) {
  let changed = 0;
  for (let i = 0; i < gpu.length; i += 3) {
    if (Math.max(Math.abs(gpu[i] - osr[i]), Math.abs(gpu[i + 1] - osr[i + 1]),
      Math.abs(gpu[i + 2] - osr[i + 2])) > 16) changed++;
  }
  return round(changed / (W * H), 6);
}
const captures = [];
for (const [name] of CASES) for (const [phase, frame] of PHASES) {
  const osr = decode(path.join(ROOT, 'frames', `osr-${name}-${phase}.png`));
  const o = metric(osr);
  if (unsupported.has(name)) {
    captures.push({ name, phase, frame, gpu: null, osr: o, delta: null, within: false,
      unsupportedReason: 'caption-typewriter-gradient-osr-empty' });
    continue;
  }
  const gpu = decode(path.join(ROOT, 'frames', `gpu-${name}-${phase}.png`));
  const g = metric(gpu);
  const delta = { dcx: round(g.cx - o.cx, 6), dcy: round(g.cy - o.cy, 6),
    dw: round(g.w - o.w, 6), dh: round(g.h - o.h, 6),
    inkRatio: o.ink ? round(g.ink / o.ink, 4) : g.ink === 0 ? 1 : null,
    differencePixels: diffFraction(gpu, osr) };
  const within = Math.abs(delta.dcx) <= .002 && Math.abs(delta.dcy) <= .002
    && Math.abs(delta.dw) <= .007 && Math.abs(delta.dh) <= .007;
  captures.push({ name, phase, frame, gpu: g, osr: o, delta, within });
}
const glitches = [];
for (const name of ['glitch', 'glitch-stroke']) {
  const videos = ['gpu', 'osr'].map((engine) => decode(path.join(ROOT, name, 'exports', `${engine}.mp4`), 19));
  const bytes = W * H * 3;
  for (let frame = 0; frame < 19; frame++) {
    const [gpu, osr] = videos.map((buffer) => metric(buffer.subarray(frame * bytes, (frame + 1) * bytes)));
    glitches.push({ name, frame, gpuTop: gpu.top, osrTop: osr.top, gpuBottom: gpu.bottom,
      osrBottom: osr.bottom, topDifferencePx: gpu.top === null || osr.top === null ? null : gpu.top - osr.top,
      bottomDifferencePx: gpu.bottom === null || osr.bottom === null ? null : gpu.bottom - osr.bottom });
  }
}
const typeName = 'typewriter';
const type = Object.fromEntries(['gpu', 'osr'].map((engine) => {
  const half = captures.find((row) => row.name === typeName && row.phase === '50')[engine].ink;
  const full = metric(decode(path.join(ROOT, typeName, 'exports', `${engine}.mp4`), 28)
    .subarray(27 * W * H * 3, 28 * W * H * 3)).ink;
  const count = [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment('文字送りの字幕')].length;
  return [engine, { graphemes: count, estimatedVisibleAt50: Math.round(count * half / full), inkFractionAt50: round(half / full, 4) }];
}));
const owner = JSON.parse(await readFile(path.join(ROOT, 'export-owner.json'), 'utf8'))[0];
const gpuExport = JSON.parse(await readFile(path.join(ROOT, 'export-gpu.json'), 'utf8'));
const supportedCaptures = captures.filter((row) => !unsupported.has(row.name));
const summary = { total: captures.length, within: captures.filter((row) => row.within).length,
  supported: supportedCaptures.length,
  supportedWithin: supportedCaptures.filter((row) => row.within).length,
  outside: captures.filter((row) => !row.within).map((row) => `${row.name}-${row.phase}`),
  maxAbs: Object.fromEntries(['dcx', 'dcy', 'dw', 'dh'].map((key) =>
    [key, round(Math.max(...supportedCaptures.map((row) => Math.abs(row.delta[key]))), 6)])),
  maxDifferencePixels: round(Math.max(...supportedCaptures.map((row) => row.delta.differencePixels)), 6) };
summary.glitchMaxClipEdgeDifferencePx = Math.max(...glitches.flatMap((row) =>
  [Math.abs(row.topDifferencePx ?? 0), Math.abs(row.bottomDifferencePx ?? 0)]));
const sheets = [];
const sheetCases = CASES.filter(([name]) => !unsupported.has(name));
for (const [phase] of PHASES) {
  const args = ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y'];
  for (const [name] of sheetCases) args.push('-i', path.join(ROOT, 'frames', `osr-${name}-${phase}.png`),
    '-i', path.join(ROOT, 'frames', `gpu-${name}-${phase}.png`));
  const parts = sheetCases.flatMap((_, i) => [`[${i * 2}:v]crop=640:180:0:180,scale=320:90[o${i}]`,
    `[${i * 2 + 1}:v]crop=640:180:0:180,scale=320:90[g${i}]`,
    `[o${i}][g${i}]hstack=inputs=2[r${i}]`]);
  const filter = `${parts.join(';')};${sheetCases.map((_, i) => `[r${i}]`).join('')}vstack=inputs=${sheetCases.length}[out]`;
  const filename = `sheet-${phase}.png`;
  const result = spawnSync(ffmpeg, [...args, '-filter_complex', filter, '-map', '[out]', '-frames:v', '1',
    path.join(evidence, filename)], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`sheet ${phase}: ${result.stderr?.slice(-1000)}`);
  sheets.push({ file: filename, bytes: (await stat(path.join(evidence, filename))).size });
}
const result = { summary, tolerance: { centroid: .002, rectangle: .007 }, captures, glitches, typewriter: type,
  owner, unsupportedExport: gpuExport.filter((row) => unsupported.has(row.name)), sheets };
await writeFile(path.join(evidence, 'compare.json'), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(summary));
