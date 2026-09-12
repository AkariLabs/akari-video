#!/usr/bin/env node
// L1 fixture: 配列ルートの captions.json（= emphasis_words の席が無い形）+ v2 edit.json。
// setEmphasisWords の「object ルートへ包む」経路と display_fragments の外科編集を実機で通すため。
import { spawn } from 'node:child_process';
import { mkdir, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REPO = path.resolve(ROOT, '..', '..', '..', '..', '..', '..');
const FIXTURE = path.join(ROOT, 'fixture', 'project');
const FFMPEG = process.env.FFMPEG || path.join(REPO, 'packages/media-bin/vendor/darwin-arm64/ffmpeg');
const FPS = 30;
const exists = async file => { try { await stat(file); return true; } catch { return false; } };
const round = value => Math.round(value * 1000) / 1000;
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

const LINES = [
  ['ネオンとか', 'グリッチとか', 'そういう', '強調の', '単語だけ'],
  ['横に', 'ドラッグして', '選んで', 'テンプレを', '当てたい'],
  ['単語の', '右クリックで', 'メニューが', '出る'],
  ['語と', '語の', '間に', '⊕', 'が出る'],
  ['これで', '全部', '決まった']
];

function captions() {
  let cursor = 1.0;
  return LINES.map((words, index) => {
    const serial = String(index + 1).padStart(4, '0');
    const start = round(cursor);
    const timed = words.map((text, at) => ({
      text, start: round(start + at * 0.5), end: round(start + at * 0.5 + 0.45)
    }));
    const end = round(timed.at(-1).end + 0.1);
    cursor = end + 0.6;
    return {
      id: `c-${serial}`, start, end, text: words.join(''), speaker: null,
      sourceRef: { segment: index }, edited: false, words: timed
    };
  });
}

const rows = captions();
const mediaSeconds = Math.ceil(rows.at(-1).end + 1);
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
  sources: [{ id: 'main', path: 'assets/base.mp4' }],
  tracks: [
    { id: 'v-main', lane: 'visual', items: [{
      id: 'main-clip', at: 0, duration: mediaSeconds * FPS,
      source: { kind: 'media', src: 'main', in: 0, out: mediaSeconds }
    }] },
    { id: 'captions', lane: 'visual', content: { from: 'captions.json' } }
  ]
};
await atomicWrite(path.join(FIXTURE, 'captions.json'), `${JSON.stringify(rows, null, 2)}\n`);
await atomicWrite(path.join(FIXTURE, 'edit.json'), `${JSON.stringify(edit, null, 2)}\n`);
if (!await exists(path.join(FIXTURE, '.git'))) {
  await run('/usr/bin/git', ['init'], FIXTURE);
  await run('/usr/bin/git', ['config', 'user.email', 'daihon-word-select-fixture@localhost'], FIXTURE);
  await run('/usr/bin/git', ['config', 'user.name', 'Daihon Word Select Fixture'], FIXTURE);
}
await run('/usr/bin/git', ['add', 'captions.json', 'edit.json'], FIXTURE);
const dirty = await new Promise(resolve => {
  const child = spawn('/usr/bin/git', ['diff', '--cached', '--quiet'], { cwd: FIXTURE });
  child.once('close', code => resolve(code !== 0));
});
if (dirty) await run('/usr/bin/git', ['commit', '-m', '単語選択 L1 fixture'], FIXTURE);
process.stdout.write(`${JSON.stringify({ ok: true, rows: rows.length, words: rows.map(row => row.words.length) })}\n`);
