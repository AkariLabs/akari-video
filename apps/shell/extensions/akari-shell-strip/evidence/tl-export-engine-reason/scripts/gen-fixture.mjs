#!/usr/bin/env node
// 書き出しのエンジン理由 L1 の fixture。出力先はリポの外（引数 1 つ目。既定は OS の一時ディレクトリ）。
// osr  = 字幕 4 行のうち 2 行が登場「glitch」、1 行が縁取り（内側）→ GPU 不適格で OSR
// gpu  = 動きも装飾も無い字幕 4 行 → GPU で書き出せる
// lint = 映像の参照先ファイルが無い（edit-lint が error）→ 書き出せない
// 映像は ffmpeg で作る（L1 専用。単体テストは使わない）。
import { spawnSync } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const OUT = path.resolve(process.argv[2] ?? path.join(os.tmpdir(), 'tl-export-engine-reason', 'fixture'));
const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const FPS = 30, SECONDS = 6;
const run = (command, args, cwd) => {
    const result = spawnSync(command, args, { cwd, encoding: 'utf8' });
    if (result.status !== 0) throw new Error(`${command} failed: ${result.stderr}`);
};
const SPOKEN = ['今日は朝のルーティンを紹介します', 'まずはコーヒーを淹れるところから', '豆は挽きたてが一番おいしい', 'お湯は少し冷ましてから注ぎます'];
const STYLE = {
    osr: [
        { animation: { in: { id: 'glitch' } } },
        { animation: { in: { id: 'glitch' } } },
        { stroke_inner: { color: '#ffffff', width_px: 3 } },
        null
    ],
    gpu: [null, null, null, null],
    lint: [null, null, null, null]
};

async function project(name) {
    const dir = path.join(OUT, name);
    await rm(dir, { recursive: true, force: true });
    await mkdir(path.join(dir, 'assets'), { recursive: true });
    await mkdir(path.join(dir, 'exports'), { recursive: true });
    run(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
        '-f', 'lavfi', '-i', `color=c=0x27313f:size=1280x720:rate=${FPS}:duration=${SECONDS}`,
        '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', path.join(dir, 'assets', 'base.mp4')], dir);
    const src = name === 'lint' ? 'assets/missing.mp4' : 'assets/base.mp4';
    const tracks = [
        { id: 'v-main', lane: 'visual', name: 'Base', items: [{
            id: 'cut-base', at: 0, duration: SECONDS * FPS, source: { kind: 'media', src: 'a', in: 0, out: SECONDS, speed: 1 }
        }] },
        { id: 'v-captions', lane: 'visual', name: '字幕', items: [{
            id: 'captions', name: '字幕', at: 0, duration: SECONDS * FPS, source: { kind: 'captions', path: 'captions.json' }, items: []
        }] }
    ];
    const captions = { default_text_style: { zone: 'bottom' }, captions: SPOKEN.map((text, index) => {
        const cue = { id: `c-000${index + 1}`, start: index * 1.5, end: index * 1.5 + 1.3, text, speaker: null, sourceRef: null, edited: false, src: 'a' };
        const style = STYLE[name][index];
        return style ? { ...cue, text_style: style } : cue;
    }) };
    await writeFile(path.join(dir, 'captions.json'), `${JSON.stringify(captions, null, 2)}\n`);
    const edit = { version: 2, output: { width: 1280, height: 720, fps: FPS }, sources: [{ id: 'a', path: src }], tracks };
    await writeFile(path.join(dir, 'edit.json'), `${JSON.stringify(edit, null, 2)}\n`);
    await writeFile(path.join(dir, 'exports', '.gitkeep'), '');
    run('/usr/bin/git', ['init', '-q'], dir);
    run('/usr/bin/git', ['config', 'user.email', 'tl-export-engine-reason@localhost'], dir);
    run('/usr/bin/git', ['config', 'user.name', 'export engine reason fixture'], dir);
    run('/usr/bin/git', ['add', '-A'], dir);
    run('/usr/bin/git', ['commit', '-q', '-m', 'fixture'], dir);
    return dir;
}
console.log(JSON.stringify({ osr: await project('osr'), gpu: await project('gpu'), lint: await project('lint') }));
