#!/usr/bin/env node
// マイスタイル「動き」部品の L1 fixture（ラッパー作成の検証スクリプト。mystyle-look-v0 の gen-fixture の写しを改変）。
// 話した言葉 5 行（c-0001〜c-0005・15 秒）+ 字幕トラック + 空の A1。
//   c-0001 = 保存元: 見た目（色・縁取り・座布団・影）+ 動き（登場 fade-up・ループ float）+ 位置
//   c-0002 = 別の見た目（白・縁取り 3）+ 位置 + 別の動き（登場 pop・退場 slide-down）→ 動きだけ当てると退場が消えることの確認
//   c-0003 = 何も持たない
//   c-0004 = style_preset: emphasis-red（プリセットに登場 pop）→ 動きだけ当てても style_preset が残ることの確認
//   c-0005 = 何も持たない（動きの無い字幕の保存ダイアログの確認用）
// 映像は ffmpeg で作る（L1 専用。単体テストは使わない）。使い方: node gen-fixture.mjs <出力先>
import { spawnSync } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const OUT = path.resolve(process.argv[2] ?? path.join(os.tmpdir(), 'mystyle-motion-part-l1', 'fixture'));
const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const FPS = 30, SECONDS = 15;
const run = (command, args, cwd) => {
    const result = spawnSync(command, args, { cwd, encoding: 'utf8' });
    if (result.status !== 0) throw new Error(`${command} failed: ${result.stderr}`);
};
const SPOKEN = ['今日は朝のルーティンを紹介します', 'まずはコーヒーを淹れるところから', '豆は挽きたてが一番おいしい', 'お湯は少し冷ましてから注ぎます', 'ここがいちばん大事'];
export const SOURCE_MOTION = { in: { id: 'fade-up', duration_sec: 0.6 }, loop: { id: 'float' } };
export const SOURCE_STYLE = {
    color: '#FFD400', size_px: 52, font_weight: 900,
    stroke: { color: '#D12B2B', width_px: 5 },
    background: { color: '#1E3A8A', opacity: 0.85, radius_px: 12, mode: 'block' },
    shadow: { color: '#000000', opacity: 0.6, blur_px: 6, distance_px: 6, angle_deg: 90 },
    animation: SOURCE_MOTION,
    text_anchor: 'tc', position: { x: 0.5, y: 0.2 }
};
export const C2_STYLE = {
    color: '#FFFFFF', size_px: 44, stroke: { color: '#000000', width_px: 3 },
    animation: { in: { id: 'pop', duration_sec: 0.4 }, out: { id: 'slide-down', duration_sec: 0.5 } },
    text_anchor: 'bl', position: { x: 0.1, y: 0.9 }
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
    ...(index === 0 ? { text_style: SOURCE_STYLE } : {}),
    ...(index === 1 ? { text_style: C2_STYLE } : {}),
    ...(index === 3 ? { style_preset: 'emphasis-red' } : {})
})) };
await writeFile(path.join(dir, 'captions.json'), `${JSON.stringify(captions, null, 2)}\n`);
const edit = { version: 2, output: { width: 1280, height: 720, fps: FPS }, sources: [{ id: 'a', path: 'assets/base.mp4' }], tracks };
await writeFile(path.join(dir, 'edit.json'), `${JSON.stringify(edit, null, 2)}\n`);
run('/usr/bin/git', ['init', '-q'], dir);
run('/usr/bin/git', ['config', 'user.email', 'mystyle-fixture@localhost'], dir);
run('/usr/bin/git', ['config', 'user.name', 'mystyle fixture'], dir);
run('/usr/bin/git', ['add', '-A'], dir);
run('/usr/bin/git', ['commit', '-q', '-m', 'fixture'], dir);
console.log(JSON.stringify({ spoken: dir }));
