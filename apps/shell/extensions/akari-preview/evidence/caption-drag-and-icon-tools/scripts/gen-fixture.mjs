#!/usr/bin/env node
// 字幕のドラッグ・選択枠・ミニパネルの L1 fixture（ラッパー作成の検証用素材）。出力先はリポの外（引数 1 つ目。既定は OS の一時ディレクトリ）。
// 話した言葉 6 行（4 秒刻み・どれも 1 行に収まる長さ。c-0004〜c-0006 は画面幅の 6 割ほどの中くらいの長さ）+ 置いた文字 1 本（28 秒〜）。
//   c-0001 選択枠・吸着 / c-0002 ミニパネル / c-0003 はみ出し / c-0004 中央吸着で保存 / c-0005 左寄りで保存 / c-0006 右寄りで保存 / c-0101 置いた文字
// 映像は ffmpeg で作る（L1 専用。単体テストは使わない）。
import { spawnSync } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const OUT = path.resolve(process.argv[2] ?? path.join(os.tmpdir(), 'caption-drag-and-icon-tools-l1', 'fixture'));
const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const FPS = 30, SECONDS = 36;
const run = (command, args, cwd) => {
    const result = spawnSync(command, args, { cwd, encoding: 'utf8' });
    if (result.status !== 0) throw new Error(`${command} failed: ${result.stderr}`);
};
const SPOKEN = [
    '今日は朝のルーティンを紹介します',
    'まずはコーヒーを淹れるところから',
    'お湯は少し冷ましてから注ぎます',
    'パソコンを開いて今日の予定を確認して返信を済ませます',
    'その間にデスクの上をさっと片付けて気分を切り替えます',
    '最後に今日いちばん大事な作業を一つだけ決めておきます'
];

const dir = path.join(OUT, 'project');
await rm(dir, { recursive: true, force: true });
await mkdir(path.join(dir, 'assets'), { recursive: true });
run(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
    '-f', 'lavfi', '-i', `color=c=0x27313f:size=1280x720:rate=${FPS}:duration=${SECONDS}`,
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', path.join(dir, 'assets', 'base.mp4')], dir);
const spoken = SPOKEN.map((text, index) => ({
    id: `c-000${index + 1}`, start: index * 4, end: Math.round((index * 4 + 3.6) * 1000) / 1000,
    text, speaker: null, sourceRef: { segment: index }, edited: false
}));
const placed = [{
    id: 'c-0101', start: 28, end: 31.6, text: '置いた文字', time_domain: 'output', sourceRef: null, edited: true, speaker: null,
    text_style: { position: { y: 0.4625 }, text_anchor: 'tc' }
}];
const captions = { default_text_style: { zone: 'bottom' }, captions: [...spoken, ...placed] };
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
run('/usr/bin/git', ['config', 'user.email', 'cdit-fixture@localhost'], dir);
run('/usr/bin/git', ['config', 'user.name', 'cdit fixture'], dir);
run('/usr/bin/git', ['add', '-A'], dir);
run('/usr/bin/git', ['commit', '-q', '-m', 'fixture'], dir);
console.log(JSON.stringify({ project: dir, rows: captions.captions.length }));
