#!/usr/bin/env node
// L1 fixture（ラッパーが検証用に用意する素材）: 語つき captions.json 3 行 + v2 edit.json + 小さい mp4。
// 手順 1〜4（ハンドル）は display_policy 無し（プレーン字幕 host = shrink-to-fit の小さい箱）で観測し、
// 手順 5（display_lines で 2 行）は L1 スクリプトが実行中に display_policy を書き足して観測する。
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

// 2 行へ折るのに十分な長さ（手順 5 で display_policy.max_line_units=6 / lines=2 / wrap=fold）。
const LINES = [
  ['きょうは', 'とても', 'よい', '天気です'],
  ['あしたの', '予定を', '決めましょう'],
  ['みじかい', '行です']
];

function captions() {
  let cursor = 1.0;
  return LINES.map((words, index) => {
    const start = round(cursor);
    const timed = words.map((text, at) => ({
      text, start: round(start + at * 0.6), end: round(start + at * 0.6 + 0.3)
    }));
    const end = round(timed.at(-1).end + 0.1);
    cursor = end + 0.4;
    return {
      id: `c-${String(index + 1).padStart(4, '0')}`,
      src: 'main', start, end, text: words.join(''), speaker: null,
      sourceRef: { segment: index }, edited: false, words: timed
    };
  });
}

await rm(FIXTURE_ROOT, { recursive: true, force: true });
await mkdir(path.join(FIXTURE, 'assets'), { recursive: true });
const rows = captions();
const mediaSeconds = Math.ceil(rows.at(-1).end + 1);
const media = path.join(FIXTURE, 'assets', 'base.mp4');
if (!await exists(media)) {
  await run(FFMPEG, [
    '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', `color=c=#27313f:s=1280x720:r=${FPS}`,
    '-t', String(mediaSeconds), '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '42',
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart', media
  ], FIXTURE);
}

// 既定の下段（bottom 7%）だと、回転で広がった外接矩形の下辺が #preview-stage の
// overflow:hidden で切られ、下側のハンドルが当たり判定から外れる。観測のため中央へ置く。
const captionsRoot = { default_text_style: { zone: 'center' }, captions: rows };
const edit = {
  version: 2,
  output: { width: 1280, height: 720, fps: FPS },
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
await run('/usr/bin/git', ['config', 'user.email', 'caption-plate-handles-fixture@localhost'], FIXTURE);
await run('/usr/bin/git', ['config', 'user.name', 'Caption Plate Handles Fixture'], FIXTURE);
await run('/usr/bin/git', ['add', 'captions.json', 'edit.json'], FIXTURE);
await run('/usr/bin/git', ['commit', '-m', '字幕プレートのハンドル L1 fixture'], FIXTURE);
process.stdout.write(`${JSON.stringify({
  ok: true,
  rows: rows.length,
  mediaSeconds,
  captions: rows.map(row => ({ id: row.id, text: row.text, start: row.start, end: row.end }))
})}\n`);
