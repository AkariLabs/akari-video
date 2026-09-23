#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REPO = path.resolve(ROOT, '..', '..', '..', '..', '..', '..');
const PROJECT = process.argv[2];
if (!PROJECT || !path.isAbsolute(PROJECT) || !PROJECT.startsWith(path.resolve(os.tmpdir()) + path.sep)) {
  throw new Error('fixture path must be an absolute temporary directory');
}
const FFMPEG = path.join(REPO, 'packages/media-bin/vendor/darwin-arm64/ffmpeg');
const run = args => new Promise((resolve, reject) => {
  const child = spawn(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: ['ignore', 'ignore', 'pipe'] });
  let error = '';
  child.stderr.on('data', part => { error += part; });
  child.once('error', reject);
  child.once('close', code => code === 0 ? resolve() : reject(new Error(`ffmpeg ${code}: ${error}`)));
});
const writeJson = async (file, value) => { await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, JSON.stringify(value, null, 2) + '\n'); };
await mkdir(path.join(PROJECT, 'assets'), { recursive: true });
await run(['-f', 'lavfi', '-i', 'sine=frequency=440:duration=8', '-ar', '16000', path.join(PROJECT, 'assets/interview.wav')]);
await run(['-f', 'lavfi', '-i', 'color=c=#264653:s=640x360:r=30', '-t', '6', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', path.join(PROJECT, 'assets/ordinary.mp4')]);
await run(['-f', 'lavfi', '-i', 'color=c=#8257b8:s=640x360', '-frames:v', '1', path.join(PROJECT, 'assets/still.png')]);
const base = JSON.parse(await readFile(path.join(REPO, 'apps/shell/extensions/akari-annotations/test/fixtures/inspector-generation/edit.json'), 'utf8'));
base.sources = [
  { id: 'video', path: 'assets/ordinary.mp4' }, { id: 'still', path: 'assets/still.png' },
  { id: 'interview', path: 'assets/interview.wav' }
];
base.tracks[0].items = [
  { id: 'video-clip', at: 0, duration: 180, source: { kind: 'media', src: 'video', in: 0, out: 6 } },
  { id: 'still-clip', at: 180, duration: 180, source: { kind: 'media', src: 'still', in: 0, out: 6 } }
];
base.audio = { narration: [], sfx: [{ id: 'interview-clip', path: 'assets/interview.wav', t: 0, in: 0, out: 8, track: 0 }] };
await writeJson(path.join(PROJECT, 'edit.json'), base);
await writeJson(path.join(PROJECT, 'captions.json'), { captions: [] });
await writeJson(path.join(PROJECT, '.akari/connections.json'), { providers: [], defaults: {}, policy: {}, memory: [] });
const transcript = Array.from({ length: 7 }, (_, index) => ({ start: index, end: index + 0.8, text: `インタビューの字幕 ${index + 1}` }));
await writeJson(path.join(PROJECT, '.akari/sidecars/assets/interview.wav.analysis/analysis.json'), { transcript });
process.stdout.write(JSON.stringify({ project: PROJECT, audio: 'assets/interview.wav', video: 'assets/ordinary.mp4', still: 'assets/still.png', segments: transcript.length }) + '\n');
