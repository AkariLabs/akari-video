#!/usr/bin/env node
// タイムラインの縦幅・ズームバー L1 の fixture（ラッパー作成の検証スクリプト）。出力先はリポの外（引数 1 つ目。既定は OS の一時ディレクトリ）。
// 12 秒のベース映像（Base）+ 2 本目の映像トラック（4 秒の素材を 2 秒目に 1 本）+ 字幕 + 音のトラック（効果音 3 秒を 1 秒目に 1 本）。
// 素材は ffmpeg で作る（L1 専用。単体テストはこの fixture を使わない）。
import { spawnSync } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const OUT = path.resolve(process.argv[2] ?? path.join(os.tmpdir(), 'tl-chrome-zoom-l1', 'fixture'));
const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const FPS = 30, SECONDS = 12;
const run = (command, args, cwd) => {
    const result = spawnSync(command, args, { cwd, encoding: 'utf8' });
    if (result.status !== 0) throw new Error(`${command} failed: ${result.stderr}`);
};
const ff = (dir, args) => run(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', ...args], dir);
const SPOKEN = ['今日は朝のルーティンを紹介します', 'まずはコーヒーを淹れるところから', '豆は挽きたてが一番おいしい', 'お湯は少し冷ましてから注ぎます'];

const dir = path.join(OUT, 'project');
await rm(dir, { recursive: true, force: true });
for (const sub of ['assets', 'assets/audio', 'assets/images', 'assets/video']) await mkdir(path.join(dir, sub), { recursive: true });
ff(dir, ['-f', 'lavfi', '-i', `color=c=0x27313f:size=1280x720:rate=${FPS}:duration=${SECONDS}`,
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', 'assets/base.mp4']);
ff(dir, ['-f', 'lavfi', '-i', `testsrc=size=640x360:rate=${FPS}:duration=4`,
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', 'assets/video/raw-clip.mp4']);
ff(dir, ['-f', 'lavfi', '-i', 'sine=frequency=660:duration=3', '-c:a', 'pcm_s16le', 'assets/audio/bell.wav']);
ff(dir, ['-f', 'lavfi', '-i', 'sine=frequency=880:duration=1.5', '-c:a', 'pcm_s16le', 'assets/audio/bell-short.wav']);
ff(dir, ['-f', 'lavfi', '-i', 'color=c=0x6a4c93:size=640x360', '-frames:v', '1', 'assets/images/still.png']);
const tracks = [
    { id: 'v-main', lane: 'visual', name: 'Base', items: [{
        id: 'cut-base', at: 0, duration: SECONDS * FPS, source: { kind: 'media', src: 'a', in: 0, out: SECONDS, speed: 1 }
    }] },
    { id: 'v2', lane: 'visual', name: 'V2', items: [{
        id: 'clip-b', at: 2 * FPS, duration: 4 * FPS, source: { kind: 'media', src: 'b', in: 0, out: 4, speed: 1 }
    }] },
    { id: 'v-captions', lane: 'visual', name: '字幕', items: [{
        id: 'captions', name: '字幕', at: 0, duration: SECONDS * FPS, source: { kind: 'captions', path: 'captions.json' }, items: []
    }] },
    { id: 'a1', lane: 'audio', items: [{
        id: 'bell-1', at: FPS, duration: 3 * FPS, source: { kind: 'media', src: 'bell', in: 0, out: 3 }
    }] }
];
const captions = { default_text_style: { zone: 'bottom' }, captions: SPOKEN.map((text, index) => ({
    id: `c-000${index + 1}`, start: index * 3, end: index * 3 + 2.5, text, speaker: null, sourceRef: null, edited: false, src: 'a'
})) };
await writeFile(path.join(dir, 'captions.json'), `${JSON.stringify(captions, null, 2)}\n`);
const edit = {
    version: 2, output: { width: 1280, height: 720, fps: FPS },
    sources: [{ id: 'a', path: 'assets/base.mp4' }, { id: 'b', path: 'assets/video/raw-clip.mp4' }, { id: 'bell', path: 'assets/audio/bell.wav' }],
    tracks
};
await writeFile(path.join(dir, 'edit.json'), `${JSON.stringify(edit, null, 2)}\n`);
run('/usr/bin/git', ['init', '-q'], dir);
run('/usr/bin/git', ['config', 'user.email', 'tcz-fixture@localhost'], dir);
run('/usr/bin/git', ['config', 'user.name', 'tcz fixture'], dir);
run('/usr/bin/git', ['add', '-A'], dir);
run('/usr/bin/git', ['commit', '-q', '-m', 'fixture'], dir);
console.log(JSON.stringify({ project: dir }));
