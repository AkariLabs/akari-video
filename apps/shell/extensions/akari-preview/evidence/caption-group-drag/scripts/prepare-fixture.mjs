#!/usr/bin/env node
// L1 fixture for the caption group drag lane.
// Duplicates tasks/2026-08-31-issue-35-caption-anchor-bottom/fixture (2 cues +
// default_text_style = bc + position.y) onto a 4 s H.264 clip so the shell preview
// runs its normal video path, and adds one HTML overlay that stands for a line that
// was taken out of the caption group ("テロップに変換") for the regression check.
// Usage: node prepare-fixture.mjs <workspace> [<issue35-fixture-dir>]
import { spawnSync } from 'node:child_process';
import { mkdir, writeFile, copyFile } from 'node:fs/promises';
import path from 'node:path';

const workspace = process.argv[2];
const fixtureDir = process.argv[3];
if (!workspace || !fixtureDir) {
  throw new Error('usage: prepare-fixture.mjs <workspace> <issue35-fixture-dir>');
}
const project = path.join(workspace, 'project');
await mkdir(path.join(project, 'assets'), { recursive: true });
await mkdir(path.join(project, 'overlays'), { recursive: true });
await mkdir(path.join(workspace, 'userdata'), { recursive: true });
await mkdir(path.join(workspace, 'config'), { recursive: true });

await copyFile(path.join(fixtureDir, 'assets', 'base.png'), path.join(project, 'assets', 'base.png'));

// still -> 4 s H.264 so the preview uses the ordinary <video> transport
const video = spawnSync('ffmpeg', [
  '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
  '-loop', '1', '-t', '4', '-i', path.join(project, 'assets', 'base.png'),
  '-r', '30', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-vf', 'scale=1920:1080',
  path.join(project, 'source.mp4'),
], { encoding: 'utf8' });
if (video.status !== 0) throw new Error(video.stderr || `ffmpeg exited ${video.status}`);

// captions.json: same shape/values as the issue #35 fixture (bc + position.y group default)
await writeFile(path.join(project, 'captions.json'), `${JSON.stringify({
  default_text_style: {
    text_anchor: 'bc',
    position: { y: 0.905 },
    size_px: 46,
    max_width_pct: 82,
  },
  captions: [
    {
      id: 'c-0001', start: 0.2, end: 1.8, text: '一行の字幕は収まる',
      speaker: null, sourceRef: null, edited: false, src: 'a',
    },
    {
      id: 'c-0002', start: 2.0, end: 3.8, text: '二本目の字幕も同じ位置に出る',
      speaker: null, sourceRef: null, edited: false, src: 'a',
    },
  ],
}, null, 2)}\n`);

await writeFile(path.join(project, 'overlays', 'extracted-line.html'), `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><style>
  html,body{margin:0;height:100%;background:transparent}
  .tag{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);
    padding:10px 22px;border-radius:10px;background:#ff8b2c;color:#111;
    font:700 40px/1.3 "Noto Sans JP",sans-serif;white-space:nowrap}
</style></head><body><div class="tag">出した行</div></body></html>
`);

await writeFile(path.join(project, 'edit.json'), `${JSON.stringify({
  version: 2,
  output: { width: 1920, height: 1080, fps: 30 },
  sources: [{ id: 'a', path: 'source.mp4' }],
  tracks: [
    {
      id: 'v-main', lane: 'visual', name: 'Base',
      items: [{ id: 'cut-base', at: 0, duration: 120, source: { kind: 'media', src: 'a', in: 0, out: 4 } }],
    },
    {
      id: 'v-captions', lane: 'visual', name: '字幕',
      items: [{
        id: 'captions', name: '字幕', at: 0, duration: 120,
        source: { kind: 'captions', path: 'captions.json' }, items: [],
      }],
    },
    {
      id: 'v-extracted', lane: 'visual', name: 'Extracted line',
      items: [{
        id: 'extracted-line', at: 0, duration: 120,
        transform: { x: 0, y: 0, scale: 1, rotate: 0 },
        source: { kind: 'html', path: 'overlays/extracted-line.html' },
      }],
    },
  ],
}, null, 2)}\n`);

console.log('fixture ready');
