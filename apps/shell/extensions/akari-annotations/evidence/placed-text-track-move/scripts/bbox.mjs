// 画像の中で「下地の色から大きく外れた画素」の外接矩形を求める（写真の置き場所の実測）。外部依存なし（PNG は ffmpeg で raw RGB に直す）。
// 使い方: node bbox.mjs <png|bgra> <outW> <outH> [--raw=<w>x<h>]（raw は BGRA）[--region=x0,y0,x1,y1（出力 px。既定は全体）]
//   出力: 画像を出力 px に換算した外接矩形・中心・幅（px）
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
const [file, outW, outH] = process.argv.slice(2); const OW = Number(outW), OH = Number(outH);
const raw = process.argv.find(v => v.startsWith('--raw='))?.slice(6);
const region = process.argv.find(v => v.startsWith('--region='))?.slice(9)?.split(',').map(Number);
export function load(file, raw) {
  if (raw) { const [w, h] = raw.split('x').map(Number); const b = readFileSync(file); return { w, h, px: (x, y) => { const i = (y * w + x) * 4; return [b[i + 2], b[i + 1], b[i]]; } }; }
  const probe = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file], { encoding: 'utf8' }).trim().split(',').map(Number);
  const [w, h] = probe; const b = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 1 << 30 });
  return { w, h, px: (x, y) => { const i = (y * w + x) * 3; return [b[i], b[i + 1], b[i + 2]]; } };
}
const img = load(file, raw);
const sx = img.w / OW, sy = img.h / OH;
const [rx0, ry0, rx1, ry1] = region ?? [0, 0, OW, OH];
// 下地 = 領域の四隅の近傍の中央値
const corners = [[rx0 + 3, ry0 + 3], [rx1 - 4, ry0 + 3], [rx0 + 3, ry1 - 4], [rx1 - 4, ry1 - 4]].map(([x, y]) => img.px(Math.round(x * sx), Math.round(y * sy)));
const base = [0, 1, 2].map(c => corners.map(p => p[c]).sort((a, b) => a - b)[1]);
let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, n = 0;
for (let y = Math.round(ry0 * sy); y < Math.round(ry1 * sy); y++) for (let x = Math.round(rx0 * sx); x < Math.round(rx1 * sx); x++) {
  const p = img.px(x, y); const d = Math.abs(p[0] - base[0]) + Math.abs(p[1] - base[1]) + Math.abs(p[2] - base[2]);
  if (d > 60) { n++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
}
const r = n ? { x: x0 / sx, y: y0 / sy, w: (x1 - x0 + 1) / sx, h: (y1 - y0 + 1) / sy } : null;
console.log(JSON.stringify({ image: { w: img.w, h: img.h }, output: { w: OW, h: OH }, base, pixels: n,
  bboxOutputPx: r && { x: +r.x.toFixed(2), y: +r.y.toFixed(2), w: +r.w.toFixed(2), h: +r.h.toFixed(2) },
  centerOutputPx: r && { x: +(r.x + r.w / 2).toFixed(2), y: +(r.y + r.h / 2).toFixed(2) } }));
