#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const out = process.argv[2];
if (!out || !path.isAbsolute(out)) throw new Error('Give an absolute output directory outside the repository.');
const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../../../../');
if (!path.relative(repository, out).startsWith('..')) throw new Error('The output directory must be outside the repository.');
const project = path.join(out, 'tl-cut-commands-project');
await rm(project, { recursive: true, force: true });
await mkdir(path.join(project, 'assets'), { recursive: true });
await mkdir(path.join(project, 'overlays'), { recursive: true });
const ff = args => {
    const result = spawnSync(process.env.FFMPEG || 'ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', ...args],
        { cwd: project, encoding: 'utf8' });
    if (result.status !== 0) throw new Error(result.stderr || 'media generation failed');
};
ff(['-f', 'lavfi', '-i', 'color=c=0x27313f:size=1280x720:rate=30:duration=20',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=20', '-c:v', 'libx264', '-preset', 'ultrafast',
    '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', 'assets/main.mp4']);
ff(['-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=30:duration=8', '-c:v', 'libx264',
    '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', 'assets/broll.mp4']);
ff(['-f', 'lavfi', '-i', 'sine=frequency=880:duration=20', '-c:a', 'pcm_s16le', 'assets/sfx.wav']);
ff(['-f', 'lavfi', '-i', 'sine=frequency=220:duration=20', '-c:a', 'pcm_s16le', 'assets/bgm.wav']);
for (const [id, text] of [['telop-cross', '範囲'], ['telop-later', '後半']]) {
    await writeFile(path.join(project, 'overlays', `${id}.html`),
        `<div style="position:absolute;left:64px;top:64px;font:48px sans-serif;color:var(--theia-editor-foreground)">${text}</div>\n`);
}
const fps = 30;
const media = (id, at, duration, src, sourceIn = 0, extra = {}) => ({ id, at: at * fps,
    duration: duration * fps, source: { kind: 'media', src, in: sourceIn, out: sourceIn + duration }, ...extra });
const tracks = [
    { id: 'v-main', lane: 'visual', name: '本編', items: [media('main', 0, 20, 'main', 0, { audio: false })] },
    { id: 'v-telop', lane: 'visual', name: 'テロップ', items: [
        { id: 'telop-cross', at: 7 * fps, duration: 6 * fps, source: { kind: 'html', path: 'overlays/telop-cross.html', exclude: [] } },
        { id: 'telop-later', at: 15 * fps, duration: 2 * fps, source: { kind: 'html', path: 'overlays/telop-later.html', exclude: [] } }
    ] },
    { id: 'v-broll', lane: 'visual', name: 'B ロール', items: [
        media('broll-cross', 7, 6, 'broll'), media('broll-later', 15, 3, 'broll', 3)
    ] },
    { id: 'v-captions', lane: 'visual', name: '字幕', items: [{ id: 'captions', name: '字幕', at: 0,
        duration: 20 * fps, source: { kind: 'captions', path: 'captions.json' }, items: [] }] },
    { id: 'a-linked', lane: 'audio', name: 'リンク音声', items: [media('main-audio', 0, 20, 'main', 0, { link: 'main' })] },
    { id: 'a-sfx', lane: 'audio', name: '効果音', items: [
        media('sfx-cross', 7, 6, 'sfx'), media('sfx-later', 15, 2, 'sfx', 6)
    ] },
    { id: 'a-bgm', lane: 'audio', name: 'BGM', items: [media('bgm', 0, 20, 'bgm', 0, { role: 'bgm' })] }
];
const captions = { default_text_style: { zone: 'bottom' }, captions: [
    { id: 'c-0001', start: 9, end: 11, text: '範囲内の字幕', speaker: null, sourceRef: null, edited: false, src: 'main' },
    { id: 'c-0002', start: 15, end: 17, text: '後ろの字幕', speaker: null, sourceRef: null, edited: false, src: 'main' }
] };
await writeFile(path.join(project, 'captions.json'), `${JSON.stringify(captions, null, 2)}\n`);
await writeFile(path.join(project, 'edit.json'), `${JSON.stringify({ version: 2,
    output: { width: 1280, height: 720, fps },
    sources: [{ id: 'main', path: 'assets/main.mp4' }, { id: 'broll', path: 'assets/broll.mp4' },
        { id: 'sfx', path: 'assets/sfx.wav' }, { id: 'bgm', path: 'assets/bgm.wav' }], tracks }, null, 2)}\n`);
console.log(JSON.stringify({ project }));
