// PNG / 動画フレームを raw RGB で読む（ffmpeg）。bbox.mjs の load と同じ。
import { execFileSync } from 'node:child_process';
export function load(file) {
  const [w, h] = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file], { encoding: 'utf8' }).trim().split(',').map(Number);
  const b = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 1 << 30 });
  return { w, h, px: (x, y) => { const i = (y * w + x) * 3; return [b[i], b[i + 1], b[i + 2]]; } };
}
