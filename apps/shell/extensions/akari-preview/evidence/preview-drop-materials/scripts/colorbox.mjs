// 指定色に近い画素の外接矩形（出力 px）: node colorbox.mjs <png> <outW> <outH> <r,g,b> [tol=40] [--region=x0,y0,x1,y1]
import { load } from './bbox-load.mjs';
const [file, outW, outH, rgb, tolArg] = process.argv.slice(2);
const [R, G, B] = rgb.split(',').map(Number); const tol = Number(tolArg ?? 40);
const region = process.argv.find(v => v.startsWith('--region='))?.slice(9)?.split(',').map(Number);
const img = load(file); const sx = img.w / Number(outW), sy = img.h / Number(outH);
const [rx0, ry0, rx1, ry1] = region ?? [0, 0, Number(outW), Number(outH)];
let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, n = 0;
for (let y = Math.round(ry0 * sy); y < Math.round(ry1 * sy); y++) for (let x = Math.round(rx0 * sx); x < Math.round(rx1 * sx); x++) {
  const p = img.px(x, y); if (Math.abs(p[0] - R) + Math.abs(p[1] - G) + Math.abs(p[2] - B) <= tol) { n++; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
}
const r = n ? { x: x0 / sx, y: y0 / sy, w: (x1 - x0 + 1) / sx, h: (y1 - y0 + 1) / sy } : null;
console.log(JSON.stringify({ file: file.split('/').pop(), color: rgb, pixels: n, bbox: r && { x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.w.toFixed(1), h: +r.h.toFixed(1) }, center: r && { x: +(r.x + r.w / 2).toFixed(1), y: +(r.y + r.h / 2).toFixed(1) } }));
