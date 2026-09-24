// 動画の 1 フレームで「赤い座布団」の横幅・縦幅（赤ランの最長行・赤を含む行数）を測る。
// 使い方: node measure-frame.mjs <mp4> <秒>
import { execFileSync } from 'node:child_process';
const [file, t] = process.argv.slice(2);
const W = 1280, H = 720;
const args = ['-hide_banner', '-loglevel', 'error'];
if (t) args.push('-ss', t);
args.push('-i', file, '-frames:v', '1', '-vf', `scale=${W}:${H}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-');
const buf = execFileSync('ffmpeg', args, { maxBuffer: 64 << 20 });
const red = (x, y) => { const i = (y * W + x) * 3; return buf[i] > 180 && buf[i + 1] < 90 && buf[i + 2] < 90; };
let best = { len: 0 }, rows = 0;
for (let y = 0; y < H; y++) {
  let first = -1, last = -1, count = 0;
  for (let x = 0; x < W; x++) if (red(x, y)) { count++; if (first < 0) first = x; last = x; }
  if (count > 20) rows++;
  if (count > best.len) best = { len: count, y, left: first, right: last };
}
console.log(JSON.stringify({ file: file.split('/').slice(-3).join('/'), t, plateWidthPx: best.len, left: best.left, right: best.right, row: best.y, plateHeightRows: rows, frameWidth: W, ratio: Math.round(best.len / W * 1000) / 1000 }));
