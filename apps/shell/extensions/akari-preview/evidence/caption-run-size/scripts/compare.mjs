#!/usr/bin/env node
// プレビュー ⇄ 書き出し（GPU / OSR）の同じ時刻のフレームを並べ、文字の画素の外接矩形を比べる（ラッパー作成の検証スクリプト）。
// 使い方: node compare.mjs <before|after>
// 入力: l1.mjs の preview-<key>.png（映像の枠を出力 1280 幅で撮ったもの）と export.mjs の <engine>-<key>.png。
// 文字の画素 = 明るい画素（R,G,B すべて 200 以上。白い文字の塗り。上端 48px は除く）。外接矩形と、列ごとの有無から「文字の塊」の数と隙間（px）を出す。
// 証跡: <phase>-compare-<key>.png（上から プレビュー / GPU / OSR。字幕の帯を切り出し、黒の 6px で区切って縦に並べる）と compare-<phase>.json。
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SCENARIOS } from './scenarios.mjs';

const PHASE = process.argv[2];
if (!['before', 'after'].includes(PHASE)) throw new Error('phase must be before|after');
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const TMP = path.join(os.tmpdir(), 'caption-run-size-l1');
const FRAMES = path.join(TMP, `frames-${PHASE}`);
const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const W = 1280, H = 720;
const round = (v, d = 4) => Math.round(v * 10 ** d) / 10 ** d;

function raw(file) {
    const r = spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-i', file, '-vf', `scale=${W}:${H}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: W * H * 4 });
    if (r.status !== 0 || r.stdout.length !== W * H * 3) throw new Error(`decode failed ${path.basename(file)}: ${r.stderr}`);
    return r.stdout;
}
function ink(px) {
    let minX = W, maxX = -1, minY = H, maxY = -1, count = 0;
    const cols = new Uint8Array(W);
    // 上端 48px はプレビューの「未対応」チップなど字幕以外の UI が乗るので除く
    for (let y = 48; y < H; y++) for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 3;
        if (px[i] < 200 || px[i + 1] < 200 || px[i + 2] < 200) continue;
        count++; cols[x] = 1;
        if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    if (!count) return null;
    // 列の塊（文字の塊）: 2px 以下の空きは同じ塊とみなす
    const blobs = [];
    let start = -1, lastOn = -10;
    for (let x = minX; x <= maxX + 1; x++) {
        if (x <= maxX && cols[x]) { if (start < 0) start = x; lastOn = x; }
        else if (start >= 0 && x - lastOn > 2) { blobs.push([start, lastOn]); start = -1; }
    }
    return { left: minX, right: maxX + 1, top: minY, bottom: maxY + 1, width: maxX + 1 - minX, height: maxY + 1 - minY, count,
        blobs: blobs.length, gaps: blobs.slice(1).map((b, i) => b[0] - blobs[i][1] - 1) };
}

const results = [];
for (const sc of SCENARIOS) {
    const files = { preview: path.join(FRAMES, `preview-${sc.key}.png`), gpu: path.join(FRAMES, `gpu-${sc.key}.png`), osr: path.join(FRAMES, `osr-${sc.key}.png`) };
    const row = { key: sc.key, label: sc.label, t: sc.t };
    for (const [name, file] of Object.entries(files)) row[name] = existsSync(file) ? ink(raw(file)) : null;
    for (const engine of ['gpu', 'osr']) {
        const a = row.preview, b = row[engine];
        if (a && b) row[`diff_${engine}`] = {
            cx: round(((b.left + b.right) - (a.left + a.right)) / 2 / W), cy: round(((b.top + b.bottom) - (a.top + a.bottom)) / 2 / H),
            width: round((b.width - a.width) / W), height: round((b.height - a.height) / H)
        };
    }
    // 並べた画像: 字幕の帯（全画像の文字の外接矩形の縦範囲 ± 40px）を切り出し、プレビュー / GPU / OSR を縦に積む
    const present = Object.entries(files).filter(([, f]) => existsSync(f));
    const boxes = present.map(([n]) => row[n]).filter(Boolean);
    if (boxes.length) {
        const top = Math.max(0, Math.min(...boxes.map(b => b.top)) - 40), bottom = Math.min(H, Math.max(...boxes.map(b => b.bottom)) + 40);
        const h = bottom - top;
        const inputs = present.flatMap(([, f]) => ['-i', f]);
        const filters = present.map(([n], i) => `[${i}:v]scale=${W}:${H},crop=${W}:${h}:0:${top},pad=${W}:${h + 6}:0:0:black[v${i}]`).join(';');
        const stack = `${filters};${present.map((_, i) => `[v${i}]`).join('')}vstack=inputs=${present.length}[out]`;
        const shot = `${PHASE}-compare-${sc.key}.png`;
        const r = spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', ...inputs, '-filter_complex', stack, '-map', '[out]', '-frames:v', '1', path.join(ROOT, shot)], { encoding: 'utf8' });
        if (r.status !== 0) throw new Error(`stack failed: ${r.stderr}`);
        row.screenshot = shot;
    }
    results.push(row);
}
await writeFile(path.join(ROOT, `compare-${PHASE}.json`), `${JSON.stringify(results, null, 2)}\n`);
for (const r of results) console.log(r.key, 'preview', r.preview && [r.preview.width, r.preview.blobs], 'gpu', r.diff_gpu, 'osr', r.diff_osr);
