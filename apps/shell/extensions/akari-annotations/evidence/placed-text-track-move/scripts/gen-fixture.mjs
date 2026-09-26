#!/usr/bin/env node
// 置いた文字をトラック間で移す L1 の fixture（ラッパー作成の検証スクリプト）。出力先はリポの外（引数 1 つ目。既定は OS の一時ディレクトリ）。
// 12 秒・1280×720。段は下から Base（暗い単色の映像）/ 写真（明るい黄色の写真・中央・幅 0.5）/ 字幕（話した言葉 4 行の袋）/ A1（空の音）。
// 置いた文字は launch 後に akari.caption.placeText で置く（time_domain: "output"）。(c) 用の手書きの形は make-hand.mjs が作る。
// 素材は ffmpeg で作る（L1 専用。単体テストは使わない）。
import { spawnSync } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const OUT = path.resolve(process.argv[2] ?? path.join(os.tmpdir(), 'placed-text-track-move-l1', 'fixture'));
const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const FPS = 30, SECONDS = 12;
const run = (command, args, cwd) => {
    const result = spawnSync(command, args, { cwd, encoding: 'utf8' });
    if (result.status !== 0) throw new Error(`${command} failed: ${result.stderr}`);
};
const ff = (dir, args) => run(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', ...args], dir);
const SPOKEN = ['今日は朝のルーティンを紹介します', 'まずはコーヒーを淹れるところから', '豆は挽きたてが一番おいしい', 'お湯は少し冷ましてから注ぎます'];

function tracks() {
    return [
        { id: 'v-main', lane: 'visual', name: 'Base', items: [{
            id: 'cut-base', at: 0, duration: SECONDS * FPS, source: { kind: 'media', src: 'a', in: 0, out: SECONDS, speed: 1 }
        }] },
        { id: 'v-photo', lane: 'visual', name: '写真', items: [{
            id: 'photo-1', at: 0, duration: SECONDS * FPS, transform: { x: 0, y: 0, scale: 0.5, rotate: 0 },
            source: { kind: 'media', src: 'p', in: 0, out: SECONDS }
        }] },
        { id: 'v-captions', lane: 'visual', name: '字幕', items: [{
            id: 'captions', name: '字幕', at: 0, duration: SECONDS * FPS,
            source: { kind: 'captions', path: 'captions.json' }, items: []
        }] },
        { id: 'a1', lane: 'audio', name: 'A1', items: [] }
    ];
}

async function project(name) {
    const dir = path.join(OUT, name);
    await rm(dir, { recursive: true, force: true });
    await mkdir(path.join(dir, 'assets'), { recursive: true });
    ff(dir, ['-f', 'lavfi', '-i', `color=c=0x27313f:size=1280x720:rate=${FPS}:duration=${SECONDS}`,
        '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', 'assets/base.mp4']);
    ff(dir, ['-f', 'lavfi', '-i', 'color=c=0xf5c542:size=1280x720', '-frames:v', '1', 'assets/photo.png']);
    const captions = { default_text_style: { zone: 'bottom' }, captions: [
        ...SPOKEN.map((text, index) => ({
            id: `c-000${index + 1}`, start: index * 3, end: index * 3 + 2.5, text, speaker: null, sourceRef: null, edited: false, src: 'a'
        }))
    ] };
    await writeFile(path.join(dir, 'captions.json'), `${JSON.stringify(captions, null, 2)}\n`);
    const edit = { version: 2, output: { width: 1280, height: 720, fps: FPS },
        sources: [{ id: 'a', path: 'assets/base.mp4' }, { id: 'p', path: 'assets/photo.png' }], tracks: tracks() };
    await writeFile(path.join(dir, 'edit.json'), `${JSON.stringify(edit, null, 2)}\n`);
    run('/usr/bin/git', ['init', '-q'], dir);
    run('/usr/bin/git', ['config', 'user.email', 'ptm-fixture@localhost'], dir);
    run('/usr/bin/git', ['config', 'user.name', 'ptm fixture'], dir);
    run('/usr/bin/git', ['add', '-A'], dir);
    run('/usr/bin/git', ['commit', '-q', '-m', 'fixture'], dir);
    return dir;
}
console.log(JSON.stringify({ base: await project('base') }));
