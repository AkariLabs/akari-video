#!/usr/bin/env node
// caption-plate-drag-clamp L1 の固定素材を決定論で作り直す（検証用・ラッパー作成）。
// 生成物: fixture/captions.json（5 行・words 付き・object ルート + default_text_style.zone）
//         fixture/edit.json（v2 / 1280x720 / src 1 本 / speed 1 / cuts 無し）
//         fixture/assets/base-10s.mp4（ffmpeg color の 10 秒・.gitignore 済み）
// Usage: node gen-fixture.mjs [fixtureDir]
import { spawnSync } from 'node:child_process';
import { mkdir, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = process.argv[2] ? path.resolve(process.argv[2]) : path.join(path.dirname(here), 'fixture');
const ffmpeg = process.env.AKARI_FFMPEG || 'ffmpeg';

const words = (text, start, end) => {
  const tokens = [...text];
  const step = (end - start) / tokens.length;
  return tokens.map((token, index) => ({
    start: Number((start + step * index).toFixed(3)),
    end: Number((start + step * (index + 1)).toFixed(3)),
    text: token
  }));
};
const cue = (id, start, end, text) => ({
  id, start, end, text, speaker: null, sourceRef: null, edited: false, src: 'a',
  words: words(text, start, end)
});

const captions = {
  default_text_style: { zone: 'bottom' },
  captions: [
    cue('c-0001', 0.5, 2.0, '一行目の字幕'),
    cue('c-0002', 2.5, 4.0, '二行目だけを動かす'),
    cue('c-0003', 4.5, 6.0, '三行目の字幕'),
    cue('c-0004', 6.5, 8.0, '四行目の字幕'),
    cue('c-0005', 8.5, 9.8, '五行目の字幕')
  ]
};

const edit = {
  version: 2,
  output: { width: 1280, height: 720, fps: 30 },
  sources: [{ id: 'a', path: 'assets/base-10s.mp4' }],
  tracks: [
    {
      id: 'v-main', lane: 'visual', name: 'Base',
      items: [{ id: 'cut-base', at: 0, duration: 300, source: { kind: 'media', src: 'a', in: 0, out: 10, speed: 1 } }]
    },
    {
      id: 'v-captions', lane: 'visual', name: '字幕',
      items: [{ id: 'captions', name: '字幕', at: 0, duration: 300, source: { kind: 'captions', path: 'captions.json' }, items: [] }]
    }
  ]
};

await mkdir(path.join(fixture, 'assets'), { recursive: true });
await writeFile(path.join(fixture, 'captions.json'), `${JSON.stringify(captions, null, 2)}\n`);
await writeFile(path.join(fixture, 'edit.json'), `${JSON.stringify(edit, null, 2)}\n`);

const media = path.join(fixture, 'assets', 'base-10s.mp4');
let mediaReused = true;
try { await stat(media); } catch {
  mediaReused = false;
  const made = spawnSync(ffmpeg, [
    '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
    '-f', 'lavfi', '-i', 'color=c=0x1e2530:size=1280x720:rate=30:duration=10',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', media
  ], { encoding: 'utf8' });
  if (made.status !== 0) throw new Error(made.stderr || `ffmpeg exited ${made.status}`);
}
process.stdout.write(`${JSON.stringify({ status: 'ok', cues: captions.captions.length, mediaReused })}\n`);
