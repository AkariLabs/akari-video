#!/usr/bin/env node
// 置いた文字の所見 L1 の fixture（ラッパー作成の検証用素材）。出力先はリポの外（引数 1 つ目。既定は OS の一時ディレクトリ）。
// polish = 話した言葉 8 行（4 秒刻み）+ 置いた文字 9 本（3 秒刻み・2.8 秒・互いに重ならない・mc アンカー・中央）。
// 最後の話した言葉（28〜31.2 秒）には置いた文字を掛けない（台本の「T この行から文字を置く」で 10 本目を置く）。
// 映像は ffmpeg で作る（L1 専用。単体テストは使わない）。
import { spawnSync } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const OUT = path.resolve(process.argv[2] ?? path.join(os.tmpdir(), 'ptfp-l1', 'fixture'));
const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const FPS = 30, SECONDS = 32;
const run = (command, args, cwd) => {
    const result = spawnSync(command, args, { cwd, encoding: 'utf8' });
    if (result.status !== 0) throw new Error(`${command} failed: ${result.stderr}`);
};
const SPOKEN = [
    '今日は朝のルーティンを紹介します', 'まずはコーヒーを淹れるところから', '豆は挽きたてが一番おいしい',
    'お湯は少し冷ましてから注ぎます', '蒸らしは 30 秒くらい', 'その間にデスクを片付けます',
    'パソコンを開いて今日の予定を確認', '最後にチャンネル登録お願いします'
];
export const PLACED_COUNT = 9;

const dir = path.join(OUT, 'polish');
await rm(dir, { recursive: true, force: true });
await mkdir(path.join(dir, 'assets'), { recursive: true });
run(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
    '-f', 'lavfi', '-i', `color=c=0x27313f:size=1280x720:rate=${FPS}:duration=${SECONDS}`,
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', path.join(dir, 'assets', 'base.mp4')], dir);
const spoken = SPOKEN.map((text, index) => ({
    id: `c-000${index + 1}`, start: index * 4, end: Math.round((index * 4 + 3.2) * 1000) / 1000,
    text, speaker: null, sourceRef: { segment: index }, edited: false
}));
const placed = Array.from({ length: PLACED_COUNT }, (_, index) => ({
    id: `c-${String(index + 101).padStart(4, '0')}`, start: index * 3,
    end: Math.round((index * 3 + 2.8) * 1000) / 1000, text: `置いた文字 ${index + 1}`,
    time_domain: 'output', sourceRef: null, edited: true, speaker: null,
    text_style: { position: { x: 0.5, y: 0.5 }, text_anchor: 'mc' }
}));
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
run('/usr/bin/git', ['config', 'user.email', 'ptfp-fixture@localhost'], dir);
run('/usr/bin/git', ['config', 'user.name', 'ptfp fixture'], dir);
run('/usr/bin/git', ['add', '-A'], dir);
run('/usr/bin/git', ['commit', '-q', '-m', 'fixture'], dir);
console.log(JSON.stringify({ polish: dir, rows: captions.captions.length }));
