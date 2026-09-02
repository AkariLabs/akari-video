#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const FIXTURE = path.join(ROOT, 'fixture');
const MEDIA = path.join(FIXTURE, 'assets', 'color-480s.mp4');
const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const FPS = 30;
const ROW_COUNT = 200;
const ROW_SECONDS = 2.4;
const MEDIA_SECONDS = ROW_COUNT * ROW_SECONDS;
const CUT_START = 49 * ROW_SECONDS;
const CUT_END = 52 * ROW_SECONDS;

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
const round = value => Math.round(value * 1000) / 1000;

function timedWords(start, duration, texts) {
  return texts.map((text, index) => ({
    start: round(start + duration * index / texts.length),
    end: round(start + duration * (index + 1) / texts.length),
    text
  }));
}

await mkdir(path.join(FIXTURE, 'assets'), { recursive: true });
if (!await exists(MEDIA)) {
  await run(FFMPEG, [
    '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=#27313f:s=320x180:r=30',
    '-t', String(MEDIA_SECONDS), '-an', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '40',
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart', MEDIA
  ]);
}

const captions = Array.from({ length: ROW_COUNT }, (_, index) => {
  const rowNumber = index + 1;
  const start = round(index * ROW_SECONDS);
  const serial = String(rowNumber).padStart(4, '0');
  let duration = ROW_SECONDS;
  let text = `台本${serial}字幕`;
  let wordTexts = ['台本', serial, '字幕'];
  let style;
  if (rowNumber === 10) {
    duration = 1;
    text = `台本${'速'.repeat(26)}字幕`;
    wordTexts = ['台本', '速'.repeat(26), '字幕'];
  } else if (rowNumber === 20) {
    duration = 0.4;
    text = '短表示';
    wordTexts = ['短', '表', '示'];
  } else if (rowNumber === 40) {
    style = 'karaoke';
  }
  const end = round(start + duration);
  let words = timedWords(start, duration, wordTexts);
  if (rowNumber === 30) words = words.map((word, wordIndex) => wordIndex === 2 ? { ...word, end: round(end + 0.1) } : word);
  const caption = {
    id: `c-${serial}`, start, end, text, speaker: null, sourceRef: null, edited: false,
    ...(rowNumber === 40 ? {} : { words })
  };
  if (style) caption.style = style;
  return caption;
});

const firstFrames = Math.round(CUT_START * FPS);
const secondFrames = Math.round((MEDIA_SECONDS - CUT_END) * FPS);
const edit = {
  version: 2,
  output: { width: 320, height: 180, fps: FPS },
  sources: [{ id: 'main', path: 'assets/color-480s.mp4' }],
  tracks: [
    {
      id: 'v-main', lane: 'visual', items: [
        { id: 'clip-before-cut', at: 0, duration: firstFrames, source: { kind: 'media', src: 'main', in: 0, out: CUT_START, speed: 1 } },
        { id: 'clip-after-cut', at: firstFrames, duration: secondFrames, source: { kind: 'media', src: 'main', in: CUT_END, out: MEDIA_SECONDS, speed: 1 } }
      ]
    },
    { id: 'captions', lane: 'visual', content: { from: 'captions.json' } }
  ]
};

await atomicWrite(path.join(FIXTURE, 'captions.json'), `${JSON.stringify(captions, null, 2)}\n`);
await atomicWrite(path.join(FIXTURE, 'edit.json'), `${JSON.stringify(edit, null, 2)}\n`);

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
if (staged) await run('/usr/bin/git', ['commit', '-m', '台本選択 QC 検証 fixture']);

const generated = JSON.parse(await readFile(path.join(FIXTURE, 'captions.json'), 'utf8'));
process.stdout.write(`${JSON.stringify({
  ok: generated.length === ROW_COUNT,
  captions: generated.length,
  mediaSeconds: MEDIA_SECONDS,
  speed: 1,
  cut: [CUT_START, CUT_END],
  expectedQc: { issues: 4, rows: 4 }
})}\n`);
