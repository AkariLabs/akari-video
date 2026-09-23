#!/usr/bin/env node
// r1 の L1 fixture（ラッパー作成の検証スクリプト）: 縦（1080×1920）の保存元と横（1920×1080）の当て先の 2 案件。
// vertical: gen-fixture.mjs と同じ 5 行。c-0001 = 色・縁取り・座布団・影・位置を変えた保存元（size 52）。
// horizontal: default_text_style に glow（当て先の既定に残る効果。「無し」が保存されていれば当てた字幕では消える）。
//   c-0001 = 比較用の対照（size 52・reference_height_px なし = 1080 の出力で 52px のまま）。
//   c-0002 = 位置 + animation + glow を持つ（位置と animation は残り、glow は置き換わる）。
//   c-0004 = style_preset（subtitle-variety）だけ持つ（当てると外れ、undo 1 回で戻る）。
// 映像は ffmpeg（L1 専用。単体テストは使わない）。使い方: node gen-fixture-xres.mjs <出力先>
import { spawnSync } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const OUT = path.resolve(process.argv[2] ?? path.join(os.tmpdir(), 'mystyle-look-v0-l1', 'fixture'));
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
    shadow: { color: '#000000', opacity: 0.6, blur_px: 6, distance_px: 6, angle_deg: 90 },
    text_anchor: 'tc', position: { x: 0.5, y: 0.2 }
};
const TARGET_DEFAULT_GLOW = { color: '#00FF00', density: 80, spread: 30 };
const TARGET_C2 = { text_anchor: 'bl', position: { x: 0.1, y: 0.9 }, glow: { color: '#FF00FF', density: 90 },
    animation: { in: { id: 'pop', duration_sec: 0.3 } } };

async function project(name, width, height, cues, defaultTextStyle) {
    const dir = path.join(OUT, name);
    await rm(dir, { recursive: true, force: true });
    await mkdir(path.join(dir, 'assets'), { recursive: true });
    run(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
        '-f', 'lavfi', '-i', `color=c=0x27313f:size=${width / 2}x${height / 2}:rate=${FPS}:duration=${SECONDS}`,
        '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', path.join(dir, 'assets', 'base.mp4')], dir);
    const tracks = [{ id: 'v-main', lane: 'visual', name: 'Base', items: [{
        id: 'cut-base', at: 0, duration: SECONDS * FPS, source: { kind: 'media', src: 'a', in: 0, out: SECONDS, speed: 1 }
    }] }, { id: 'v-captions', lane: 'visual', name: '字幕', items: [{
        id: 'captions', name: '字幕', at: 0, duration: SECONDS * FPS, source: { kind: 'captions', path: 'captions.json' }, items: []
    }] }, { id: 'a1', lane: 'audio', name: 'A1', items: [] }];
    const captions = { default_text_style: defaultTextStyle, captions: SPOKEN.map((text, index) => ({
        id: `c-000${index + 1}`, start: index * 3, end: index * 3 + 2.5, text, speaker: null, sourceRef: null, edited: false, src: 'a',
        ...(cues[index] ?? {})
    })) };
    await writeFile(path.join(dir, 'captions.json'), `${JSON.stringify(captions, null, 2)}\n`);
    const edit = { version: 2, output: { width, height, fps: FPS }, sources: [{ id: 'a', path: 'assets/base.mp4' }], tracks };
    await writeFile(path.join(dir, 'edit.json'), `${JSON.stringify(edit, null, 2)}\n`);
    run('/usr/bin/git', ['init', '-q'], dir);
    run('/usr/bin/git', ['config', 'user.email', 'mystyle-fixture@localhost'], dir);
    run('/usr/bin/git', ['config', 'user.name', 'mystyle fixture'], dir);
    run('/usr/bin/git', ['add', '-A'], dir);
    run('/usr/bin/git', ['commit', '-q', '-m', 'fixture'], dir);
    return dir;
}

const vertical = await project('vertical', 1080, 1920, { 0: { text_style: SOURCE_STYLE } }, { zone: 'bottom' });
const horizontal = await project('horizontal', 1920, 1080, {
    0: { text_style: { size_px: 52 } },
    1: { text_style: TARGET_C2 },
    3: { style_preset: 'subtitle-variety' }
}, { zone: 'bottom', glow: TARGET_DEFAULT_GLOW });
console.log(JSON.stringify({ vertical, horizontal }));
