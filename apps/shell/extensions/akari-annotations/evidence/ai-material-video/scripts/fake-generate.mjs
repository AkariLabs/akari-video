#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const args = process.argv.slice(2);
if (args[0] !== 'generate' || args[1] !== 'video' || !args.includes('--from-image') || !args.includes('--yes') || !args.includes('--json') || args.includes('--item')) throw Error('Expected generate video --from-image --yes --json');
const root = path.resolve(args[2]);
const relative = args[args.indexOf('--from-image') + 1];
if (!relative || path.isAbsolute(relative) || relative.split(/[\\/]/u).includes('..')) throw Error('Invalid image path');
const image = path.join(root, relative);
const imageBytes = await readFile(image);
const next = JSON.parse(await readFile(`${image}.meta.json`, 'utf8')).next;
if (next?.kind !== 'video' || next.status !== 'planned') throw Error('Missing image next draft');
await writeFile(path.join(root, 'fake-invocation.json'), JSON.stringify({ args, next, falKeyPresent: Boolean(process.env.FAL_KEY) }, null, 2));
const stem = path.basename(relative, path.extname(relative));
const mp4 = `assets/generated/${stem}-video-${Date.now()}.mp4`;
const absolute = path.join(root, mp4);
const sidecar = `${absolute}.meta.json`;
await mkdir(path.dirname(absolute), { recursive: true });
const started = new Date();
const base = {
  version: 1, kind: 'video', status: 'generating', model: { id: next.model.id, as_of: started.toISOString().slice(0, 10) },
  inputs: { prompt: next.inputs.prompt ?? '', negative_prompt: next.inputs.negative_prompt ?? null,
    first_frame: { path: relative, sha256: createHash('sha256').update(imageBytes).digest('hex') },
    last_frame: next.inputs.last_frame ?? null, reference_images: next.inputs.reference_images ?? [],
    reference_videos: next.inputs.reference_videos ?? [], reference_audios: next.inputs.reference_audios ?? [],
    source_video: next.inputs.source_video ?? null, camera: next.inputs.camera ?? null, seed: next.inputs.seed ?? null, extra: next.inputs.extra ?? {} },
  output: { duration_s: next.output.duration_s ?? 5, resolution: next.output.resolution ?? '768P' },
  cost: { estimate_usd: 0.3, actual_usd: null, unit: 'usd_per_second', source: 'estimate' },
  job: { provider: 'fake', request_id: `fake-${Date.now()}`, started_at: started.toISOString(), stale_after_s: 900 },
  provenance: { created_at: started.toISOString(), tool: 'akari generate video --from-image', key_source: 'fake' },
  history: [{ at: started.toISOString(), status: 'generating', reason: null }]
};
const write = async value => { const temp = `${sidecar}.tmp`; await writeFile(temp, JSON.stringify(value, null, 2)); await rename(temp, sidecar); };
await write(base);
await sleep(12_000);
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', '..', '..', '..');
const vendor = path.join(repo, 'packages/media-bin/vendor/darwin-arm64/ffmpeg');
const ffmpeg = existsSync(vendor) ? vendor : 'ffmpeg';
await new Promise((resolve, reject) => {
  const child = spawn(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=#8257b8:s=640x360:r=30', '-t', '2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', absolute]);
  child.once('error', reject); child.once('close', code => code === 0 ? resolve() : reject(Error(`ffmpeg ${code}`)));
});
const videoBytes = await readFile(absolute);
const finished = new Date();
const elapsed_s = (finished - started) / 1000;
await write({ ...base, status: 'done', cost: { ...base.cost, source: 'estimate' },
  result: { path: mp4, sha256: createHash('sha256').update(videoBytes).digest('hex'), bytes: (await stat(absolute)).size,
    duration_s_actual: 2, width: 640, height: 360, fps: '30/1', has_audio: false, elapsed_s },
  history: [...base.history, { at: finished.toISOString(), status: 'done', reason: null }] });
process.stdout.write(JSON.stringify({ from_image: relative, mp4, duration_s_actual: 2, estimate_usd: 0.3, elapsed_s,
  meta: `${mp4}.meta.json` }) + '\n');
