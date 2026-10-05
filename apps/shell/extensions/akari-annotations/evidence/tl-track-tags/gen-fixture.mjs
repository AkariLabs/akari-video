#!/usr/bin/env node
// L1 専用。生成物はリポジトリ外の隔離ディレクトリへ置く。
import { spawnSync } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const tmpRoot = process.env.AKARI_TL_TRACK_TAGS_TMP ?? path.join(path.parse(os.tmpdir()).root, 'tmp');
const output = path.resolve(process.argv[2] ?? path.join(tmpRoot, 'akari-tl-track-tags-fixture'));
const ffmpeg = process.env.FFMPEG ?? 'ffmpeg';
await rm(output, { recursive: true, force: true });
await mkdir(path.join(output, 'assets'), { recursive: true });
const run = args => {
    const result = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', ...args],
        { cwd: output, encoding: 'utf8' });
    if (result.status !== 0) throw new Error(`fixture media generation failed: ${result.stderr}`);
};
run(['-f', 'lavfi', '-i', 'color=c=0x27313f:size=640x360:rate=30:duration=8',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', 'assets/main.mp4']);
run(['-f', 'lavfi', '-i', 'color=c=0x6a4c93:size=640x360:rate=30:duration=3',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', 'assets/broll.mp4']);
run(['-f', 'lavfi', '-i', 'sine=frequency=660:duration=2', '-c:a', 'pcm_s16le', 'assets/sfx.wav']);
run(['-f', 'lavfi', '-i', 'sine=frequency=220:duration=8', '-c:a', 'pcm_s16le', 'assets/bgm.wav']);

const media = (id, src, at, duration, extra = {}) => ({
    id, at, duration, ...extra,
    source: { kind: 'media', src, in: 0, out: duration / 30 }
});
const edit = {
    version: 2, output: { width: 640, height: 360, fps: 30 },
    sources: [
        { id: 'main', path: 'assets/main.mp4' }, { id: 'broll', path: 'assets/broll.mp4' },
        { id: 'sfx', path: 'assets/sfx.wav' }, { id: 'bgm', path: 'assets/bgm.wav' }
    ],
    tracks: [
        { id: 'a-bgm', lane: 'audio', name: 'BGM', items: [media('bgm-1', 'bgm', 0, 240, { role: 'bgm' })] },
        { id: 'a-sfx', lane: 'audio', name: '効果音', items: [media('sfx-1', 'sfx', 30, 45, { role: 'sfx' })] },
        { id: 'v-main', lane: 'visual', name: '本編', items: [media('main-1', 'main', 0, 240)] },
        { id: 'v-broll', lane: 'visual', name: 'B ロール', items: [media('broll-1', 'broll', 60, 90)] },
        { id: 'v-telop', lane: 'visual', name: 'テロップ', items: [{ id: 'telop-1', at: 30, duration: 90,
            source: { kind: 'telop', preset: 'ref3_chapter_tag', params: { text: '検証用テロップ' } } }] },
        { id: 'captions', lane: 'visual', name: '字幕', content: { from: 'captions.json' } }
    ]
};
const captions = { default_text_style: { zone: 'bottom' }, captions: [
    { id: 'c-0001', start: 0, end: 3, text: '検証用の字幕です', speaker: null, sourceRef: null, edited: false, src: 'main' }
] };
await writeFile(path.join(output, 'edit.json'), `${JSON.stringify(edit, null, 2)}\n`);
await writeFile(path.join(output, 'captions.json'), `${JSON.stringify(captions, null, 2)}\n`);
console.log(JSON.stringify({ project: output, tracks: edit.tracks.map(track => track.id) }));
