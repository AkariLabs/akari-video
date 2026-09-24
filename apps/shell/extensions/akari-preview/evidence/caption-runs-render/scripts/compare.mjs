#!/usr/bin/env node
// プレビューと書き出し（GPU / OSR）の見た目を画素で比べる（ラッパー作成の検証スクリプト）。
// 使い方: node compare.mjs <before|after>
// l1.mjs が撮った webview の領域（倍率 2）から映像の単色（0x27313f）の外接矩形 = 映像枠を探して切り出し、
// export.mjs が落とした書き出しのフレーム（1280×720）と同じ色の分類で画素を数え、分類ごとの重心と外接矩形をフレーム比で比べる。
// 分類: white = 既定の白い塗り / red・sky・cyan・purple = run の色 / emoji = 彩度の高い画素（run の色を除く）。
// 行をまたぐ run は、画素のある行の帯（空行 3 本以上で区切る）ごとにも重心を出す。
import { spawnSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CAPTURES } from './captures.mjs';

const PHASE = process.argv[2];
if (!['before', 'after'].includes(PHASE)) throw new Error('phase must be before|after');
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const TMP = path.join(os.tmpdir(), 'caption-runs-render-l1');
const RAW = path.join(TMP, `raw-${PHASE}`);
const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const round = (v, d = 4) => v === null || v === undefined ? null : Math.round(v * 10 ** d) / 10 ** d;

async function decode(file) {
    const buffer = await readFile(file);
    const width = buffer.readUInt32BE(16), height = buffer.readUInt32BE(20);
    const x = spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-i', file, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: width * height * 4 });
    if (x.status !== 0 || x.stdout.length !== width * height * 3) throw new Error(`decode failed: ${file}`);
    return { width, height, data: x.stdout };
}
const near = (r, g, b, c, tol) => Math.abs(r - c[0]) <= tol && Math.abs(g - c[1]) <= tol && Math.abs(b - c[2]) <= tol;
const BG = [0x27, 0x31, 0x3f];
function findFrame(img) {
    let minX = img.width, maxX = -1, minY = img.height, maxY = -1;
    for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) {
        const i = (y * img.width + x) * 3;
        if (near(img.data[i], img.data[i + 1], img.data[i + 2], BG, 6)) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
    }
    if (maxX < 0) throw new Error('video frame not found');
    return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}
const CLASSES = {
    white: (r, g, b) => r > 205 && g > 205 && b > 205,
    red: (r, g, b) => r > 190 && g < 140 && b < 140,
    sky: (r, g, b) => r > 40 && r < 140 && g > 150 && g < 225 && b > 200,
    // プレビューの撮影は色空間の変換で彩度が少し落ちる（#00e5ff が r≈100 で出る）ため r の上限を広めにとる。
    cyan: (r, g, b) => r < 130 && g > 200 && b > 220 && g - r > 90,
    purple: (r, g, b) => r > 140 && r < 215 && g > 90 && g < 175 && b > 215,
    orange: (r, g, b) => r > 200 && g > 120 && g < 200 && b < 110,
    // 絵文字（🍻 と肌色の 👍🏽）は赤み > 青み。シアンの run の縁（青み）を拾わない。
    emoji: (r, g, b) => Math.max(r, g, b) - Math.min(r, g, b) > 70 && r > b + 20
};
const CLASSES_BY_ID = {
    'c-0001': ['white', 'red'], 'c-0002': ['white', 'sky'], 'c-0003': ['white', 'cyan', 'emoji'], 'c-0004': ['white', 'purple'],
    'c-0005': ['white', 'red'], 'c-0006': ['white', 'red'], 'c-0007': ['white'], 'c-0008': ['white'],
    'c-0009': ['white', 'orange'], 'c-0010': ['white', 'orange']
};
function measure(img, frame, names) {
    const result = {};
    for (const name of names) {
        const test = CLASSES[name];
        let n = 0, sx = 0, sy = 0, minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        const rows = new Map();
        for (let y = frame.y; y < frame.y + frame.h; y++) for (let x = frame.x; x < frame.x + frame.w; x++) {
            const i = (y * img.width + x) * 3;
            if (!test(img.data[i], img.data[i + 1], img.data[i + 2])) continue;
            const fx = (x - frame.x + 0.5) / frame.w, fy = (y - frame.y + 0.5) / frame.h;
            n++; sx += fx; sy += fy;
            minX = Math.min(minX, fx); maxX = Math.max(maxX, fx); minY = Math.min(minY, fy); maxY = Math.max(maxY, fy);
            const row = rows.get(y) ?? { n: 0, sx: 0, sy: 0 }; row.n++; row.sx += fx; row.sy += fy; rows.set(y, row);
        }
        if (!n) { result[name] = { pixels: 0 }; continue; }
        // 行の帯（空行が 3 本以上続いたら別の帯）。画素の少ない帯（ノイズ）は捨てる。
        const bands = []; let current = null, lastY = -10;
        for (const y of [...rows.keys()].sort((a, b) => a - b)) {
            const row = rows.get(y);
            if (!current || y - lastY > 3) { current = { n: 0, sx: 0, sy: 0, top: y, bottom: y }; bands.push(current); }
            current.n += row.n; current.sx += row.sx; current.sy += row.sy; current.bottom = y; lastY = y;
        }
        result[name] = {
            pixelShare: round(n / (frame.w * frame.h), 6), cx: round(sx / n), cy: round(sy / n),
            bbox: { left: round(minX), right: round(maxX), top: round(minY), bottom: round(maxY) },
            bands: bands.filter(b => b.n >= n * 0.05).map(b => ({ cx: round(b.sx / b.n), cy: round(b.sy / b.n), share: round(b.n / n, 3) }))
        };
    }
    return result;
}
const diffOf = (a, b) => {
    if (!a?.cx || !b?.cx) return null;
    const bands = a.bands.length === b.bands.length ? a.bands.map((band, i) => ({ dcx: round(b.bands[i].cx - band.cx), dcy: round(b.bands[i].cy - band.cy) })) : 'band-count-differs';
    return { dcx: round(b.cx - a.cx), dcy: round(b.cy - a.cy), bands };
};

const out = { phase: PHASE, method: 'preview = webview 領域（倍率 2）から映像枠を色で切り出し / export = 1280×720 のフレーム。分類ごとの画素の重心（フレーム比）', captures: [] };
let worst = 0;
for (const capture of CAPTURES) {
    const names = CLASSES_BY_ID[capture.id];
    const entry = { name: capture.name, id: capture.id, t: capture.t };
    const previewFile = path.join(RAW, `preview-${capture.name}.png`);
    if (existsSync(previewFile)) {
        const img = await decode(previewFile);
        const frame = findFrame(img);
        entry.previewFrame = frame;
        entry.preview = measure(img, frame, names);
        const shot = `${PHASE}-preview-${capture.name}.png`;
        spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-i', previewFile, '-vf', `crop=${frame.w}:${frame.h}:${frame.x}:${frame.y},scale=732:-1`, path.join(ROOT, shot)]);
        entry.previewScreenshot = shot;
    }
    for (const engine of ['gpu', 'osr']) {
        const file = path.join(RAW, `export-${engine}-${capture.name}.png`);
        if (!existsSync(file)) continue;
        const img = await decode(file);
        entry[engine] = measure(img, { x: 0, y: 0, w: img.width, h: img.height }, names);
        if (entry.preview) {
            entry[`diff_${engine}`] = Object.fromEntries(names.map(name => [name, diffOf(entry.preview[name], entry[engine][name])]));
            for (const d of Object.values(entry[`diff_${engine}`])) if (d) worst = Math.max(worst, Math.abs(d.dcx), Math.abs(d.dcy));
        }
    }
    out.captures.push(entry);
}
out.maxAbsCenterDiff = round(worst);
await writeFile(path.join(ROOT, `compare-${PHASE}.json`), `${JSON.stringify(out, null, 2)}\n`);
console.log(JSON.stringify({ maxAbsCenterDiff: out.maxAbsCenterDiff, captures: out.captures.map(c => ({ name: c.name, gpu: c.diff_gpu, osr: c.diff_osr })) }, null, 0).slice(0, 6000));
