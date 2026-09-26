#!/usr/bin/env node
// 「選択文字を大きく」の L1 fixture（ラッパー作成の検証用素材）。出力先はリポの外（引数 1 つ目。既定は OS の一時ディレクトリ）。
// 4 秒刻みの 5 本（出力 1280×720・20 秒）:
//   c-0001 話した言葉「今日はいい天気」（(a) 「いい」を大きく）
//   c-0002 話した言葉 "Hello World"（(c) 「llo」を大きく）
//   c-0101 置いた文字「今日はいい天気」折り返し幅なし（(b) 既定の置き方 = text_anchor tc・position.y のみ）
//   c-0102 置いた文字「今日はいい天気」折り返し幅 30%（(b) wrap_width_pct）
//   c-0005 話した言葉「今日はいい天気」字幕全体を 1.5 倍（(d) text_style.scale = 角のつまみの保存値）
// 映像は ffmpeg で作る（L1 専用。単体テストは使わない）。
import { spawnSync } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const OUT = path.resolve(process.argv[2] ?? path.join(os.tmpdir(), 'caption-run-size-l1', 'fixture'));
const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const FPS = 30, SECONDS = 20;
const run = (command, args, cwd) => {
    const result = spawnSync(command, args, { cwd, encoding: 'utf8' });
    if (result.status !== 0) throw new Error(`${command} failed: ${result.stderr}`);
};

const dir = path.join(OUT, 'project');
await rm(OUT, { recursive: true, force: true });
await mkdir(path.join(dir, 'assets'), { recursive: true });
run(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
    '-f', 'lavfi', '-i', `color=c=0x27313f:size=1280x720:rate=${FPS}:duration=${SECONDS}`,
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', path.join(dir, 'assets', 'base.mp4')], dir);
const at = index => ({ start: index * 4, end: Math.round((index * 4 + 3.6) * 1000) / 1000 });
const spoken = (id, index, text, extra = {}) => ({ id, ...at(index), text, speaker: null, sourceRef: { segment: index }, edited: false, ...extra });
const placed = (id, index, text, style) => ({ id, ...at(index), text, time_domain: 'output', sourceRef: null, edited: true, speaker: null, text_style: style });
const captions = {
    default_text_style: { zone: 'bottom' },
    captions: [
        spoken('c-0001', 0, '今日はいい天気'),
        spoken('c-0002', 1, 'Hello World'),
        placed('c-0101', 2, '今日はいい天気', { text_anchor: 'tc', position: { y: 0.4625 } }),
        placed('c-0102', 3, '今日はいい天気', { text_anchor: 'tc', position: { y: 0.4625 }, wrap_width_pct: 30 }),
        spoken('c-0005', 4, '今日はいい天気', { text_style: { scale: 1.5 } })
    ]
};
await writeFile(path.join(dir, 'captions.json'), `${JSON.stringify(captions, null, 2)}\n`);
const edit = {
    version: 2, output: { width: 1280, height: 720, fps: FPS }, sources: [{ id: 'a', path: 'assets/base.mp4' }],
    tracks: [
        { id: 'v-main', lane: 'visual', name: 'Base', items: [{ id: 'cut-base', at: 0, duration: SECONDS * FPS, source: { kind: 'media', src: 'a', in: 0, out: SECONDS, speed: 1 } }] },
        { id: 'v-captions', lane: 'visual', name: '字幕', items: [{ id: 'captions', name: '字幕', at: 0, duration: SECONDS * FPS, source: { kind: 'captions', path: 'captions.json' }, items: [] }] }
    ]
};
await writeFile(path.join(dir, 'edit.json'), `${JSON.stringify(edit, null, 2)}\n`);
run('/usr/bin/git', ['init', '-q'], dir);
run('/usr/bin/git', ['config', 'user.email', 'run-size-fixture@localhost'], dir);
run('/usr/bin/git', ['config', 'user.name', 'run size fixture'], dir);
run('/usr/bin/git', ['add', '-A'], dir);
run('/usr/bin/git', ['commit', '-q', '-m', 'fixture'], dir);
await mkdir(path.join(OUT, 'library'), { recursive: true });
console.log(JSON.stringify({ project: dir, rows: captions.captions.length }));
