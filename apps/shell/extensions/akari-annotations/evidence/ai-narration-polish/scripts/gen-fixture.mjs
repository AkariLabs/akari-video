#!/usr/bin/env node
import { cp, mkdir, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { plannedStillMeta } from '../../../../../../../packages/generate/src/cli/meta-still.mjs';
import { validateGenerationMeta } from '../../../../../../../packages/generate/src/cli/meta-validate.mjs';

const evidence = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const repo = path.resolve(evidence, '../../../../../../');
const project = process.argv[2];
if (!project || !path.isAbsolute(project) || !project.startsWith(path.resolve(os.tmpdir()) + path.sep)) {
  throw new Error('fixture must be in a temporary directory');
}
await cp(path.join(repo, 'templates/project-default'), project, { recursive: true });
await mkdir(path.join(project, 'assets/generated'), { recursive: true });
await mkdir(path.join(project, 'assets'), { recursive: true });
const ffmpeg = path.join(repo, 'packages/media-bin/vendor/darwin-arm64/ffmpeg');
const run = args => new Promise((resolve, reject) => {
  const child = spawn(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: ['ignore', 'ignore', 'pipe'] });
  let error = ''; child.stderr.on('data', part => { error += part; });
  child.once('error', reject);
  child.once('close', code => code === 0 ? resolve() : reject(new Error(error || `ffmpeg ${code}`)));
});
await run(['-f', 'lavfi', '-i', 'color=c=#31566a:s=640x360:r=30', '-t', '12',
  '-c:v', 'libx264', '-pix_fmt', 'yuv420p', path.join(project, 'assets/scene.mp4')]);
for (const [name, seconds, frequency] of [['frame-a', 2, 0], ['frame-b', 2, 0],
  ['interview', 2, 420], ['following', 2, 240]]) {
  const destination = name.startsWith('frame') ? path.join(project, 'assets/generated', `${name}.wav`)
    : path.join(project, 'assets', `${name}.wav`);
  await run(['-f', 'lavfi', '-i', frequency
    ? `sine=frequency=${frequency}:sample_rate=48000:duration=${seconds}`
    : 'anullsrc=channel_layout=stereo:sample_rate=48000', '-t', String(seconds),
  '-c:a', 'pcm_s16le', '-ar', '48000', '-ac', '2', destination]);
  if (name.startsWith('frame')) {
    const at = new Date().toISOString();
    const meta = plannedStillMeta({ prompt: '', duration_s: seconds, at, asOf: at.slice(0, 10) });
    meta.kind = 'audio';
    meta.model = { id: 'akari:empty-audio', as_of: at.slice(0, 10) };
    meta.output.resolution = null;
    meta.cost = { estimate_usd: 0, actual_usd: null, unit: 'usd_per_audio', source: 'estimate' };
    meta.job = { provider: 'local', started_at: at, stale_after_s: 900 };
    meta.provenance = { created_at: at, tool: 'akari empty audio frame', key_source: null };
    const checked = validateGenerationMeta(meta);
    if (!checked.ok) throw new Error(checked.errors.join('\n'));
    await writeFile(`${destination}.meta.json`, JSON.stringify(meta, null, 2) + '\n');
  }
}
const source = (id, file) => ({ id, path: file });
const item = (id, src, at, duration = 60) => ({ id, at, duration,
  source: { kind: 'media', src, in: 0, out: duration / 30 } });
const edit = { version: 2, output: { width: 640, height: 360, fps: 30 },
  sources: [source('scene', 'assets/scene.mp4'), source('frame-a', 'assets/generated/frame-a.wav'),
    source('frame-b', 'assets/generated/frame-b.wav'), source('interview', 'assets/interview.wav'),
    source('following', 'assets/following.wav')],
  tracks: [{ id: 'audio', lane: 'audio', items: [item('frame-a', 'frame-a', 0),
    item('frame-b', 'frame-b', 120), item('following', 'following', 195), item('interview', 'interview', 270)] },
  { id: 'video', lane: 'visual', items: [item('scene', 'scene', 0, 360)] }] };
await writeFile(path.join(project, 'edit.json'), JSON.stringify(edit, null, 2) + '\n');
await writeFile(path.join(project, 'captions.json'), '{"captions":[]}\n');
process.stdout.write(JSON.stringify({ project, ids: ['frame-a', 'frame-b', 'interview'], fps: 30 }) + '\n');
