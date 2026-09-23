#!/usr/bin/env node
// 編集前後のプレビュー撮影（<phase>-pre-<id>.png / <phase>-post-<id>.png）を画素で比べ、
// 差のある画素の数と外接矩形を出す。字幕の板の外（再生バーなど）は --region で除ける。
// 使い方: node pixel-diff.mjs <phase> [--region=x0,y0,x1,y1]
// PNG は CDP の撮影（8bit RGBA/RGB・非インタレース）だけを想定した最小の復号器。
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { inflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PHASE = process.argv[2] ?? 'after';
const REGION = process.argv.find(v => v.startsWith('--region='))?.slice(9).split(',').map(Number);
const IDS = ['c-0001', 'c-0002', 'c-0003', 'c-0004', 'c-0005'];

function decode(file) {
    const buffer = readFileSync(file);
    let offset = 8; let width = 0; let height = 0; let colorType = 0; const idat = [];
    while (offset < buffer.length) {
        const length = buffer.readUInt32BE(offset); const type = buffer.toString('ascii', offset + 4, offset + 8);
        const data = buffer.subarray(offset + 8, offset + 8 + length);
        if (type === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); colorType = data[9]; if (data[8] !== 8 || data[12] !== 0) throw new Error('unsupported PNG'); }
        if (type === 'IDAT') idat.push(data);
        offset += 12 + length;
    }
    const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 0;
    if (!channels) throw new Error(`unsupported color type ${colorType}`);
    const raw = inflateSync(Buffer.concat(idat)); const stride = width * channels;
    const pixels = Buffer.alloc(height * stride); let previous = Buffer.alloc(stride);
    for (let y = 0; y < height; y++) {
        const filter = raw[y * (stride + 1)]; const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
        const current = Buffer.alloc(stride);
        for (let x = 0; x < stride; x++) {
            const a = x >= channels ? current[x - channels] : 0; const b = previous[x]; const c = x >= channels ? previous[x - channels] : 0;
            const p = a + b - c; const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c);
            const predictor = [0, a, b, (a + b) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? b : c][filter];
            current[x] = (line[x] + predictor) & 0xff;
        }
        current.copy(pixels, y * stride); previous = current;
    }
    return { width, height, channels, pixels };
}

const report = {};
for (const id of IDS) {
    const pre = decode(path.join(ROOT, `${PHASE}-pre-${id}.png`));
    const post = decode(path.join(ROOT, `${PHASE}-post-${id}.png`));
    if (pre.width !== post.width || pre.height !== post.height) { report[id] = { error: 'size mismatch' }; continue; }
    const [x0, y0, x1, y1] = REGION ?? [0, 0, pre.width, pre.height];
    let count = 0; const box = { left: Infinity, top: Infinity, right: -1, bottom: -1 };
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        const index = (y * pre.width + x) * pre.channels;
        let delta = 0; for (let k = 0; k < 3; k++) delta = Math.max(delta, Math.abs(pre.pixels[index + k] - post.pixels[index + k]));
        if (delta > 24) { count++; box.left = Math.min(box.left, x); box.top = Math.min(box.top, y); box.right = Math.max(box.right, x); box.bottom = Math.max(box.bottom, y); }
    }
    report[id] = { changedPixels: count, ...(count ? { box: { ...box, width: box.right - box.left + 1, height: box.bottom - box.top + 1 } } : {}) };
}
writeFileSync(path.join(ROOT, `pixel-diff-${PHASE}.json`), `${JSON.stringify({ phase: PHASE, region: REGION ?? 'full', threshold: 24, report }, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(report)}\n`);
