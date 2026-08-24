#!/usr/bin/env node
// L1 fixture: minimal AKARI Video workspace with a 4s color source, v0 edit.json,
// and 2 caption cues (c-0001 = edit target with text_style, c-0002 = untouched control).
import { spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const workspace = process.argv[2];
if (!workspace) throw new Error('Usage: prepare-fixture.mjs <workspace>');
const project = path.join(workspace, 'project');
await mkdir(project, { recursive: true });
await mkdir(path.join(workspace, 'userdata'), { recursive: true });
await mkdir(path.join(workspace, 'config'), { recursive: true });

const video = spawnSync('ffmpeg', [
  '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
  '-f', 'lavfi', '-i', 'color=c=0x1b2a4a:size=1280x720:rate=30:duration=4',
  '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
  path.join(project, 'source.mp4'),
], { encoding: 'utf8' });
if (video.status !== 0) throw new Error(video.stderr || `ffmpeg exited ${video.status}`);

await writeFile(path.join(project, 'edit.json'), `${JSON.stringify({
  version: 2,
  output: { width: 1280, height: 720, fps: 30 },
  sources: [{ id: 'a', path: 'source.mp4' }],
  tracks: [{
    id: 'v-main', lane: 'visual', items: [
      { id: 'cut-a', at: 0, duration: 120, source: { kind: 'media', src: 'a', in: 0, out: 4 } },
    ],
  }],
}, null, 2)}\n`);

await writeFile(path.join(project, 'captions.json'), `${JSON.stringify([
  {
    id: 'c-0001', start: 0.3, end: 2, text: 'こんにちは世界', speaker: null,
    sourceRef: null, edited: false, src: 'a',
    text_style: { color: '#ffffff', zone: 'bottom' },
  },
  {
    id: 'c-0002', start: 2.2, end: 3.5, text: '触らない字幕', speaker: null,
    sourceRef: null, edited: false, src: 'a',
  },
], null, 2)}\n`);
console.log('fixture ready');
