#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const [workspaceDir] = process.argv.slice(2);
if (!workspaceDir) {
  throw new Error('usage: prepare-fixture.mjs <workspaceDir>');
}

const projectDir = path.join(workspaceDir, 'project');
const starts = [0, 20, 41, 61, 83, 103, 126];
const items = starts.map((at, index) => ({
  id: `cut-${index}`,
  at,
  duration: 20,
  source: {
    kind: 'media',
    src: 's1',
    in: 0,
    out: 2,
    ...(index === 5 ? { transition_out: { type: 'dissolve', duration: 0.5 } } : {})
  }
}));
const edit = {
  version: 2,
  output: { width: 640, height: 360, fps: 10 },
  sources: [{ id: 's1', path: 'source.mp4', proxy: null }],
  tracks: [{ id: 'v-main', lane: 'visual', items }]
};

await mkdir(path.join(projectDir, '.akari'), { recursive: true });
await writeFile(path.join(projectDir, 'edit.json'), `${JSON.stringify(edit, null, 2)}\n`);
await writeFile(
  path.join(projectDir, '.akari', 'lint.json'),
  `${JSON.stringify({ version: 1, verdict: 'pass' })}\n`
);

const media = spawnSync('ffmpeg', [
  '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
  '-f', 'lavfi', '-i', 'color=c=teal:s=640x360:r=10:d=3',
  '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=3',
  '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest',
  path.join(projectDir, 'source.mp4')
], { encoding: 'utf8' });
assert.equal(media.status, 0, media.stderr);

console.log('prepared transition adjacency fixture');
