#!/usr/bin/env node
// issue #84 検証用 fixture: 1080×1920 の v2 プロジェクト。
// 画像は 1320×530 の PNG（上半分 = 赤、下半分 = 緑）を data: URI で overlay HTML に埋め込む。
// usage: make-fixture.mjs <outDir> <compat|source>
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';

const [, , outDir, mode = 'compat'] = process.argv;
if (!outDir) throw new Error('usage: make-fixture.mjs <outDir> <compat|source>');

const crcTable = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = buf => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type, 'ascii'), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); };
function png(width, height, colorAt) {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) { const o = y * (width * 3 + 1); raw[o] = 0; for (let x = 0; x < width; x++) { const [r, g, b] = colorAt(x, y); raw[o + 1 + x * 3] = r; raw[o + 2 + x * 3] = g; raw[o + 3 + x * 3] = b; } }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const IMG_W = 1320, IMG_H = 530;
const banner = png(IMG_W, IMG_H, (x, y) => (y < IMG_H / 2 ? [255, 0, 0] : [0, 255, 0]));
const background = png(1080, 1920, () => [128, 128, 128]);
const dataUri = 'data:image/png;base64,' + banner.toString('base64');

const imgOverlay = `<div class="i84-root">
  <style>
    .i84-root { position: absolute; inset: 0; }
    .i84-frame { position: absolute; left: 60px; top: 840px; width: 960px; height: 240px; overflow: hidden; background: #0000ff; }
  </style>
  <div class="i84-frame"><img class="i84-img" src="${dataUri}" style="position:absolute; left:-152px; top:-270px; width:1300px; height:auto"></div>
</div>
`;
// 回帰用: <img> を使わず vw / vh で置く overlay
const vwOverlay = `<div class="i84-vw-root">
  <style>
    .i84-vw-root { position: absolute; inset: 0; }
    .i84-vw-box { position: absolute; left: 10vw; top: 5vh; width: 30vw; height: 10vh; background: #ff00ff; }
    .i84-px-box { position: absolute; left: 700px; top: 1500px; width: 300px; height: 200px; background: #ffff00; }
  </style>
  <div class="i84-vw-box"></div>
  <div class="i84-px-box"></div>
</div>
`;

// 回帰・作者 CSS 用: 作者が img に max-width を書いた overlay（書き出しでは 300px に制約される）と、
// Theia webview の既定 CSS（kbd / code）が当たり得る要素
const capOverlay = `<div class="i84-cap-root">
  <style>
    .i84-cap-root { position: absolute; inset: 0; }
    .i84-cap-root img { max-width: 300px; }
    .i84-cap-img { position: absolute; left: 60px; top: 1250px; width: 600px; height: auto; }
    .i84-kbd { position: absolute; left: 700px; top: 1250px; font-size: 40px; }
    .i84-code { position: absolute; left: 700px; top: 1350px; font-size: 40px; }
  </style>
  <img class="i84-cap-img" src="${dataUri}">
  <kbd class="i84-kbd">K</kbd>
  <code class="i84-code">c</code>
</div>
`;

const output = { width: 1080, height: 1920, fps: 30 };
if (mode === 'source') output.geometry = 'source';
const edit = {
  version: 2,
  output,
  sources: [{ id: 'bg', path: 'assets/bg.png' }],
  tracks: [
    { id: 'v-bg', lane: 'visual', name: 'Background', items: [{ id: 'bg-item', at: 0, duration: 90, source: { kind: 'media', src: 'bg', in: 0, out: 3 } }] },
    { id: 'v-vw', lane: 'visual', name: 'vw overlay', items: [{ id: 'vw-item', at: 0, duration: 90, source: { kind: 'html', path: 'overlays/vw-box.html' } }] },
    { id: 'v-cap', lane: 'visual', name: 'author cap overlay', items: [{ id: 'cap-item', at: 0, duration: 90, source: { kind: 'html', path: 'overlays/cap.html' } }] },
    { id: 'v-img', lane: 'visual', name: 'img overlay', items: [{ id: 'img-item', at: 0, duration: 90, source: { kind: 'html', path: 'overlays/img-frame.html' } }] }
  ]
};
await mkdir(path.join(outDir, 'assets'), { recursive: true });
await mkdir(path.join(outDir, 'overlays'), { recursive: true });
await writeFile(path.join(outDir, 'assets/bg.png'), background);
await writeFile(path.join(outDir, 'overlays/img-frame.html'), imgOverlay);
await writeFile(path.join(outDir, 'overlays/vw-box.html'), vwOverlay);
await writeFile(path.join(outDir, 'overlays/cap.html'), capOverlay);
await writeFile(path.join(outDir, 'edit.json'), JSON.stringify(edit, null, 2) + '\n');
console.log(`fixture (${mode}) -> ${outDir}`);
