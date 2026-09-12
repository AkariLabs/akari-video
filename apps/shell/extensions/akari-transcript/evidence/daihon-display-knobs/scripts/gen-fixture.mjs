#!/usr/bin/env node
// L1 fixture: display_policy つき object ルート captions.json、v2 edit.json、小さい mp4。
import { spawn } from 'node:child_process';
import { mkdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REPO = path.resolve(ROOT, '..', '..', '..', '..', '..', '..');
const FIXTURE_ROOT = path.join(ROOT, 'fixture');
const FIXTURE = path.join(FIXTURE_ROOT, 'project');
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
  ['きょうは', '朝から', '雨が', '降っています'],
  ['あしたの', '予定を', '決めましょう'],
  ['この機能は', '台本から', '使えます'],
  ['短い', '行です'],
  ['きょうは', '天気が', 'とても', 'よいので', '外に', '出ます']
];

function captions() {
  let cursor = 0.2;
  return LINES.map((words, index) => {
    const start = round(cursor);
    const timed = words.map((text, at) => ({
      text, start: round(start + at * 0.5), end: round(start + at * 0.5 + 0.45)
    }));
    const end = round(timed.at(-1).end + 0.05);
    cursor = end + 0.2;
    const row = {
      id: `c-${String(index + 1).padStart(4, '0')}`,
      src: 'main', start, end, text: words.join(''), speaker: null,
      sourceRef: { segment: index }, edited: index === 4, words: timed
    };
    if (index === 4) row.display_fragments = ['きょうは天気が', 'とてもよいので外に出ます'];
    return row;
  });
}

await rm(FIXTURE_ROOT, { recursive: true, force: true });
await mkdir(path.join(FIXTURE, 'assets'), { recursive: true });
const rows = captions();
const mediaSeconds = Math.ceil(rows.at(-1).end + 1);
const media = path.join(FIXTURE, 'assets', 'base.mp4');
if (!await exists(media)) {
  await run(FFMPEG, [
    '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', `color=c=#27313f:s=640x360:r=${FPS}`,
    '-t', String(mediaSeconds), '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '42',
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart', media
  ], FIXTURE);
}

const captionsRoot = {
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
  captions: rows
};
const edit = {
  version: 2,
  output: { width: 640, height: 360, fps: FPS },
  sources: [{ id: 'main', path: 'assets/base.mp4' }],
  tracks: [
    { id: 'v-main', lane: 'visual', items: [{
      id: 'main-clip', at: 0, duration: mediaSeconds * FPS,
      source: { kind: 'media', src: 'main', in: 0, out: mediaSeconds }
    }] },
    { id: 'captions', lane: 'visual', content: { from: 'captions.json' } }
  ]
};
await atomicWrite(path.join(FIXTURE, 'captions.json'), `${JSON.stringify(captionsRoot, null, 2)}\n`);
await atomicWrite(path.join(FIXTURE, 'edit.json'), `${JSON.stringify(edit, null, 2)}\n`);
await run('/usr/bin/git', ['init'], FIXTURE);
await run('/usr/bin/git', ['config', 'user.email', 'daihon-display-knobs-fixture@localhost'], FIXTURE);
await run('/usr/bin/git', ['config', 'user.name', 'Daihon Display Knobs Fixture'], FIXTURE);
await run('/usr/bin/git', ['add', 'captions.json', 'edit.json'], FIXTURE);
await run('/usr/bin/git', ['commit', '-m', '表示設定 L1 fixture'], FIXTURE);
process.stdout.write(`${JSON.stringify({
  ok: true,
  rows: rows.length,
  mediaSeconds,
  texts: rows.map(row => ({ id: row.id, text: row.text, characters: Array.from(row.text).length })),
  manualFragments: rows.at(-1).display_fragments
})}\n`);
