#!/usr/bin/env node
// Builds a v2 project whose only visual content is a ProRes 4444 (yuva444p10le) alpha source
// placed twice on the same track/time span. Per the classification rule already exercised by
// cut-visual-fields-preview's prepare-fixture.mjs (see its comment), two items fully overlapping
// in at/duration both fall into the 'layers' bucket (neither becomes the single 'cut'), so the
// on-canvas item exercises exactly the tracks[].items video-layer decode-failure path this task
// fixes -- not the primary <video> cut path (already covered by the existing HEVC fallback).
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const [workspaceDir] = process.argv.slice(2);
if (!workspaceDir) throw new Error('usage: prepare-fixture.mjs <workspace-dir>');

const projectDir = path.join(workspaceDir, 'project');
await mkdir(path.join(projectDir, '.akari'), { recursive: true });

const sourcePath = path.join(projectDir, 'alpha.mov');
execFileSync('ffmpeg', [
  '-v', 'error', '-y',
  '-f', 'lavfi',
  '-i', 'color=c=red@0.35:s=640x360:r=10:d=2,format=yuva444p10le',
  '-c:v', 'prores_ks', '-profile:v', '4444', '-pix_fmt', 'yuva444p10le',
  sourcePath
]);

const onCanvas = {
  id: 'on-canvas', at: 0, duration: 60,
  transform: { x: 0, y: 0, scale: 1, rotate: 0 },
  opacity: 1,
  source: { kind: 'media', src: 'alpha', in: 0, out: 2 }
};
// Off-canvas sibling with the identical at/duration forces both items into the layers bucket
// (see file header) so on-canvas is never treated as the primary cut.
const offCanvasSibling = {
  id: 'off-canvas-sibling', at: 0, duration: 60,
  transform: { x: 10000, y: 0, scale: 1, rotate: 0 },
  source: { kind: 'media', src: 'alpha', in: 0, out: 2 }
};

const edit = {
  version: 2,
  output: { width: 640, height: 360, fps: 30 },
  sources: [{ id: 'alpha', path: 'alpha.mov', proxy: null }],
  tracks: [{ id: 'v-main', lane: 'visual', items: [onCanvas, offCanvasSibling] }]
};

await writeFile(path.join(projectDir, 'edit.json'), `${JSON.stringify(edit, null, 2)}\n`);
await writeFile(
  path.join(projectDir, '.akari', 'lint.json'),
  `${JSON.stringify({ version: 1, verdict: 'pass' }, null, 2)}\n`
);

console.log('prepared ProRes 4444 alpha layer fixture');
