#!/usr/bin/env node
// 字幕の拡縮・回転と位置の L1 fixture（ラッパー作成の検証用素材）。出力先はリポの外（引数 1 つ目。既定は OS の一時ディレクトリ）。
// 4 秒刻みに 1 本ずつ（重ならない）。映像は ffmpeg で作る（L1 専用。単体テストは使わない）。
//   c-0001 (a) 角のつまみで 1.5 倍 / c-0002 (b) 0.7 倍 / c-0003 (c) 回転 15°
//   c-0004〜c-0010, c-0101, c-0011 (d) 拡縮も回転もしない字幕で「左へ飛ぶ」条件を探す
//   c-0012〜c-0014 見た目の不変・変化の比較用（動かさない）
import { spawnSync } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const OUT = path.resolve(process.argv[2] ?? path.join(os.tmpdir(), 'caption-scale-position-coords-l1', 'fixture'));
const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const FPS = 30, SECONDS = 64;
const run = (command, args, cwd) => {
    const result = spawnSync(command, args, { cwd, encoding: 'utf8' });
    if (result.status !== 0) throw new Error(`${command} failed: ${result.stderr}`);
};
// subtitle-news（presets/textstyle）の style を text_style へ展開したもの = スタイルプリセットを当てた字幕の形。
const NEWS = { size_px: 56, weight: 700, color: '#ffffff', background: { color: '#c62828', opacity: 1, padding_px: 16, radius_px: 0 } };
const ROWS = [
    ['c-0001', '今日は朝のルーティンを紹介します'],
    ['c-0002', 'まずはコーヒーを淹れるところから'],
    ['c-0003', 'お湯は少し冷ましてから注ぎます'],
    ['c-0004', 'パソコンを開いて予定を確認します'],
    ['c-0005', 'その間にデスクの上をさっと片付けて気分を切り替えてから今日いちばん大事な作業を一つだけ決めておきます'],
    ['c-0006', 'ニュース風の字幕', NEWS],
    ['c-0007', '真ん中に置いた字幕', { text_anchor: 'mc', position: { y: 0.5 } }],
    ['c-0008', '上に置いた字幕', { text_anchor: 'tc', position: { y: 0.12 } }],
    ['c-0101', '置いた文字', { position: { y: 0.4625 }, text_anchor: 'tc' }, true],
    ['c-0009', '画面の外へはみ出した字幕です', { text_anchor: 'bc', position: { x: -0.2, y: 0.6 } }],
    ['c-0010', '中央に吸着させる字幕です'],
    ['c-0011', '全字幕モードで動かす字幕'],
    ['c-0012', '位置 x を持つ等倍の字幕', { text_anchor: 'bc', position: { x: 0.25, y: 0.62 } }],
    ['c-0013', '位置 x を持つ 1.5 倍の字幕', { text_anchor: 'bc', position: { x: 0.2, y: 0.8 }, scale: 1.5 }],
    ['c-0014', '位置 x の無い回転 15° の字幕', { rotate: 15 }]
];

const dir = path.join(OUT, 'project');
await rm(dir, { recursive: true, force: true });
await mkdir(path.join(dir, 'assets'), { recursive: true });
run(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
    '-f', 'lavfi', '-i', `color=c=0x27313f:size=1280x720:rate=${FPS}:duration=${SECONDS}`,
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', path.join(dir, 'assets', 'base.mp4')], dir);
const captions = ROWS.map(([id, text, style, placed], index) => ({
    id, start: index * 4, end: Math.round((index * 4 + 3.6) * 1000) / 1000, text,
    ...(placed ? { time_domain: 'output', sourceRef: null, edited: true } : { sourceRef: { segment: index }, edited: false }),
    speaker: null,
    ...(style ? { text_style: style } : {})
}));
await writeFile(path.join(dir, 'captions.json'), `${JSON.stringify({ default_text_style: { zone: 'bottom' }, captions }, null, 2)}\n`);
const edit = {
    version: 2, output: { width: 1280, height: 720, fps: FPS }, sources: [{ id: 'a', path: 'assets/base.mp4' }],
    tracks: [
        { id: 'v-main', lane: 'visual', name: 'Base', items: [{ id: 'cut-base', at: 0, duration: SECONDS * FPS, source: { kind: 'media', src: 'a', in: 0, out: SECONDS, speed: 1 } }] },
        { id: 'v-captions', lane: 'visual', name: '字幕', items: [{ id: 'captions', name: '字幕', at: 0, duration: SECONDS * FPS, source: { kind: 'captions', path: 'captions.json' }, items: [] }] }
    ]
};
await writeFile(path.join(dir, 'edit.json'), `${JSON.stringify(edit, null, 2)}\n`);
run('/usr/bin/git', ['init', '-q'], dir);
run('/usr/bin/git', ['config', 'user.email', 'cspc-fixture@localhost'], dir);
run('/usr/bin/git', ['config', 'user.name', 'cspc fixture'], dir);
run('/usr/bin/git', ['add', '-A'], dir);
run('/usr/bin/git', ['commit', '-q', '-m', 'fixture'], dir);
console.log(JSON.stringify({ project: dir, rows: captions.length }));
