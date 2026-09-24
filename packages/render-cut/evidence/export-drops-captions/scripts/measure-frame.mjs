// 動画の 1 フレームで、話した言葉の座布団（赤 #ff0000）と置いた文字の座布団（緑 #00ff00）の外接矩形を測る。
// 使い方: node measure-frame.mjs <mp4> <秒> [png 出力先]
import { execFileSync } from 'node:child_process';
const [file, t, png] = process.argv.slice(2);
const W = 1280, H = 720;
const args = ['-hide_banner', '-loglevel', 'error', '-ss', t, '-i', file, '-frames:v', '1', '-vf', `scale=${W}:${H}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'];
const buf = execFileSync('ffmpeg', args, { maxBuffer: 64 << 20 });
if (png) execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-ss', t, '-i', file, '-frames:v', '1', png]);
const box = (test) => {
  let x0 = W, y0 = H, x1 = -1, y1 = -1, rows = 0;
  for (let y = 0; y < H; y++) {
    let count = 0;
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 3;
      if (test(buf[i], buf[i + 1], buf[i + 2])) { count++; if (x < x0) x0 = x; if (x > x1) x1 = x; }
    }
    if (count > 20) { rows++; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  if (rows === 0) return null;
  return { left: x0, top: y0, right: x1, bottom: y1, width: x1 - x0 + 1, height: y1 - y0 + 1, cx: Math.round((x0 + x1) / 2 / W * 1000) / 1000, cy: Math.round((y0 + y1) / 2 / H * 1000) / 1000 };
};
// 白い文字（座布団の上の字）の画素数も数える（字そのものが描かれているか）
let white = 0;
for (let i = 0; i < buf.length; i += 3) if (buf[i] > 200 && buf[i + 1] > 200 && buf[i + 2] > 200) white++;
const spoken = box((r, g, b) => r > 180 && g < 90 && b < 90);
const placed = box((r, g, b) => g > 180 && r < 90 && b < 90);
console.log(JSON.stringify({ t, spoken, placed, whitePixels: white }));
