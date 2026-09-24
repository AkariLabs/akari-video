#!/usr/bin/env node
// GPU と OSR（字幕 1 本ずつ）の字幕の見た目をフレームの画素で比べる（ラッパー作成の検証スクリプト）。
// 使い方: node compare.mjs <before|after>
// export.mjs が落とした 1280×720 のフレームで同じ量を測る:
//   ink    = 背景からの色差（各画素の max|c−bg|/255）の総和 / 画素数（不透明度 × 塗りの量の代理）
//   cx, cy = 色差で重みづけた重心（フレーム比）= 位置
//   w, h   = 色差 > 60 の画素の外接矩形（上下左右 0.5% の外れ値を落とす・フレーム比）= 変形（拡縮・回転）の代理
// 差: dcx / dcy / dw / dh（フレーム比）= GPU − OSR・inkRatio = GPU / OSR。許容差: 重心 ±0.002・矩形 ±0.007（契約の手順 2）。
// 比較シート（字幕の帯 y 40%〜100% を OSR | GPU で横に並べ、c-0001 → c-0012 を縦に積む）を in / loop / out の 3 枚作る。
import { spawnSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROWS, TMP, PHASES } from './fixture.mjs';

const PHASE = process.argv[2];
if (!['before', 'after'].includes(PHASE)) throw new Error('phase must be before|after');
const EVIDENCE = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const RAW = path.join(TMP, `raw-${PHASE}`);
// OSR は本タスクで変えない（packages/osr-export・render-cut は編集禁止）。after で OSR を撮り直していなければ before を使う。
const osrRaw = (id, phase) => {
    const own = path.join(RAW, `osr-${id}-${phase}.png`);
    return spawnSync('test', ['-f', own]).status === 0 ? own : path.join(TMP, 'raw-before', `osr-${id}-${phase}.png`);
};
const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const W = 1280, H = 720;
const CENTROID_TOL = 0.002, RECT_TOL = 0.007;
const round = (v, d = 4) => v === null || v === undefined || Number.isNaN(v) ? null : Math.round(v * 10 ** d) / 10 ** d;

function decode(file) {
    const x = spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-i', file, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 256 * 1024 * 1024 });
    if (x.status !== 0) throw new Error(`decode failed: ${file}: ${x.stderr}`);
    return x.stdout;
}
function background(d) {
    const values = [[], [], []];
    for (const [x0, y0] of [[0, 0], [W - 16, 0], [0, H - 16], [W - 16, H - 16]]) for (let y = y0; y < y0 + 16; y++) for (let x = x0; x < x0 + 16; x++) {
        const i = (y * W + x) * 3; values[0].push(d[i]); values[1].push(d[i + 1]); values[2].push(d[i + 2]);
    }
    return values.map(v => v.sort((a, b) => a - b)[v.length >> 1]);
}
function measure(d) {
    const bg = background(d);
    let ink = 0, sx = 0, sy = 0;
    const xs = [], ys = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 3;
        const diff = Math.max(Math.abs(d[i] - bg[0]), Math.abs(d[i + 1] - bg[1]), Math.abs(d[i + 2] - bg[2]));
        if (diff <= 12) continue;
        const w = diff / 255;
        ink += w; sx += w * (x + 0.5); sy += w * (y + 0.5);
        if (diff > 60) { xs.push(x); ys.push(y); }
    }
    if (ink === 0) return { ink: 0 };
    const q = (arr, p) => { if (!arr.length) return null; const s = Float64Array.from(arr).sort(); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
    const left = q(xs, 0.005), right = q(xs, 0.995), top = q(ys, 0.005), bottom = q(ys, 0.995);
    return {
        ink: round(ink / (W * H), 6), cx: round(sx / ink / W), cy: round(sy / ink / H),
        w: left === null ? 0 : round((right - left + 1) / W), h: top === null ? 0 : round((bottom - top + 1) / H)
    };
}

const out = {
    phase: PHASE,
    method: 'GPU / OSR とも 1280×720 の書き出しフレーム（字幕 1 本ずつのプロジェクト・出力 0.3 / 1.5 / 2.7 秒）。ink・色差で重みづけた重心・強い色差の外接矩形（フレーム比）。差 = GPU − OSR',
    tolerance: { centroid: CENTROID_TOL, rect: RECT_TOL },
    captures: []
};
for (const [id, text, anim, loop] of ROWS) for (const [phase, t] of PHASES) {
    const entry = { id, text, anim, loop, phase, t };
    entry.osr = measure(decode(osrRaw(id, phase)));
    entry.gpu = measure(decode(path.join(RAW, `gpu-${id}-${phase}.png`)));
    const g = entry.gpu, o = entry.osr;
    if (g.ink && o.ink) {
        entry.diff = { dcx: round(g.cx - o.cx), dcy: round(g.cy - o.cy), dw: round(g.w - o.w), dh: round(g.h - o.h), inkRatio: round(g.ink / o.ink, 3) };
        entry.within = Math.abs(entry.diff.dcx) <= CENTROID_TOL && Math.abs(entry.diff.dcy) <= CENTROID_TOL
            && Math.abs(entry.diff.dw) <= RECT_TOL && Math.abs(entry.diff.dh) <= RECT_TOL;
    } else {
        entry.diff = { gpuInk: g.ink ?? 0, osrInk: o.ink ?? 0 };
        entry.within = (g.ink ?? 0) === 0 && (o.ink ?? 0) === 0;
    }
    out.captures.push(entry);
}
const diffs = out.captures.map(c => c.diff).filter(d => d.dcx !== undefined);
out.summary = {
    n: out.captures.length, within: out.captures.filter(c => c.within).length,
    outside: out.captures.filter(c => !c.within).map(c => `${c.id}-${c.phase}`),
    maxAbsDcx: round(Math.max(...diffs.map(d => Math.abs(d.dcx)))), maxAbsDcy: round(Math.max(...diffs.map(d => Math.abs(d.dcy)))),
    maxAbsDw: round(Math.max(...diffs.map(d => Math.abs(d.dw)))), maxAbsDh: round(Math.max(...diffs.map(d => Math.abs(d.dh)))),
    inkRatioRange: [Math.min(...diffs.map(d => d.inkRatio)), Math.max(...diffs.map(d => d.inkRatio))]
};
// 比較シート
for (const [phase] of PHASES) {
    const args = ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y'];
    for (const [id] of ROWS) args.push('-i', osrRaw(id, phase), '-i', path.join(RAW, `gpu-${id}-${phase}.png`));
    const band = `crop=${W}:${H * 0.6}:0:${H * 0.4},scale=480:135`;
    const parts = ROWS.flatMap((_, i) => [`[${i * 2}:v]${band}[o${i}]`, `[${i * 2 + 1}:v]${band}[g${i}]`, `[o${i}][g${i}]hstack=inputs=2[r${i}]`]);
    const filter = `${parts.join(';')};${ROWS.map((_, i) => `[r${i}]`).join('')}vstack=inputs=${ROWS.length}[out]`;
    const file = `${PHASE}-sheet-${phase}.png`;
    const x = spawnSync(FFMPEG, [...args, '-filter_complex', filter, '-map', '[out]', '-frames:v', '1', path.join(EVIDENCE, file)], { encoding: 'utf8' });
    if (x.status !== 0) out[`sheetError_${phase}`] = x.stderr.slice(-400);
    else (out.sheets ??= []).push(file);
}
await writeFile(path.join(EVIDENCE, `compare-${PHASE}.json`), `${JSON.stringify(out, null, 2)}\n`);
console.log(JSON.stringify(out.summary));
for (const c of out.captures) console.log([c.id, c.anim ?? '-', c.loop ?? '-', c.phase, ...(c.diff.dcx !== undefined ? [c.diff.dcx, c.diff.dcy, c.diff.dw, c.diff.dh, c.diff.inkRatio] : [JSON.stringify(c.diff)]), c.within ? 'OK' : 'NG'].join('\t'));
