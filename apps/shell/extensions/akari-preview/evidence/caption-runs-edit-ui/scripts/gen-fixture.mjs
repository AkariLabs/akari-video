#!/usr/bin/env node
// 文字範囲（runs）の操作画面の L1 fixture（ラッパー作成の検証用素材）。出力先はリポの外（引数 1 つ目。既定は OS の一時ディレクトリ）。
// 話した言葉 3 行（4 秒刻み）: c-0001「これは最高のアイデアです」（なぞる対象）/ c-0002 / c-0003（範囲を選ばないときの確認）。
// マイスタイル 1 件（look = 色・太さ・縁取り・座布団・影 = 座布団と影は runs の語彙外）をライブラリの styles/ に置く。
// 映像は ffmpeg で作る（L1 専用。単体テストは使わない）。
import { spawnSync } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const OUT = path.resolve(process.argv[2] ?? path.join(os.tmpdir(), 'caption-runs-edit-ui-l1', 'fixture'));
const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const FPS = 30, SECONDS = 12;
const run = (command, args, cwd) => {
    const result = spawnSync(command, args, { cwd, encoding: 'utf8' });
    if (result.status !== 0) throw new Error(`${command} failed: ${result.stderr}`);
};
const SPOKEN = ['これは最高のアイデアです', 'まずはコーヒーを淹れます', 'お湯は少し冷ましてから注ぎます'];

const dir = path.join(OUT, 'project');
await rm(OUT, { recursive: true, force: true });
await mkdir(path.join(dir, 'assets'), { recursive: true });
run(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
    '-f', 'lavfi', '-i', `color=c=0x27313f:size=1280x720:rate=${FPS}:duration=${SECONDS}`,
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', path.join(dir, 'assets', 'base.mp4')], dir);
const captions = {
    default_text_style: { zone: 'bottom' },
    captions: SPOKEN.map((text, index) => ({
        id: `c-000${index + 1}`, start: index * 4, end: Math.round((index * 4 + 3.6) * 1000) / 1000,
        text, speaker: null, sourceRef: { segment: index }, edited: false
    }))
};
await writeFile(path.join(dir, 'captions.json'), `${JSON.stringify(captions, null, 2)}\n`);
const edit = {
    version: 2, output: { width: 1280, height: 720, fps: FPS }, sources: [{ id: 'a', path: 'assets/base.mp4' }],
    tracks: [
        { id: 'v-main', lane: 'visual', name: 'Base', items: [{ id: 'cut-base', at: 0, duration: SECONDS * FPS, source: { kind: 'media', src: 'a', in: 0, out: SECONDS, speed: 1 } }] },
        { id: 'v-captions', lane: 'visual', name: '字幕', items: [{ id: 'captions', name: '字幕', at: 0, duration: SECONDS * FPS, source: { kind: 'captions', path: 'captions.json' }, items: [] }] }
    ]
};
await writeFile(path.join(dir, 'edit.json'), `${JSON.stringify(edit, null, 2)}\n`);
run('/usr/bin/git', ['init', '-q'], dir);
run('/usr/bin/git', ['config', 'user.email', 'runs-fixture@localhost'], dir);
run('/usr/bin/git', ['config', 'user.name', 'runs fixture'], dir);
run('/usr/bin/git', ['add', '-A'], dir);
run('/usr/bin/git', ['commit', '-q', '-m', 'fixture'], dir);

const library = path.join(OUT, 'library');
const styleDir = path.join(library, 'styles', 'runs-l1-green');
await mkdir(styleDir, { recursive: true });
const style = {
    schema: 'akari-style', version: 1, revision: 1, uid: '01K5RXNS71GXEEN0000000000A', id: 'runs-l1-green',
    name: '緑の強調（L1）', when_to_use: '文字範囲に見た目を当てる確認', sample_text: '最高',
    created_at: '2026-09-24T00:00:00.000Z', updated_at: '2026-09-24T00:00:00.000Z', tags: [], visibility: 'private', price: null,
    requires: [], provenance: {},
    license: { spdx: 'LicenseRef-user-owned', scope: 'private-owned', attribution_required: false, ai_training_allowed: false },
    parts: [{ kind: 'look', scope: 'caption', mode: 'modify', text_style: {
        color: '#22C55E', font_weight: 900, stroke: { color: '#0B3D1E', width_px: 3 },
        background: { color: '#1E3A8A', opacity: 0.85, radius_px: 12, mode: 'block' },
        shadow: { color: '#000000', opacity: 0.6, blur_px: 6, distance_px: 6, angle_deg: 90 }, reference_height_px: 720
    } }]
};
await writeFile(path.join(styleDir, 'style.json'), `${JSON.stringify(style, null, 2)}\n`);
console.log(JSON.stringify({ project: dir, library, rows: captions.captions.length }));
