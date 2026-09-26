// 検証専用 fixture（ラッパー作成）。横長 1920×1080 / 縦長 1080×1920。
// 下から: 本編の動画 → 写真 → 図形 → 動きの付いた写真 → 字幕（話した言葉 + 置いた文字）→ 字幕を覆う写真（cover）
import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const run = (cmd, args) => { const r = spawnSync(cmd, args, { encoding: 'utf8' }); if (r.status !== 0) throw new Error(`${cmd}: ${r.stderr}`); };

export default async function fixture({ project, repo, orient, editPath }) {
  const portrait = orient === 'portrait';
  const W = portrait ? 1080 : 1920, H = portrait ? 1920 : 1080, FPS = 30, SEC = 10;
  const assets = path.join(project, 'assets');
  await mkdir(assets, { recursive: true });
  await copyFile(path.join(repo, 'templates/kaisetsu-short/sample-project/assets/dummy-shot.png'), path.join(assets, 'photo.png'));
  run(process.env.FFMPEG ?? 'ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-f', 'lavfi', '-i',
    `color=c=0x9ca3af:s=${W}x${H}:d=${SEC}:r=${FPS}`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-g', '30', path.join(assets, 'base.mp4')]);
  run(process.env.FFMPEG ?? 'ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-f', 'lavfi', '-i',
    `color=c=0x7c3aed:s=${W}x${Math.round(H * 0.28)}`, '-frames:v', '1', path.join(assets, 'cover.png')]);
  const coverH = Math.round(H * 0.28);
  const D = SEC * FPS;
  const edit = {
    version: 2, output: { width: W, height: H, fps: FPS },
    sources: [{ id: 'base', path: 'assets/base.mp4' }, { id: 'photo', path: 'assets/photo.png' }, { id: 'cover', path: 'assets/cover.png' }],
    tracks: [
      { id: 'v-main', lane: 'visual', name: '本編', items: [{ id: 'cut-1', at: 0, duration: D, source: { kind: 'media', src: 'base', in: 0, out: SEC } }] },
      { id: 'v-photo', lane: 'visual', name: 'photo', items: [{ id: 'photo-1', at: 0, duration: D,
        transform: portrait ? { x: -200, y: -560, scale: 0.6 } : { x: -560, y: -250, scale: 0.6 },
        source: { kind: 'media', src: 'photo', in: 0, out: SEC } }] },
      { id: 'v-shape', lane: 'visual', name: 'shape', items: [{ id: 'shape-a', at: 0, duration: D,
        transform: portrait ? { x: 620, y: 700 } : { x: 1340, y: 380 },
        source: { kind: 'shape', shape: 'rect', params: { width: 300, height: 200, fill: '#3b82f6', stroke: '#111827', strokeWidth: 6 } } }] },
      { id: 'v-kf', lane: 'visual', name: 'kf', items: [{ id: 'photo-kf', at: 0, duration: D,
        transform: portrait ? { x: 200, y: 150, scale: 0.4 } : { x: 420, y: 150, scale: 0.4 },
        keyframes: [{ t: 0, transform: { scale: 0.35 } }, { t: D - 1, transform: { scale: 0.55 } }],
        source: { kind: 'media', src: 'photo', in: 0, out: SEC } }] },
      { id: 'v-text', lane: 'visual', name: '字幕', items: [{ id: 'captions', name: '字幕', at: 0, duration: D, source: { kind: 'captions', path: 'captions.json' }, items: [] }] },
      { id: 'v-cover', lane: 'visual', name: 'cover', items: [{ id: 'cover-1', at: 0, duration: D,
        transform: { x: 0, y: Math.round(H / 2 - coverH / 2) },
        source: { kind: 'media', src: 'cover', in: 0, out: SEC } }] }
    ]
  };
  await writeFile(editPath, `${JSON.stringify(edit, null, 2)}\n`);
  const captions = { default_text_style: { zone: 'bottom' }, captions: [
    { id: 'c-0001', start: 0, end: 10, time_domain: 'output', text: '隠れた字幕のつまみ', speaker: null, sourceRef: null, edited: true },
    { id: 'c-0101', start: 0, end: 10, time_domain: 'output', text: '置いた文字', speaker: null, sourceRef: null, edited: true,
      text_style: { position: { y: 0.36 }, text_anchor: 'tc' } }
  ] };
  await writeFile(path.join(project, 'captions.json'), `${JSON.stringify(captions, null, 2)}\n`);
}
