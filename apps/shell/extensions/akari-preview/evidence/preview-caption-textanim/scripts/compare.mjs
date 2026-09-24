#!/usr/bin/env node
// プレビューと書き出し（OSR / GPU）の字幕の見た目を画素で比べる（ラッパー作成の検証スクリプト）。
// 使い方: node compare.mjs <before|after>
// l1.mjs が撮った webview の領域（倍率 2）から映像の単色（0x27313f）の外接矩形 = 映像枠を探して切り出し、1280×720 へ拡縮して
// export.mjs が落とした書き出しのフレームと同じ量を測る:
//   ink     = 背景からの色差（各画素の max|c−bg|/255）の総和 / 画素数（不透明度 × 塗りの量の代理）
//   cx, cy  = 色差で重みづけた重心（フレーム比）= 位置
//   w, h    = 色差 > 60 の画素の外接矩形（上下左右 0.5% の外れ値を落とす・フレーム比）= 変形（拡縮・回転・切り抜き）の代理
// 差: dcx / dcy / dw / dh（フレーム比）・inkRatio = preview / export。
// あわせて比較シート（字幕の帯を プレビュー | 書き出し OSR | 書き出し GPU で横に並べたもの）を phase ごとに 3 枚（in / loop / out）作る。
import { spawnSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CAPTURES, PHASES } from './captures.mjs';

const PHASE = process.argv[2];
if (!['before', 'after'].includes(PHASE)) throw new Error('phase must be before|after');
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const TMP = path.join(os.tmpdir(), 'preview-caption-textanim-l1');
const RAW = path.join(TMP, `raw-${PHASE}`);
// 書き出しは before / after で同じもの（export-*.json の SHA-256 で確認）なので、無ければ before の書き出しを使う。
const exportRaw = engine => [RAW, path.join(TMP, 'raw-before')].map(dir => dir).find(dir => existsSync(path.join(dir, `export-${engine}-${CAPTURES[0].name}.png`)));
const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const W = 1280, H = 720;
const round = (v, d = 4) => v === null || v === undefined || Number.isNaN(v) ? null : Math.round(v * 10 ** d) / 10 ** d;
const frameCache = new Map();

function decode(file, vf) {
    const args = ['-hide_banner', '-loglevel', 'error', '-nostdin', '-i', file];
    if (vf) args.push('-vf', vf);
    args.push('-f', 'rawvideo', '-pix_fmt', 'rgb24', '-');
    const x = spawnSync(FFMPEG, args, { maxBuffer: 256 * 1024 * 1024 });
    if (x.status !== 0) throw new Error(`decode failed: ${file}: ${x.stderr}`);
    return x.stdout;
}
function probeSize(file) {
    const b = spawnSync('file', [file], { encoding: 'utf8' }).stdout.match(/(\d+) x (\d+)/u);
    return { width: Number(b[1]), height: Number(b[2]) };
}
const BG = [0x27, 0x31, 0x3f];
const near = (d, i, tol) => Math.abs(d[i] - BG[0]) <= tol && Math.abs(d[i + 1] - BG[1]) <= tol && Math.abs(d[i + 2] - BG[2]) <= tol;
function findFrame(file) {
    const { width, height } = probeSize(file);
    const d = decode(file);
    let minX = width, maxX = -1, minY = height, maxY = -1;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 3;
        if (near(d, i, 6)) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
    }
    if (maxX < 0) throw new Error(`video frame not found: ${file}`);
    return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}
// プレビューの映像枠は撮影ごとに同じ（1 回目の撮影の枠を使う。字幕が枠の端にかかって枠の検出がずれるのを避ける）
function previewFrame(file) {
    if (!frameCache.has('preview')) frameCache.set('preview', findFrame(file));
    return frameCache.get('preview');
}
function background(d) {
    // 四隅 16×16 の中央値
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
        w: left === null ? 0 : round((right - left + 1) / W), h: top === null ? 0 : round((bottom - top + 1) / H),
        strongPixels: xs.length
    };
}

const out = {
    phase: PHASE,
    method: 'preview = webview 領域（倍率 2）から映像枠を色で切り出し 1280×720 へ拡縮 / export = 1280×720 のフレーム。ink・色差で重みづけた重心・強い色差の外接矩形（フレーム比）',
    captures: []
};
const sheets = new Map(PHASES.map(([phase]) => [phase, []]));
for (const capture of CAPTURES) {
    const entry = { name: capture.name, id: capture.id, phase: capture.phase, anim: capture.anim, loop: capture.loop, t: capture.t };
    const previewFile = path.join(RAW, `preview-${capture.name}.png`);
    let vfPreview = null;
    if (existsSync(previewFile)) {
        const f = previewFrame(previewFile);
        vfPreview = `crop=${f.w}:${f.h}:${f.x}:${f.y},scale=${W}:${H}:flags=bicubic`;
        entry.preview = measure(decode(previewFile, vfPreview));
    }
    for (const engine of ['osr', 'gpu']) {
        const dir = exportRaw(engine);
        if (!dir) continue;
        const file = path.join(dir, `export-${engine}-${capture.name}.png`);
        entry[engine] = measure(decode(file));
        if (entry.preview?.ink && entry[engine].ink) {
            const p = entry.preview, e = entry[engine];
            entry[`diff_${engine}`] = { dcx: round(p.cx - e.cx), dcy: round(p.cy - e.cy), dw: round(p.w - e.w), dh: round(p.h - e.h), inkRatio: round(p.ink / e.ink, 3) };
        } else if (entry.preview && entry[engine]) {
            entry[`diff_${engine}`] = { previewInk: entry.preview.ink ?? 0, exportInk: entry[engine].ink ?? 0 };
        }
    }
    if (vfPreview) {
        const dir = exportRaw('osr');
        sheets.get(capture.phase).push({ preview: previewFile, vfPreview, export: dir ? path.join(dir, `export-osr-${capture.name}.png`) : null, name: capture.name });
    }
    out.captures.push(entry);
}
// 比較シート: 字幕の帯（y 50%〜100%）を 480×135 に縮めて プレビュー | 書き出し OSR | 書き出し GPU で横に並べ、
// 字幕ごと（c-0001 → c-0012 の順）に縦へ積む。ラベルは入れない（手元の ffmpeg に drawtext が無いため。並びは README に書く）。
for (const [phase, rows] of sheets) {
    if (!rows.length || rows.some(r => !r.export)) continue;
    const args = ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y'];
    const gpuDir = exportRaw('gpu');
    for (const r of rows) args.push('-i', r.preview, '-i', r.export, '-i', path.join(gpuDir, `export-gpu-${r.name}.png`));
    const band = `crop=${W}:${H / 2}:0:${H / 2},scale=480:135`;
    const parts = rows.flatMap((r, i) => [
        `[${i * 3}:v]${r.vfPreview},${band}[p${i}]`,
        `[${i * 3 + 1}:v]${band}[e${i}]`,
        `[${i * 3 + 2}:v]${band}[g${i}]`,
        `[p${i}][e${i}][g${i}]hstack=inputs=3[r${i}]`
    ]);
    const filter = `${parts.join(';')};${rows.map((_, i) => `[r${i}]`).join('')}vstack=inputs=${rows.length}[out]`;
    const file = `${PHASE}-sheet-${phase}.png`;
    const x = spawnSync(FFMPEG, [...args, '-filter_complex', filter, '-map', '[out]', '-frames:v', '1', path.join(ROOT, file)], { encoding: 'utf8' });
    if (x.status !== 0) out[`sheetError_${phase}`] = x.stderr.slice(-400);
    else (out.sheets ??= []).push(file);
}
// 集計: 字幕ごと・時刻ごとの最大差
const worst = {};
for (const engine of ['osr', 'gpu']) {
    const diffs = out.captures.map(c => c[`diff_${engine}`]).filter(d => d && d.dcx !== undefined);
    if (!diffs.length) continue;
    worst[engine] = {
        n: diffs.length,
        maxAbsDcx: round(Math.max(...diffs.map(d => Math.abs(d.dcx)))), maxAbsDcy: round(Math.max(...diffs.map(d => Math.abs(d.dcy)))),
        maxAbsDw: round(Math.max(...diffs.map(d => Math.abs(d.dw)))), maxAbsDh: round(Math.max(...diffs.map(d => Math.abs(d.dh)))),
        inkRatioRange: [Math.min(...diffs.map(d => d.inkRatio)), Math.max(...diffs.map(d => d.inkRatio))]
    };
}
out.worst = worst;
await writeFile(path.join(ROOT, `compare-${PHASE}.json`), `${JSON.stringify(out, null, 2)}\n`);
console.log(JSON.stringify({ worst, sheets: out.sheets }));
