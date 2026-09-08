#!/usr/bin/env node
// L1 fixture (wrapper-authored, verification-only; not product source).
// dogfood 素材の先頭 30 秒を切り出した「未文字起こし」のプロジェクトを作る。
// analysis.json を置かないので transcriptStates は 'none' = alreadyTranscribed false。
import { spawn } from 'node:child_process';
import { mkdir, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(HERE);
const REPO = path.resolve(ROOT, '..', '..', '..', '..', '..', '..');
const PROJECT = path.join(ROOT, 'fixture', 'simple-mode');
const REL = 'assets/base.mp4';
const FFMPEG = process.env.FFMPEG || path.join(REPO, 'packages/media-bin/vendor/darwin-arm64/ffmpeg');
const SOURCE = process.env.AKARI_L1_SOURCE;
const FPS = 30;
const SECONDS = 30;

const exists = async file => { try { await stat(file); return true; } catch { return false; } };
const atomicWrite = async (file, value) => {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}`;
  await writeFile(temporary, value);
  await rename(temporary, file);
};
const writeJson = (file, value) => atomicWrite(file, `${JSON.stringify(value, null, 2)}\n`);
const run = (command, args) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });
  child.once('error', reject);
  child.once('close', code => code === 0 ? resolve() : reject(new Error(`${command} failed (${code}): ${stderr.slice(-1600)}`)));
});

if (!SOURCE) throw new Error('AKARI_L1_SOURCE (dogfood 素材の絶対パス) を指定してください');
const media = path.join(PROJECT, REL);
await mkdir(path.dirname(media), { recursive: true });
if (!await exists(media)) {
  await run(FFMPEG, [
    '-hide_banner', '-loglevel', 'error', '-y', '-ss', '0', '-t', String(SECONDS), '-i', SOURCE,
    '-vf', 'scale=320:-2', '-r', String(FPS), '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '40',
    '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '96k', '-ac', '1', '-ar', '16000',
    '-movflags', '+faststart', media
  ]);
}

await writeJson(path.join(PROJECT, 'edit.json'), {
  version: 2,
  output: { width: 320, height: 180, fps: FPS },
  sources: [{ id: 'main', path: REL }],
  tracks: [
    { id: 'v-main', lane: 'visual', items: [{
      id: 'main-clip', at: 0, duration: SECONDS * FPS,
      source: { kind: 'media', src: 'main', in: 0, out: SECONDS }
    }] },
    { id: 'captions', lane: 'visual', content: { from: 'captions.json' } }
  ]
});
await writeJson(path.join(PROJECT, 'captions.json'), []);
await mkdir(path.join(PROJECT, '.akari/events'), { recursive: true });
process.stdout.write(`${JSON.stringify({ ok: true, project: PROJECT, relativePath: REL, seconds: SECONDS })}\n`);
