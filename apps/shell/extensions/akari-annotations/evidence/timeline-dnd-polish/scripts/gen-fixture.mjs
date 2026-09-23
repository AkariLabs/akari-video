#!/usr/bin/env node
// タイムライン D&D の磨き残し L1 の fixture（ラッパー作成の検証スクリプト）。出力先はリポの外（引数 1 つ目。既定は OS の一時ディレクトリ）。
// place-text-button/scripts/gen-fixture.mjs の spoken（話した言葉 4 行・source 域・12 秒）に、空の音のトラック a1 と
// プロジェクト面から掴む素材（効果音 wav・画像 png・動画 mp4）を足したもの。素材は ffmpeg で作る（L1 専用）。
import { spawnSync } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const OUT = path.resolve(process.argv[2] ?? path.join(os.tmpdir(), 'timeline-dnd-polish-l1', 'fixture'));
const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const FPS = 30, SECONDS = 12;
const run = (command, args, cwd) => {
    const result = spawnSync(command, args, { cwd, encoding: 'utf8' });
    if (result.status !== 0) throw new Error(`${command} failed: ${result.stderr}`);
};
const ff = (dir, args) => run(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', ...args], dir);
const SPOKEN = ['今日は朝のルーティンを紹介します', 'まずはコーヒーを淹れるところから', '豆は挽きたてが一番おいしい', 'お湯は少し冷ましてから注ぎます'];

const dir = path.join(OUT, 'spoken');
await rm(dir, { recursive: true, force: true });
for (const sub of ['assets', 'assets/audio', 'assets/images', 'assets/video']) await mkdir(path.join(dir, sub), { recursive: true });
ff(dir, ['-f', 'lavfi', '-i', `color=c=0x27313f:size=1280x720:rate=${FPS}:duration=${SECONDS}`,
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', 'assets/base.mp4']);
ff(dir, ['-f', 'lavfi', '-i', `testsrc=size=640x360:rate=${FPS}:duration=4`,
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', 'assets/video/raw-clip.mp4']);
ff(dir, ['-f', 'lavfi', '-i', 'sine=frequency=880:duration=1.5', '-c:a', 'pcm_s16le', 'assets/audio/bell-tree.wav']);
ff(dir, ['-f', 'lavfi', '-i', 'color=c=0x6a4c93:size=640x360', '-frames:v', '1', 'assets/images/still.png']);
const tracks = [
    { id: 'v-main', lane: 'visual', name: 'Base', items: [{
        id: 'cut-base', at: 0, duration: SECONDS * FPS, source: { kind: 'media', src: 'a', in: 0, out: SECONDS, speed: 1 }
    }] },
    { id: 'v-captions', lane: 'visual', name: '字幕', items: [{
        id: 'captions', name: '字幕', at: 0, duration: SECONDS * FPS, source: { kind: 'captions', path: 'captions.json' }, items: []
    }] },
    { id: 'a1', lane: 'audio', items: [] }
];
const captions = { default_text_style: { zone: 'bottom' }, captions: SPOKEN.map((text, index) => ({
    id: `c-000${index + 1}`, start: index * 3, end: index * 3 + 2.5, text, speaker: null, sourceRef: null, edited: false, src: 'a'
})) };
await writeFile(path.join(dir, 'captions.json'), `${JSON.stringify(captions, null, 2)}\n`);
const edit = { version: 2, output: { width: 1280, height: 720, fps: FPS }, sources: [{ id: 'a', path: 'assets/base.mp4' }], tracks };
await writeFile(path.join(dir, 'edit.json'), `${JSON.stringify(edit, null, 2)}\n`);
run('/usr/bin/git', ['init', '-q'], dir);
run('/usr/bin/git', ['config', 'user.email', 'tdp-fixture@localhost'], dir);
run('/usr/bin/git', ['config', 'user.name', 'tdp fixture'], dir);
run('/usr/bin/git', ['add', '-A'], dir);
run('/usr/bin/git', ['commit', '-q', '-m', 'fixture'], dir);
console.log(JSON.stringify({ spoken: dir }));
