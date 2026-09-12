#!/usr/bin/env node
// L1 fixture: **display_policy を持たない** object ルート captions.json（legacy 経路）、v2 edit.json、小さい mp4。
// 手置き display_fragments は fixture に入れない（L1 が UI 操作で書き込むところを観測する）。
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

// 語の長さは「前半 = 2 語 / 後半 = 2 語」で切りたいので 4 語の行を先頭に置く。
const LINES = [
  ['きょうは', '天気が', 'とても', 'よいので'],
  ['あしたの', '予定を', '決めましょう'],
  ['短い', '行です']
];

function captions() {
  let cursor = 1.0;
  return LINES.map((words, index) => {
    const start = round(cursor);
    // 語の間に 0.3 秒の隙間を置く（断片の境界が語境界であることを時刻で見分けられるように）。
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
    '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', `color=c=#27313f:s=640x360:r=${FPS}`,
    '-t', String(mediaSeconds), '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '42',
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart', media
  ], FIXTURE);
}

// display_policy を意図的に持たない = shell / Web / render-cut の legacy 経路。
const captionsRoot = { captions: rows };
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
await run('/usr/bin/git', ['config', 'user.email', 'caption-display-fragments-fixture@localhost'], FIXTURE);
await run('/usr/bin/git', ['config', 'user.name', 'Caption Display Fragments Fixture'], FIXTURE);
await run('/usr/bin/git', ['add', 'captions.json', 'edit.json'], FIXTURE);
await run('/usr/bin/git', ['commit', '-m', '手置き改行 L1 fixture（display_policy なし）'], FIXTURE);
process.stdout.write(`${JSON.stringify({
  ok: true,
  rows: rows.length,
  mediaSeconds,
  hasDisplayPolicy: Object.prototype.hasOwnProperty.call(captionsRoot, 'display_policy'),
  target: {
    id: rows[0].id,
    text: rows[0].text,
    words: rows[0].words,
    // 語 index 2（「とても」の前）で改行 → 前半 = きょうは天気が / 後半 = とてもよいので
    breakAtWordIndex: 2,
    expectedFragments: ['きょうは天気が', 'とてもよいので'],
    expectedFirstWindow: [rows[0].words[0].start, rows[0].words[1].end],
    expectedSecondWindow: [rows[0].words[2].start, rows[0].words[3].end]
  }
})}\n`);
