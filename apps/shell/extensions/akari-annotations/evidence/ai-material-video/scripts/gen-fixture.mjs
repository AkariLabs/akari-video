#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { doneStillMeta, inspectPng, withNextVideoDraft } from '../../../../../../../packages/generate/src/cli/meta-still.mjs';
import { makeReference } from '../../../../../../../packages/generate/src/cli/media-ref.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REPO = path.resolve(ROOT, '..', '..', '..', '..', '..', '..');
const project = process.argv[2];
if (!project || !path.isAbsolute(project) || !project.startsWith(os.tmpdir() + path.sep)) throw Error('Temporary project path required');
await cp(path.join(REPO, 'templates/project-default'), project, { recursive: true });
const ffmpeg = path.join(REPO, 'packages/media-bin/vendor/darwin-arm64/ffmpeg');
const run = args => new Promise((resolve, reject) => {
  const child = spawn(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', ...args]);
  child.once('error', reject); child.once('close', code => code === 0 ? resolve() : reject(Error(`ffmpeg ${code}`)));
});
await mkdir(path.join(project, 'assets'), { recursive: true });
await run(['-f', 'lavfi', '-i', 'color=c=#8257b8:s=640x360', '-frames:v', '1', path.join(project, 'assets/still.png')]);
const at = new Date().toISOString();
const still = doneStillMeta({ prompt: '', duration_s: 5, at, asOf: at.slice(0, 10), path: 'assets/still.png',
  image: await inspectPng(path.join(project, 'assets/still.png')) });
const planned = withNextVideoDraft(still, { firstFrame: makeReference(project, 'assets/still.png'),
  prompt: 'A slow camera move through a violet garden.', at });
planned.next.output.resolution = '768P';
await writeFile(path.join(project, 'assets/still.png.meta.json'), JSON.stringify(planned, null, 2) + '\n');
await run(['-f', 'lavfi', '-i', 'color=c=#264653:s=640x360:r=30', '-t', '6', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', path.join(project, 'assets/ordinary.mp4')]);
const edit = JSON.parse(await readFile(path.join(REPO, 'apps/shell/extensions/akari-annotations/test/fixtures/inspector-generation/edit.json'), 'utf8'));
edit.sources = [{ id: 'video', path: 'assets/ordinary.mp4' }];
edit.tracks[0].items = [{ id: 'video-clip', at: 0, duration: 180, source: { kind: 'media', src: 'video', in: 0, out: 6 } }];
edit.audio = { narration: [], sfx: [] };
await writeFile(path.join(project, 'edit.json'), JSON.stringify(edit, null, 2) + '\n');
await mkdir(path.join(project, '.akari'), { recursive: true });
process.stdout.write(JSON.stringify({ project, image: 'assets/still.png', timeline: 'assets/ordinary.mp4' }) + '\n');
