#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const FIXTURE = path.join(ROOT, 'fixture');
const EMPTY = path.join(ROOT, 'empty-workspace');
const MEDIA = path.join(FIXTURE, 'assets', 'color-30s.mp4');
const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const FPS = 30;
const ROW_SECONDS = 0.06;
const SPEED = 0.1;
const CUT_START = 5.94;
const CUT_END = 6.6;

const exists = async file => { try { await stat(file); return true; } catch { return false; } };
const atomicWrite = async (file, value) => {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}`;
  await writeFile(temporary, value);
  await rename(temporary, file);
};
const run = (command, args, cwd = FIXTURE) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });
  child.once('error', reject);
  child.once('close', code => code === 0 ? resolve() : reject(new Error(`${command} failed (${code}): ${stderr.slice(-1200)}`)));
});

await mkdir(path.join(FIXTURE, 'assets'), { recursive: true });
await mkdir(EMPTY, { recursive: true });
if (!await exists(MEDIA)) {
  await run(FFMPEG, [
    '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=#27313f:s=640x360:r=30',
    '-t', '30', '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', MEDIA
  ]);
}

const round = value => Math.round(value * 1000) / 1000;
const captions = Array.from({ length: 500 }, (_, index) => {
  const start = round(index * ROW_SECONDS);
  const end = round(start + ROW_SECONDS);
  const serial = String(index + 1).padStart(4, '0');
  const text = `台本${serial}字幕`;
  return {
    id: `c-${serial}`, start, end, text, speaker: null, sourceRef: null, edited: false,
    words: [
      { start, end: round(start + ROW_SECONDS / 3), text: '台本' },
      { start: round(start + ROW_SECONDS / 3), end: round(start + ROW_SECONDS * 2 / 3), text: serial },
      { start: round(start + ROW_SECONDS * 2 / 3), end, text: '字幕' }
    ],
    display_fragments: [`台本${serial}`, '字幕']
  };
});

const firstOutputSeconds = CUT_START / SPEED;
const secondOutputSeconds = (30 - CUT_END) / SPEED;
const edit = {
  version: 2,
  output: { width: 640, height: 360, fps: FPS },
  sources: [{ id: 'main', path: 'assets/color-30s.mp4' }],
  tracks: [
    {
      id: 'v-main', lane: 'visual', items: [
        { id: 'clip-before-cut', at: 0, duration: Math.round(firstOutputSeconds * FPS), source: { kind: 'media', src: 'main', in: 0, out: CUT_START, speed: SPEED } },
        { id: 'clip-after-cut', at: Math.round(firstOutputSeconds * FPS), duration: Math.round(secondOutputSeconds * FPS), source: { kind: 'media', src: 'main', in: CUT_END, out: 30, speed: SPEED } }
      ]
    },
    { id: 'captions', lane: 'visual', content: { from: 'captions.json' } }
  ]
};

await atomicWrite(path.join(FIXTURE, 'captions.json'), `${JSON.stringify(captions, null, 2)}\n`);
await atomicWrite(path.join(FIXTURE, 'edit.json'), `${JSON.stringify(edit, null, 2)}\n`);
await atomicWrite(path.join(EMPTY, 'README.txt'), 'empty project fixture\n');

if (!await exists(path.join(FIXTURE, '.git'))) {
  await run('/usr/bin/git', ['init']);
  await run('/usr/bin/git', ['config', 'user.email', 'daihon-fixture@localhost']);
  await run('/usr/bin/git', ['config', 'user.name', 'Daihon Fixture']);
}
await run('/usr/bin/git', ['add', 'captions.json', 'edit.json']);
const staged = await new Promise(resolve => {
  const child = spawn('/usr/bin/git', ['diff', '--cached', '--quiet'], { cwd: FIXTURE });
  child.once('close', code => resolve(code !== 0));
});
if (staged) await run('/usr/bin/git', ['commit', '-m', '台本パネル検証 fixture']);

const generated = JSON.parse(await readFile(path.join(FIXTURE, 'captions.json'), 'utf8'));
process.stdout.write(`${JSON.stringify({ ok: generated.length === 500, captions: generated.length, mediaSeconds: 30, cut: [CUT_START, CUT_END] })}\n`);
