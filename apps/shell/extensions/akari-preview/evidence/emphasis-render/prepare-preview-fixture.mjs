#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const workspace = process.argv[2];
if (!workspace) throw new Error('Usage: prepare-preview-fixture.mjs <workspace>');
const project = path.join(workspace, 'project');
await mkdir(project, { recursive: true });
await mkdir(path.join(workspace, 'userdata'), { recursive: true });
await mkdir(path.join(workspace, 'config'), { recursive: true });

const video = spawnSync('ffmpeg', [
  '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
  '-f', 'lavfi', '-i', 'color=c=0x1b2a4a:size=1280x720:rate=30:duration=2',
  '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
  path.join(project, 'source.mp4'),
], { encoding: 'utf8' });
if (video.status !== 0) throw new Error(video.stderr || `ffmpeg exited ${video.status}`);

await writeFile(path.join(project, 'edit.json'), `${JSON.stringify({
  version: 0,
  output: { width: 1280, height: 720, fps: 30 },
  source: { path: 'source.mp4', proxy: null },
  cuts: [{ in: 0, out: 2 }],
  overlays: [],
  emphasis_words: [{
    id: 'e-0001',
    t_start: 1,
    t_end: 1.9,
    word: 'やばい',
    emotion: 'surprise',
    style_hint: 'one-char-bang',
  }],
}, null, 2)}\n`);

await writeFile(path.join(project, 'captions.json'), `${JSON.stringify([{
  id: 'c-emphasis',
  start: 0,
  end: 2,
  text: 'これはやばいです',
  speaker: null,
  sourceRef: null,
  edited: false,
  style: 'karaoke',
  words: [
    { start: 0, end: 0.7, text: 'これは' },
    { start: 1, end: 1.9, text: 'やばい' },
    { start: 1.9, end: 2, text: 'です' },
  ],
}], null, 2)}\n`);
