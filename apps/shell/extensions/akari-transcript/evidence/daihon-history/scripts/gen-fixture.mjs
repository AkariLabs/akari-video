#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const repo = path.resolve(root, '..', '..', '..', '..', '..', '..');
const project = path.join(root, 'fixture', 'project');
const atomic = async (file, value) => {
  const temporary = `${file}.tmp-${process.pid}`;
  await writeFile(temporary, value); await rename(temporary, file);
};
await rm(path.join(root, 'fixture'), { recursive: true, force: true });
await mkdir(path.join(project, 'assets'), { recursive: true });
const ffmpeg = process.env.FFMPEG || path.join(repo, 'packages', 'media-bin', 'vendor', 'darwin-arm64', 'ffmpeg');
const media = path.join(project, 'assets', 'base.mp4');
await new Promise((resolve, reject) => {
  const child = spawn(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=#27313f:s=640x360:r=30', '-t', '6', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '42', '-pix_fmt', 'yuv420p', media]);
  child.once('error', reject); child.once('close', code => code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`)));
});
const captions = {
  display_policy: { mode: 'single_line_sequential', algorithm: 'a4-ja-two-fragment-v1', unit_metric: 'ascii-half-other-one-v1', max_line_units: 18, minimum_fragment_duration_seconds: 0.72, locale: 'ja', lines: 1, wrap: 'multi' },
  captions: [
    { id: 'c-0001', src: 'main', start: 0, end: 3, text: '最初のテスト行です', speaker: null, sourceRef: { segment: 0 }, edited: false, words: [
      { text: '最初の', start: 0, end: 0.8 }, { text: 'テスト', start: 0.8, end: 1.6 }, { text: '行です', start: 1.6, end: 3 }
    ] },
    { id: 'c-0002', src: 'main', start: 3, end: 6, text: '二番目の行を残します', speaker: null, sourceRef: { segment: 1 }, edited: false, words: [
      { text: '二番目の', start: 3, end: 4 }, { text: '行を', start: 4, end: 5 }, { text: '残します', start: 5, end: 6 }
    ] }
  ]
};
const edit = { version: 2, output: { width: 640, height: 360, fps: 30 }, sources: [{ id: 'main', path: 'assets/base.mp4' }], tracks: [
  { id: 'v-main', lane: 'visual', items: [{ id: 'clip', at: 0, duration: 180, source: { kind: 'media', src: 'main', in: 0, out: 6 } }] },
  { id: 'captions', lane: 'visual', content: { from: 'captions.json' } }
] };
await atomic(path.join(project, 'captions.json'), `${JSON.stringify(captions, null, 2)}\n`);
await atomic(path.join(project, 'edit.json'), `${JSON.stringify(edit, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ ok: true, rows: 2 })}\n`);
