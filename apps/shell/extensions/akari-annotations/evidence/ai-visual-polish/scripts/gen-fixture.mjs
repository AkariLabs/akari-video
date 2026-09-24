#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { cp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { plannedStillMeta } from '../../../../../../../packages/generate/src/cli/meta-still.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REPO = path.resolve(ROOT, '..', '..', '..', '..', '..', '..');
const PROJECT = process.argv[2];
if (!PROJECT || !path.isAbsolute(PROJECT) || !PROJECT.startsWith(path.resolve(os.tmpdir()) + path.sep)) {
  throw new Error('fixture path must be an absolute temporary directory');
}
const ffmpeg = path.join(REPO, 'packages/media-bin/vendor/darwin-arm64/ffmpeg');
const run = args => new Promise((resolve, reject) => {
  const child = spawn(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });
  child.once('error', reject);
  child.once('close', code => code === 0 ? resolve() : reject(new Error(`ffmpeg ${code}: ${stderr}`)));
});
const json = (file, value) => writeFile(file, JSON.stringify(value, null, 2) + '\n');
await cp(path.join(REPO, 'templates/project-default'), PROJECT, { recursive: true });
await mkdir(path.join(PROJECT, 'assets/generated'), { recursive: true });
await run(['-f', 'lavfi', '-i', 'color=c=#264653:s=640x360:r=30', '-t', '16', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', path.join(PROJECT, 'assets/ordinary.mp4')]);
await run(['-f', 'lavfi', '-i', 'sine=frequency=440:duration=5', '-ar', '48000', path.join(PROJECT, 'assets/ordinary.wav')]);
const framePath = 'assets/generated/frame-audio-fixture.wav';
await run(['-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000', '-t', '6', '-c:a', 'pcm_s16le', '-ar', '48000', '-ac', '2', path.join(PROJECT, framePath)]);
const at = new Date().toISOString();
const meta = plannedStillMeta({ prompt: '', duration_s: 6, at, asOf: at.slice(0, 10) });
meta.kind = 'audio';
meta.model = { id: 'akari:empty-audio', as_of: at.slice(0, 10) };
meta.output.resolution = null;
meta.cost = { estimate_usd: 0, actual_usd: null, unit: 'usd_per_audio', source: 'estimate' };
meta.job = { provider: 'local', started_at: at, stale_after_s: 900 };
meta.provenance = { created_at: at, tool: 'akari empty audio frame', key_source: null };
await json(path.join(PROJECT, `${framePath}.meta.json`), meta);
const edit = {
  version: 2, output: { width: 640, height: 360, fps: 30 },
  sources: [
    { id: 'video', path: 'assets/ordinary.mp4' },
    { id: 'ordinary-audio', path: 'assets/ordinary.wav' },
    { id: 'frame-audio', path: framePath }
  ],
  tracks: [
    { id: 'audio', lane: 'audio', items: [
      { id: 'ordinary-narration', role: 'narration', at: 0, duration: 150, source: { kind: 'media', src: 'ordinary-audio', in: 0, out: 5 } },
      { id: 'frame-1', name: '空の枠（音）', role: 'narration', at: 180, duration: 180, source: { kind: 'media', src: 'frame-audio', in: 0, out: 6 } }
    ] },
    { id: 'video', lane: 'visual', items: [
      { id: 'video-clip', at: 0, duration: 480, source: { kind: 'media', src: 'video', in: 0, out: 16 } }
    ] }
  ],
  audio: { narration: [], sfx: [] }
};
await json(path.join(PROJECT, 'edit.json'), edit);
await json(path.join(PROJECT, 'captions.json'), { captions: [] });
await json(path.join(PROJECT, '.akari/connections.json'), { providers: [], defaults: {}, policy: {}, memory: [] });
process.stdout.write(JSON.stringify({ project: PROJECT, framePath, ordinaryPath: 'assets/ordinary.wav' }) + '\n');
