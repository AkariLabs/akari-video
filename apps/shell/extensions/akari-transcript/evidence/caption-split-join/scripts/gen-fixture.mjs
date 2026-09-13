#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(HERE);
const REPO = path.resolve(ROOT, '..', '..', '..', '..', '..', '..');
const FIXTURE = path.join(ROOT, 'fixture', 'project');
const FFMPEG = process.env.FFMPEG || path.join(REPO, 'packages/media-bin/vendor/darwin-arm64/ffmpeg');
const exists = async file => { try { await stat(file); return true; } catch { return false; } };
const run = (command, args, cwd) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });
  child.once('error', reject);
  child.once('close', code => code === 0 ? resolve() : reject(new Error(`${command} failed (${code}): ${stderr.slice(-1200)}`)));
});
const atomicWrite = async (file, value) => {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}`;
  await writeFile(temporary, value);
  await rename(temporary, file);
};
const rows = JSON.parse(await readFile(path.join(HERE, 'captions-owner.json'), 'utf8'));
const mediaSeconds = Math.ceil(rows.at(-1).end + 1);
const captions = {
  display_policy: {
    mode: 'single_line_sequential', algorithm: 'a4-ja-two-fragment-v1',
    unit_metric: 'ascii-half-other-one-v1', max_line_units: 10,
    minimum_fragment_duration_seconds: 0.72, locale: 'ja', lines: 1, wrap: 'multi'
  },
  emphasis_words: [],
  captions: rows
};
await mkdir(path.join(FIXTURE, 'assets'), { recursive: true });
const media = path.join(FIXTURE, 'assets', 'base.mp4');
await run(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i',
  'color=c=#27313f:s=320x180:r=30', '-t', String(mediaSeconds), '-an', '-c:v', 'libx264', '-preset',
  'ultrafast', '-crf', '42', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', media], FIXTURE);
const edit = {
  version: 2, output: { width: 320, height: 180, fps: 30 },
  sources: [{ id: 'src-1', path: 'assets/base.mp4' }],
  tracks: [
    { id: 'v-main', lane: 'visual', items: [{ id: 'main-clip', at: 0, duration: mediaSeconds * 30,
      source: { kind: 'media', src: 'src-1', in: 0, out: mediaSeconds } }] },
    { id: 'captions', lane: 'visual', content: { from: 'captions.json' } }
  ]
};
await atomicWrite(path.join(FIXTURE, 'captions.json'), `${JSON.stringify(captions, null, 2)}\n`);
await atomicWrite(path.join(FIXTURE, 'edit.json'), `${JSON.stringify(edit, null, 2)}\n`);
if (!await exists(path.join(FIXTURE, '.git'))) {
  await run('/usr/bin/git', ['init'], FIXTURE);
  await run('/usr/bin/git', ['config', 'user.email', 'caption-split-join-fixture@localhost'], FIXTURE);
  await run('/usr/bin/git', ['config', 'user.name', 'Caption Split Join Fixture'], FIXTURE);
}
await run('/usr/bin/git', ['add', 'captions.json', 'edit.json'], FIXTURE);
const dirty = await new Promise(resolve => {
  const child = spawn('/usr/bin/git', ['diff', '--cached', '--quiet'], { cwd: FIXTURE });
  child.once('close', code => resolve(code !== 0));
});
if (dirty) await run('/usr/bin/git', ['commit', '-m', '字幕区切り結合 L1 fixture'], FIXTURE);
process.stdout.write(`${JSON.stringify({ ok: true, rows: rows.length })}\n`);
