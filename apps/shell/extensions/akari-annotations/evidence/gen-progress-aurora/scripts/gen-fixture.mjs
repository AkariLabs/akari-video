#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { copyFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REPO = path.resolve(ROOT, '..', '..', '..', '..', '..', '..');
const SOURCE = path.join(REPO, 'apps', 'shell', 'extensions', 'akari-annotations', 'test', 'fixtures', 'inspector-generation');
const PROJECT = process.env.GEN_PROGRESS_PROJECT;
if (!PROJECT) throw new Error('GEN_PROGRESS_PROJECT is required');
const FFMPEG = process.env.FFMPEG || path.join(REPO, 'packages', 'media-bin', 'vendor', 'darwin-arm64', 'ffmpeg');

const run = (command, args, cwd) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], detached: false });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });
  child.once('error', reject);
  child.once('close', code => code === 0 ? resolve() : reject(new Error(`${command} failed (${code}): ${stderr.slice(-1600)}`)));
});
const atomicJson = async (file, value) => {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temporary, file);
};

await rm(PROJECT, { recursive: true, force: true });
await mkdir(path.join(PROJECT, 'assets', 'stills'), { recursive: true });
await mkdir(path.join(PROJECT, '.akari'), { recursive: true });
await copyFile(path.join(SOURCE, 'edit.json'), path.join(PROJECT, 'edit.json'));
// connections.json はここで書き起こす（コピー元にしない）。リポジトリの .gitignore が
// `.akari/` を丸ごと無視するため、test/fixtures/ 側に置いても取り込まれず、
// 新しいクローンでは copyFile が ENOENT で落ちる。
await atomicJson(path.join(PROJECT, '.akari', 'connections.json'), {
  providers: [],
  defaults: { generate: { still: 'codex-image', video: 'fal:h3-i2v' } },
  policy: { currency: 'USD', monthly_budget: null, approval_threshold: null },
  memory: []
});

for (const [name, color] of [['a', '#d6402b'], ['b', '#1f6f8b'], ['c', '#2e8b57'], ['plain', '#8257b8']]) {
  await run(FFMPEG, [
    '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', `color=c=${color}:s=640x360`,
    '-frames:v', '1', path.join(PROJECT, 'assets', 'stills', `${name}.png`)
  ], PROJECT);
}

for (const name of ['a', 'b', 'c']) await atomicJson(path.join(PROJECT, 'assets', 'stills', `${name}.png.meta.json`), {
  version: 1, kind: 'still', status: name === 'b' ? 'planned' : 'done',
  provenance: { created_at: new Date().toISOString(), tool: 'l1-ai-tab-shell-fixture' },
  ...(name === 'a' ? { next: {
    kind: 'video', status: 'planned', model: { id: 'fal:h3-i2v' },
    inputs: { prompt: 'A garden.', first_frame: { path: 'assets/stills/a.png' }, last_frame: { path: 'assets/stills/b.png' }, reference_images: [], reference_audios: [], camera: null },
    output: { duration_s: 6, resolution: '768P', audio_out: true }, updated_at: new Date().toISOString()
  } } : {})
});
await atomicJson(path.join(PROJECT, 'captions.json'), { captions: [] });

const edit = JSON.parse(await readFile(path.join(PROJECT, 'edit.json'), 'utf8'));
if (process.env.GEN_PROGRESS_TRANSFORM === '1') {
  const frame = edit.tracks[0].items.find(item => item.id === 'clip-b');
  frame.transform = { x: 160, y: -80, scale: 0.55 };
}
edit.sources.push({ id: 'still-plain', path: 'assets/stills/plain.png' }, { id: 'video-plain', path: 'assets/recorded.mp4' });
edit.tracks[0].items.push(
  { id: 'clip-plain', at: 540, duration: 180, source: { kind: 'media', src: 'still-plain', in: 0, out: 6 } },
  { id: 'clip-mp4', at: 720, duration: 180, source: { kind: 'media', src: 'video-plain', in: 0, out: 6 } }
);
await atomicJson(path.join(PROJECT, 'edit.json'), edit);
await run(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=#264653:s=640x360:r=30',
  '-t', '6', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', path.join(PROJECT, 'assets/recorded.mp4')], PROJECT);
await mkdir(path.join(PROJECT, 'assets/generated'), { recursive: true });
await run(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i',
  'anullsrc=channel_layout=stereo:sample_rate=48000', '-t', '6', '-c:a', 'pcm_s16le',
  path.join(PROJECT, 'assets/generated/frame-audio-fixture.wav')], PROJECT);
const at = new Date().toISOString();
await atomicJson(path.join(PROJECT, 'assets/generated/frame-audio-fixture.wav.meta.json'), {
  version: 1, kind: 'audio', status: 'planned', model: { id: 'akari:empty-audio', as_of: at.slice(0, 10) },
  inputs: { prompt: '', negative_prompt: null, first_frame: null, last_frame: null,
    reference_images: [], reference_videos: [], reference_audios: [], source_video: null,
    mode: null, camera: null, seed: null, extra: {} },
  output: { duration_s: 6, resolution: null, aspect: null, audio_out: null },
  cost: { estimate_usd: 0, actual_usd: null, unit: 'usd_per_audio', source: 'estimate' },
  job: { provider: 'local', started_at: at, stale_after_s: 900 },
  provenance: { created_at: at, tool: 'akari empty audio frame', key_source: null },
  history: [{ at, status: 'planned', reason: null }]
});
edit.sources.push({ id: 'audio-frame-source', path: 'assets/generated/frame-audio-fixture.wav' });
edit.tracks.push({ id: 'audio-main', lane: 'audio', items: [{ id: 'audio-frame', at: 180, duration: 180,
  source: { kind: 'media', src: 'audio-frame-source', in: 0, out: 6 } }] });
await atomicJson(path.join(PROJECT, 'edit.json'), edit);
process.stdout.write(`${JSON.stringify({
  ok: true,
  project: 'temporary-workspace',
  clips: edit.tracks?.[0]?.items?.map(item => item.id) ?? [],
  sidecars: ['a', 'b', 'c'].map(name => `assets/stills/${name}.png.meta.json`),
  plainImage: 'assets/stills/plain.png',
  captions: true
})}\n`);
