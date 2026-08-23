#!/usr/bin/env node
import assert from 'node:assert/strict';
import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const [type, workspaceDir, mediaPath] = process.argv.slice(2);
const types = ['dissolve', 'fade-black', 'fade-white', 'reveal-down', 'reveal-up'];
if (!types.includes(type) || !workspaceDir || !mediaPath) {
  throw new Error('usage: prepare-fixture.mjs <transition-type> <workspace-dir> <fieldtest-media>');
}

const projectDir = path.join(workspaceDir, 'project');
await mkdir(path.join(projectDir, '.akari'), { recursive: true });
await copyFile(mediaPath, path.join(projectDir, 'source.mp4'));

const edit = {
  version: 2,
  output: { width: 640, height: 360, fps: 30 },
  sources: [{ id: 'field', path: 'source.mp4', proxy: null }],
  tracks: [{
    id: 'v-main',
    lane: 'visual',
    items: [
      {
        id: 'cut-a', at: 0, duration: 60,
        source: {
          kind: 'media', src: 'field', in: 0, out: 2,
          transition_out: { type, duration: 1 }
        }
      },
      {
        id: 'cut-b', at: 30, duration: 60,
        source: { kind: 'media', src: 'field', in: 2, out: 4 }
      }
    ]
  }]
};
await writeFile(path.join(projectDir, 'edit.json'), `${JSON.stringify(edit, null, 2)}\n`);
await writeFile(path.join(projectDir, '.akari', 'lint.json'), `${JSON.stringify({ version: 1, verdict: 'pass' })}\n`);

assert.equal(edit.tracks[0].items[1].at, 30);
console.log(`prepared ${type}`);
