#!/usr/bin/env node
// 証跡用: ウィンドウのスクリーンショットから出力ステージ（背景の灰 128,128,128 の外接矩形）だけを切り出す。
// usage: crop-stage.mjs <in.png> <out.png>
import { readFile, writeFile } from 'node:fs/promises';
import zlib from 'node:zlib';
import { decodePng } from './png-lib.mjs';
const [, , input, output] = process.argv;
const png = decodePng(await readFile(input));
// UI 側の散発的な灰を拾わないよう、灰が 100px 以上並ぶ行・列だけでステージを決める
const isGrey = (x, y) => { const [r, g, b] = png.pixel(x, y); return r === 128 && g === 128 && b === 128; };
const rowCount = y => { let n = 0; for (let x = 0; x < png.width; x++) if (isGrey(x, y)) n++; return n; };
const colCount = x => { let n = 0; for (let y = 0; y < png.height; y++) if (isGrey(x, y)) n++; return n; };
let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
for (let y = 0; y < png.height; y++) if (rowCount(y) >= 100) { if (y < y0) y0 = y; y1 = y; }
for (let x = 0; x < png.width; x++) if (colCount(x) >= 100) { if (x < x0) x0 = x; x1 = x; }
if (x1 < 0) throw new Error('stage not found');
const w = x1 - x0 + 1, h = y1 - y0 + 1;
const raw = Buffer.alloc((w * 3 + 1) * h);
for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; for (let x = 0; x < w; x++) { const p = png.pixel(x0 + x, y0 + y); p.forEach((v, i) => { raw[y * (w * 3 + 1) + 1 + x * 3 + i] = v; }); } }
const crcTable = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = buf => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type, 'ascii'), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); };
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
await writeFile(output, Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
console.log(`${output}: ${w}x${h} @${x0},${y0}`);
