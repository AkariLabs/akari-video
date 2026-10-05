#!/usr/bin/env node
// 音声クリップの直接編集 L1 の fixture（ラッパー作成の検証スクリプト）。出力先はリポの外（引数 1 つ目。既定は OS の一時ディレクトリ）。
// 映像 12 秒（無音）+ 音のトラック 3 本: BGM（10 秒・フェード無し）/ ナレーション（4 秒・音量キーフレーム 2 点）/ 効果音（1.5 秒）。
// 素材は ffmpeg で作る（L1 専用。単体テストは ffmpeg に頼らない）。
import { spawnSync } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const OUT = path.resolve(process.argv[2] ?? path.join(os.tmpdir(), 'tl-audio-inline-l1', 'fixture'));
const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const FPS = 30, SECONDS = 12;
const run = (command, args, cwd) => {
    const result = spawnSync(command, args, { cwd, encoding: 'utf8' });
    if (result.status !== 0) throw new Error(`${command} failed: ${result.stderr}`);
};
const ff = (dir, args) => run(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', ...args], dir);

const dir = path.join(OUT, 'audio');
await rm(dir, { recursive: true, force: true });
for (const sub of ['assets', 'assets/audio']) await mkdir(path.join(dir, sub), { recursive: true });
ff(dir, ['-f', 'lavfi', '-i', `color=c=0x27313f:size=1280x720:rate=${FPS}:duration=${SECONDS}`,
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', 'assets/base.mp4']);
ff(dir, ['-f', 'lavfi', '-i', 'sine=frequency=220:duration=10', '-af', 'volume=0.6', '-c:a', 'pcm_s16le', 'assets/audio/bgm.wav']);
ff(dir, ['-f', 'lavfi', '-i', 'sine=frequency=440:duration=4', '-af', 'tremolo=f=3:d=0.8', '-c:a', 'pcm_s16le', 'assets/audio/narration.wav']);
ff(dir, ['-f', 'lavfi', '-i', 'sine=frequency=880:duration=1.5', '-c:a', 'pcm_s16le', 'assets/audio/bell.wav']);
const tracks = [
    { id: 'v-main', lane: 'visual', name: 'Base', items: [{
        id: 'cut-base', at: 0, duration: SECONDS * FPS, source: { kind: 'media', src: 'a', in: 0, out: SECONDS, speed: 1 }
    }] },
    { id: 'a-bgm', lane: 'audio', name: 'BGM', items: [{
        id: 'bgm-1', role: 'bgm', at: 0, duration: 10 * FPS, source: { kind: 'media', src: 'bgm', in: 0, out: 10 }
    }] },
    { id: 'a-nar', lane: 'audio', name: 'Narration', items: [{
        id: 'nar-1', role: 'narration', at: 2 * FPS, duration: 4 * FPS, source: { kind: 'media', src: 'nar', in: 0, out: 4 },
        keyframes: [{ t: 0, gain_db: 0, easing: 'linear' }, { t: 60, gain_db: -6, easing: 'linear' }]
    }] },
    { id: 'a-sfx', lane: 'audio', name: 'SFX', items: [{
        id: 'sfx-1', role: 'sfx', at: 7 * FPS, duration: 45, source: { kind: 'media', src: 'bell', in: 0, out: 1.5 }
    }] }
];
const edit = { version: 2, output: { width: 1280, height: 720, fps: FPS }, sources: [{ id: 'a', path: 'assets/base.mp4' }, { id: 'bgm', path: 'assets/audio/bgm.wav' }, { id: 'nar', path: 'assets/audio/narration.wav' }, { id: 'bell', path: 'assets/audio/bell.wav' }], tracks };
await writeFile(path.join(dir, 'edit.json'), `${JSON.stringify(edit, null, 2)}\n`);
await writeFile(path.join(dir, 'captions.json'), `${JSON.stringify({ captions: [] }, null, 2)}\n`);
run('/usr/bin/git', ['init', '-q'], dir);
run('/usr/bin/git', ['config', 'user.email', 'tai-fixture@localhost'], dir);
run('/usr/bin/git', ['config', 'user.name', 'tai fixture'], dir);
run('/usr/bin/git', ['add', '-A'], dir);
run('/usr/bin/git', ['commit', '-q', '-m', 'fixture'], dir);
console.log(JSON.stringify({ project: dir }));
