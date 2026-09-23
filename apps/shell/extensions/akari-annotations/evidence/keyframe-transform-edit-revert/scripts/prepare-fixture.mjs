#!/usr/bin/env node
import { cp, mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import canonical from '../../../../../../../packages/edit-store/lib/canonical.js';

const workspaceArg = process.argv[2];
if (!workspaceArg) throw new Error('usage: prepare-fixture.mjs <workspace>');
const repo = fileURLToPath(new URL('../../../../../../../', import.meta.url));
await mkdir(workspaceArg, { recursive: true });
const workspace = await realpath(workspaceArg);
const project = path.join(workspace, 'project');
if (await stat(project).then(() => true, e => e.code === 'ENOENT' ? false : Promise.reject(e))) {
  throw new Error('Refusing to replace an existing fixture project');
}
await cp(path.join(repo, 'templates/project-default'), project, { recursive: true });
await mkdir(path.join(project, 'overlays'), { recursive: true });
await mkdir(path.join(project, 'assets'), { recursive: true });
// An overlay fragment (not a full document): its first child is the painted card, as the
// preview's hit bounds expect.
await writeFile(path.join(project, 'overlays/card.html'), `<div class="card"><style>
.card{position:absolute;left:210px;top:120px;box-sizing:border-box;width:220px;height:120px;
background:#174a79;border:5px solid #f5ca69;color:white;display:grid;place-items:center;
font:700 30px system-ui;border-radius:12px}
</style>HTML</div>\n`);

// 160×100 RGBA PNG. The PNG container, CRC and IDAT are generated with Node only.
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let i = 0; i < 8; i++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function chunk(type, data) {
  const name = Buffer.from(type);
  const size = Buffer.alloc(4); size.writeUInt32BE(data.length);
  let crc = 0xffffffff;
  for (const byte of Buffer.concat([name, data])) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  const checksum = Buffer.alloc(4); checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([size, name, data, checksum]);
}
const width = 160, height = 100;
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6;
const scanlines = Buffer.alloc(height * (1 + width * 4));
for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
  const p = y * (1 + width * 4) + 1 + x * 4;
  const border = x < 5 || y < 5 || x >= width - 5 || y >= height - 5;
  scanlines[p] = border ? 246 : 76;
  scanlines[p + 1] = border ? 210 : 147;
  scanlines[p + 2] = border ? 94 : 108;
  scanlines[p + 3] = 255;
}
await writeFile(path.join(project, 'assets/still.png'), Buffer.concat([
  Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(scanlines)), chunk('IEND', Buffer.alloc(0))
]));
const edit = {
  version: 2, output: { width: 640, height: 360, fps: 30 },
  sources: [{ id: 'still-source', path: 'assets/still.png' }],
  tracks: [
    { id: 'html-track', lane: 'visual', items: [{ id: 'html-item', at: 0, duration: 180,
      transform: { x: -135, y: -35, scale: 1, rotate: 0 },
      source: { kind: 'html', path: 'overlays/card.html' } }] },
    { id: 'still-track', lane: 'visual', items: [{ id: 'still-item', at: 0, duration: 180,
      transform: { x: 145, y: 30, scale: 1, rotate: 0 },
      source: { kind: 'media', src: 'still-source', in: 0, out: 6 } }] }
  ]
};
// Both items intentionally start without keyframes and with identity size/rotation.
await writeFile(path.join(project, 'edit.json'), canonical.serializeEdit(edit));
await writeFile(path.join(project, 'review.json'), '{ "version": 0, "annotations": [] }\n');
console.log('fixture ready: project/edit.json');
