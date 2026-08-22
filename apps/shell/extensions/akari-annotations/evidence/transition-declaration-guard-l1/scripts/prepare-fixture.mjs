#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const [phase, workspaceDir] = process.argv.slice(2);
if (!['a', 'b', 'c'].includes(phase) || !workspaceDir) {
  throw new Error('usage: prepare-fixture.mjs <phase:a|b|c> <workspaceDir>');
}

const projectDir = path.join(workspaceDir, 'project');
const transition = { type: 'dissolve', duration: 0.5 };
const mainTrack = {
  id: 'v-main',
  lane: 'visual',
  items: [
    {
      id: 'cut-a', at: 0, duration: 40,
      source: {
        kind: 'media', src: 's1', in: 0, out: 4,
        ...(phase === 'a' ? { transition_out: transition } : {})
      }
    },
    {
      id: 'cut-b', at: 40, duration: 40,
      source: { kind: 'media', src: 's1', in: 0, out: 4 }
    }
  ]
};
const overlayTrack = {
  id: 'v-overlay',
  lane: 'visual',
  items: [
    { id: 'title', at: 5, duration: 10, source: { kind: 'html', path: 'title.html' } }
  ]
};
const layerTrack = {
  id: 'v-layer',
  lane: 'visual',
  items: [
    {
      id: 'layer', at: 50, duration: 10, blend: 'multiply',
      source: { kind: 'media', src: 's1', in: 0, out: 1 }
    }
  ]
};
const tracks = phase === 'c'
  ? [mainTrack, layerTrack, overlayTrack]
  : [mainTrack, overlayTrack, layerTrack];
const edit = {
  version: 2,
  output: { width: 640, height: 360, fps: 10 },
  sources: [{ id: 's1', path: 'source.mp4', proxy: null }],
  tracks
};

await mkdir(path.join(projectDir, '.akari'), { recursive: true });
await writeFile(path.join(projectDir, 'edit.json'), `${JSON.stringify(edit, null, 2)}\n`);
await writeFile(
  path.join(projectDir, 'title.html'),
  '<!doctype html><html><body><div data-akari-overlay>title</div></body></html>\n'
);
await writeFile(
  path.join(projectDir, '.akari', 'lint.json'),
  `${JSON.stringify({ version: 1, verdict: phase === 'a' ? 'fail' : 'pass' })}\n`
);

const media = spawnSync('ffmpeg', [
  '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
  '-f', 'lavfi', '-i', 'color=c=green:s=640x360:r=10:d=6',
  '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=6',
  '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest',
  path.join(projectDir, 'source.mp4')
], { encoding: 'utf8' });
assert.equal(media.status, 0, media.stderr);

console.log(`prepared phase ${phase}`);
