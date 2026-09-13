#!/usr/bin/env node
// L1 fixture: オーナー実データ（2026-09-13 09:1x 報告のプロジェクト）の captions.json を
// そのまま使う。1 文字トークン（これ / ゴ / ール / デ / ン / ウ / ィ / ー / ク / 明 / け / に / You）が
// 語にまとまるかを実機で見るため、words[] は 1 バイトも変えない。
// display_policy は既定（18 字・1 行）に戻し、emphasis_words は空から始める。
import { spawn } from 'node:child_process';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(HERE);
const REPO = path.resolve(ROOT, '..', '..', '..', '..', '..', '..');
const FIXTURE = path.join(ROOT, 'fixture', 'project');
const FFMPEG = process.env.FFMPEG || path.join(REPO, 'packages/media-bin/vendor/darwin-arm64/ffmpeg');
const FPS = 30;
const exists = async file => { try { await stat(file); return true; } catch { return false; } };
const atomicWrite = async (file, value) => {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}`;
  await writeFile(temporary, value);
  await rename(temporary, file);
};
const run = (command, args, cwd) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });
  child.once('error', reject);
  child.once('close', code => code === 0 ? resolve() : reject(new Error(`${command} failed (${code}): ${stderr.slice(-1600)}`)));
});

const captions = JSON.parse(await readFile(path.join(HERE, 'captions-owner.json'), 'utf8'));
const root = {
  display_policy: {
    mode: 'single_line_sequential',
    algorithm: 'a4-ja-two-fragment-v1',
    unit_metric: 'ascii-half-other-one-v1',
    max_line_units: 18,
    minimum_fragment_duration_seconds: 0.72,
    locale: 'ja',
    lines: 1,
    wrap: 'multi'
  },
  emphasis_words: [],
  captions
};
const mediaSeconds = Math.ceil(captions.at(-1).end + 1);
const media = path.join(FIXTURE, 'assets', 'base.mp4');
await mkdir(path.dirname(media), { recursive: true });
if (!await exists(media)) {
  await run(FFMPEG, [
    '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=#27313f:s=320x180:r=30',
    '-t', String(mediaSeconds), '-an', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '42',
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart', media
  ], FIXTURE);
}
const edit = {
  version: 2,
  output: { width: 320, height: 180, fps: FPS },
  sources: [{ id: 'src-1', path: 'assets/base.mp4' }],
  tracks: [
    { id: 'v-main', lane: 'visual', items: [{
      id: 'main-clip', at: 0, duration: mediaSeconds * FPS,
      source: { kind: 'media', src: 'src-1', in: 0, out: mediaSeconds }
    }] },
    { id: 'captions', lane: 'visual', content: { from: 'captions.json' } }
  ]
};
await atomicWrite(path.join(FIXTURE, 'captions.json'), `${JSON.stringify(root, null, 2)}\n`);
await atomicWrite(path.join(FIXTURE, 'edit.json'), `${JSON.stringify(edit, null, 2)}\n`);
if (!await exists(path.join(FIXTURE, '.git'))) {
  await run('/usr/bin/git', ['init'], FIXTURE);
  await run('/usr/bin/git', ['config', 'user.email', 'daihon-word-unit-fixture@localhost'], FIXTURE);
  await run('/usr/bin/git', ['config', 'user.name', 'Daihon Word Unit Fixture'], FIXTURE);
}
await run('/usr/bin/git', ['add', 'captions.json', 'edit.json'], FIXTURE);
const dirty = await new Promise(resolve => {
  const child = spawn('/usr/bin/git', ['diff', '--cached', '--quiet'], { cwd: FIXTURE });
  child.once('close', code => resolve(code !== 0));
});
if (dirty) await run('/usr/bin/git', ['commit', '-m', '語の単位 L1 fixture（オーナー実データ）'], FIXTURE);
process.stdout.write(`${JSON.stringify({ ok: true, rows: captions.length, tokens: captions.map(row => row.words.length) })}\n`);
