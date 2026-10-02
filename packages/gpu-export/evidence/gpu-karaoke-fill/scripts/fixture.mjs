#!/usr/bin/env node
// GPU 書き出しのカラオケ塗り指定（karaoke.fill / start_index / done_color）を OSR と比べる L1 の fixture（ラッパー作成の検証用素材）。
// 使い方: node fixture.mjs <出力先ディレクトリ>   → <出力先>/project を作る
// 字幕 1 本 = 3 秒・4 秒刻み（重ならない）。どの字幕も同じ語の並び・同じ相対時刻で、塗り指定だけを変える。
// 映像は ffmpeg で作る単色（L1 専用）。
import { spawnSync } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const FFMPEG = process.env.FFMPEG || 'ffmpeg';
export const FPS = 30;
export const STEP = 4;
export const CUE_SECONDS = 3;
export const W = 1280;
export const H = 720;

// 語（字幕内の相対秒）。複数文字の語を含める（char と word と smooth で塗りの単位が変わるように）。
export const WORDS = [
  ['今日は', 0.2, 1.1],
  ['とても', 1.1, 1.7],
  ['いい', 1.7, 2.1],
  ['天気', 2.1, 2.8],
];
export const TEXT = WORDS.map(([text]) => text).join('');

// [id, karaoke 指定, 説明]
export const ROWS = [
  ['c-0001', { fill: 'char', done_color: '#FB923C' }, 'char + done_color'],
  ['c-0002', { fill: 'word', start_index: 2 }, 'word + start_index 2'],
  ['c-0003', { fill: 'smooth', done_color: '#22C55E', start_index: 1 }, 'smooth + done_color + start_index 1'],
  ['c-0004', { start_index: 4 }, 'fill なし（従来の語ごとの線形）+ start_index 4'],
  ['c-0005', { fill: 'smooth', done_color: '#FB923C' }, 'smooth + done_color（お手本と同じ指定）'],
  ['c-0006', { fill: 'char', start_index: 5, done_color: '#38BDF8' }, 'char + start_index 5（語の途中）+ done_color'],
];
export const SECONDS = ROWS.length * STEP;
const round = (value) => Math.round(value * 1000) / 1000;

export function buildCaptions() {
  return {
    captions: ROWS.map(([id, karaoke], index) => {
      const start = index * STEP;
      return {
        id, start, end: start + CUE_SECONDS, text: TEXT, speaker: null, sourceRef: null, edited: false,
        style: 'karaoke',
        words: WORDS.map(([text, s, e]) => ({ text, start: round(start + s), end: round(start + e) })),
        text_style: { karaoke },
      };
    }),
  };
}

export async function writeFixture(outDir) {
  const dir = path.join(path.resolve(outDir), 'project');
  const run = (command, args, cwd) => {
    const result = spawnSync(command, args, { cwd, encoding: 'utf8' });
    if (result.status !== 0) throw new Error(`${command} failed: ${result.stderr}`);
  };
  await rm(dir, { recursive: true, force: true });
  await mkdir(path.join(dir, 'assets'), { recursive: true });
  run(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
    '-f', 'lavfi', '-i', `color=c=0x27313f:size=${W}x${H}:rate=${FPS}:duration=${SECONDS}`,
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', path.join(dir, 'assets', 'base.mp4')], dir);
  await writeFile(path.join(dir, 'captions.json'), `${JSON.stringify(buildCaptions(), null, 2)}\n`);
  const edit = {
    version: 2, output: { width: W, height: H, fps: FPS }, sources: [{ id: 'a', path: 'assets/base.mp4' }],
    tracks: [
      { id: 'v-main', lane: 'visual', name: 'Base', items: [{ id: 'cut-base', at: 0, duration: SECONDS * FPS, source: { kind: 'media', src: 'a', in: 0, out: SECONDS, speed: 1 } }] },
      { id: 'v-captions', lane: 'visual', name: '字幕', items: [{ id: 'captions', name: '字幕', at: 0, duration: SECONDS * FPS, source: { kind: 'captions', path: 'captions.json' }, items: [] }] },
    ],
  };
  await writeFile(path.join(dir, 'edit.json'), `${JSON.stringify(edit, null, 2)}\n`);
  run('git', ['init', '-q'], dir);
  run('git', ['-c', 'user.email=gkf-fixture@localhost', '-c', 'user.name=gkf fixture', 'add', '-A'], dir);
  run('git', ['-c', 'user.email=gkf-fixture@localhost', '-c', 'user.name=gkf fixture', 'commit', '-q', '-m', 'fixture'], dir);
  return dir;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = await writeFixture(process.argv[2] ?? path.join(HERE, '..', 'work', 'fixture'));
  console.log(JSON.stringify({ project: dir, rows: ROWS.length, seconds: SECONDS }));
}
