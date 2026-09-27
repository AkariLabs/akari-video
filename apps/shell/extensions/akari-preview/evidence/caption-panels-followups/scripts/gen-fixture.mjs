#!/usr/bin/env node
// caption-panels-followups の L1 fixture（ラッパー作成の検証スクリプト。mystyle-look-v0 の gen-fixture の写しを改変）。
// 話した言葉 5 行（c-0001〜c-0005・15 秒）+ 字幕トラック + 空の A1。c-0001 だけ色・縁取り・座布団・影を変えてある。
// 加えて、ライブラリにマイスタイル 1 件（styles/ct-yellow/style.json）を置く（akari-project の createMyStyle で作る）。
// 映像は ffmpeg で作る（L1 専用。単体テストは使わない）。使い方: node gen-fixture.mjs <出力先>
import { spawnSync } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..', '..', '..', '..', '..', '..');
const OUT = path.resolve(process.argv[2]);
const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const FPS = 30, SECONDS = 15;
const run = (command, args, cwd) => {
    const result = spawnSync(command, args, { cwd, encoding: 'utf8' });
    if (result.status !== 0) throw new Error(`${command} failed: ${result.stderr}`);
};
const SPOKEN = ['今日は朝のルーティンを紹介します', 'まずはコーヒーを淹れるところから', '豆は挽きたてが一番おいしい', 'お湯は少し冷ましてから注ぎます', 'ここがいちばん大事'];
export const SOURCE_STYLE = {
    color: '#FFD400', size_px: 52, font_weight: 900,
    stroke: { color: '#D12B2B', width_px: 5 },
    background: { color: '#1E3A8A', opacity: 0.85, radius_px: 12, mode: 'block' },
    shadow: { color: '#000000', opacity: 0.6, blur_px: 6, distance_px: 6, angle_deg: 90 }
};
const dir = path.join(OUT, 'spoken');
await rm(dir, { recursive: true, force: true });
await mkdir(path.join(dir, 'assets'), { recursive: true });
run(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
    '-f', 'lavfi', '-i', `color=c=0x27313f:size=1280x720:rate=${FPS}:duration=${SECONDS}`,
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', path.join(dir, 'assets', 'base.mp4')], dir);
const tracks = [{ id: 'v-main', lane: 'visual', name: 'Base', items: [{
    id: 'cut-base', at: 0, duration: SECONDS * FPS, source: { kind: 'media', src: 'a', in: 0, out: SECONDS, speed: 1 }
}] }, { id: 'v-captions', lane: 'visual', name: '字幕', items: [{
    id: 'captions', name: '字幕', at: 0, duration: SECONDS * FPS, source: { kind: 'captions', path: 'captions.json' }, items: []
}] }, { id: 'a1', lane: 'audio', name: 'A1', items: [] }];
const captions = { default_text_style: { zone: 'bottom' }, captions: SPOKEN.map((text, index) => ({
    id: `c-000${index + 1}`, start: index * 3, end: index * 3 + 2.5, text, speaker: null, sourceRef: null, edited: false, src: 'a',
    ...(index === 0 ? { text_style: SOURCE_STYLE } : {})
})) };
await writeFile(path.join(dir, 'captions.json'), `${JSON.stringify(captions, null, 2)}\n`);
const edit = { version: 2, output: { width: 1280, height: 720, fps: FPS }, sources: [{ id: 'a', path: 'assets/base.mp4' }], tracks };
await writeFile(path.join(dir, 'edit.json'), `${JSON.stringify(edit, null, 2)}\n`);
run('/usr/bin/git', ['init', '-q'], dir);
run('/usr/bin/git', ['config', 'user.email', 'caption-panels-followups-fixture@localhost'], dir);
run('/usr/bin/git', ['config', 'user.name', 'caption-panels-followups fixture'], dir);
run('/usr/bin/git', ['add', '-A'], dir);
run('/usr/bin/git', ['commit', '-q', '-m', 'fixture'], dir);
// マイスタイル 1 件（ライブラリ = <出力先>/library）
const { createMyStyle } = await import(pathToFileURL(path.join(REPO, 'apps/shell/extensions/akari-project/lib/common/my-style.js')).href);
const library = path.join(OUT, 'library');
await rm(library, { recursive: true, force: true });
const style = createMyStyle({ id: 'ct-yellow', name: '黄色の強調', when_to_use: '驚いたとき', sample_text: '文字',
    parts: [{ kind: 'look', scope: 'caption', mode: 'modify', text_style: { color: '#FFE600', size_px: 56, font_weight: 800,
        stroke: { color: '#7A1FA2', width_px: 6 }, background: { color: '#10302A', opacity: 0.9, radius_px: 10, mode: 'block' },
        shadow: { color: '#000000', opacity: 0.7, blur_px: 4, distance_px: 5, angle_deg: 90 }, reference_height_px: 720 } }] }, '2026-09-27T00:00:00.000Z');
await mkdir(path.join(library, 'styles', 'ct-yellow'), { recursive: true });
await writeFile(path.join(library, 'styles', 'ct-yellow', 'style.json'), `${JSON.stringify(style, null, 2)}\n`);
console.log(JSON.stringify({ spoken: dir, library }));
