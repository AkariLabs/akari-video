#!/usr/bin/env node
// 検証専用（実機の代わりではない）: addShapeAt が書く item（buildShapeItem）を、プレビューと書き出しが使う
// 降下（edit-store の shapeMarkup）で SVG にし、1920×1080 の枠に transform どおり並べて rsvg-convert で PNG にする。
// 置いた直後の色（図形 = 灰・ライン = 黒・吹き出し = 白塗り + 黒枠）と、中心の位置を目で確かめる。
// 使い方: node evidence/s1-shape-shelf/static-placed.mjs --shell <apps/shell> --out <出力 dir>

import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

const argument = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : fallback; };
const shellDir = path.resolve(argument('shell'));
const outDir = path.resolve(argument('out', '.'));
await mkdir(outDir, { recursive: true });
const require = createRequire(path.join(shellDir, 'extensions/akari-annotations/package.json'));
const { shapeMarkup } = require('@akari-video/edit-store');
const { buildShapeItem } = require(path.join(shellDir, 'extensions/akari-annotations/lib/common/shape-place.js'));
const rows = new Map((await readFile(path.join(shellDir, '../../presets/shapes/index.jsonl'), 'utf8'))
  .trimEnd().split('\n').map(line => JSON.parse(line)).map(row => [row.id, row]));
const output = { width: 1920, height: 1080 };
const place = (id, id2, center) => buildShapeItem({
  preset: rows.get(id), base: rows.get(id).rounded_from ? rows.get(rows.get(id).rounded_from.base) : undefined,
  id: id2, at: 30, duration: 150, output, ...(center ? { center } : {}),
});
// 押す = 中央。4 つが重ならないよう、ここだけ中心を 4 分割の中央へずらして並べる（center 指定の経路と同じ）。
const items = [
  place('star-5', 'shape-1', { x: 480, y: 270 }),
  place('heart-heart', 'shape-2', { x: 320, y: 810 }),
  place('line-dash-tri-tri', 'shape-3', { x: 1440, y: 270 }),
  place('manga-shout', 'shape-4', { x: 1440, y: 810 }),
  place('basic-rounded-square', 'shape-5', { x: 960, y: 540 }),
];
let body = '';
for (const item of items) {
  const svg = shapeMarkup(item.source, item.id, output.width, item.transform).replace('<svg ', `<svg x="${item.transform.x}" y="${item.transform.y}" `);
  body += svg;
  const c = { x: item.transform.x + item.source.params.width / 2, y: item.transform.y + item.source.params.height / 2 };
  body += `<circle cx="${c.x}" cy="${c.y}" r="6" fill="#ef4444"/>`;
}
const frame = `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080"><rect width="1920" height="1080" fill="#5b6b7a"/>${body}</svg>`;
const file = path.join(outDir, 'static-placed-frame.svg');
await writeFile(file, frame);
execFileSync('rsvg-convert', ['-w', '960', '-o', file.replace(/\.svg$/, '.png'), file]);
await writeFile(path.join(outDir, 'static-placed-items.json'), `${JSON.stringify(items.map(item => ({
  id: item.id, preset: item.source.params.preset, shape: item.source.shape, transform: item.transform,
  width: item.source.params.width, height: item.source.params.height, fill: item.source.params.fill,
  stroke: item.source.params.stroke, strokeWidth: item.source.params.strokeWidth, cornerRadius: item.source.params.cornerRadius,
})), null, 2)}\n`);
console.log('ok');
