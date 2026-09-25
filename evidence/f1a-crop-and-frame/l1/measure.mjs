// Usage: node measure.mjs <png>... — decodes via ffmpeg to RGB and measures the framed photo.
import { spawnSync } from 'node:child_process';
const ffmpeg = process.env.AKARI_FFMPEG_BIN || 'ffmpeg';
export function rgb(png, w = 1080, h = 1920) {
  const out = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-i', png, '-vf', `scale=${w}:${h}:flags=neighbor`,
    '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: w * h * 4 }).stdout;
  return { w, h, data: out };
}
const isGreen = (d, i) => d[i + 1] > 150 && d[i] < 90 && d[i + 2] < 140;
export function measure(img) {
  const { w, h, data } = img;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 3;
    if (!isGreen(data, i)) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  }
  const at = (x, y) => (y * w + x) * 3;
  // Corner insets: first non-green pixel along the top row / left column of the bounding box.
  const corner = (sx, sy, dx, dy) => {
    let rx = 0; while (rx < 400 && isGreen(data, at(sx + dx * rx, sy))) rx++;
    let ry = 0; while (ry < 400 && isGreen(data, at(sx, sy + dy * ry))) ry++;
    // The 45-degree point: distance from the corner along the diagonal to the first non-green pixel.
    let dd = 0; while (dd < 400 && isGreen(data, at(sx + dx * dd, sy + dy * dd))) dd++;
    return { rx, ry, diagonal: dd };
  };
  const corners = { tl: corner(x0, y0, 1, 1), tr: corner(x1, y0, -1, 1), bl: corner(x0, y1, 1, -1), br: corner(x1, y1, -1, -1) };
  // Stroke: count bright (white) pixels from the left edge inward at mid height.
  const midY = Math.round((y0 + y1) / 2);
  let stroke = 0; for (let x = x0; x < x0 + 40; x++) { const i = at(x, midY); if (data[i] > 200 && data[i + 1] > 200 && data[i + 2] > 200) stroke++; }
  return { box: { x0, y0, x1, y1, width: x1 - x0 + 1, height: y1 - y0 + 1 }, corners, strokeAtMidLeft: stroke };
}
export function diff(a, b) {
  let max = 0, sum = 0, over = 0;
  for (let i = 0; i < a.data.length; i++) { const d = Math.abs(a.data[i] - b.data[i]); max = Math.max(max, d); sum += d; if (d > 16) over++; }
  return { max, mean: +(sum / a.data.length).toFixed(3), over16Ratio: +(over / a.data.length).toFixed(5) };
}
if (import.meta.url === `file://${process.argv[1]}`) {
  const imgs = process.argv.slice(2).map(p => rgb(p));
  for (const [i, img] of imgs.entries()) console.log(process.argv[2 + i].split('/').pop(), JSON.stringify(measure(img)));
  for (let i = 1; i < imgs.length; i++) console.log('diff', 0, i, JSON.stringify(diff(imgs[0], imgs[i])));
}
