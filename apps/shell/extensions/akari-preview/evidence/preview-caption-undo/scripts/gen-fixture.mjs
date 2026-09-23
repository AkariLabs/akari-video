#!/usr/bin/env node
// 出力プレビュー発の字幕の書き込みの undo / redo の L1 fixture（ラッパー作成の検証用素材。caption-multiselect-move の fixture の写し）。
// 出力先はリポの外（引数 1 つ目。既定は OS の一時ディレクトリ）。
//   話した言葉 c-0001〜c-0004（1 秒・5 秒・9 秒・13 秒から 3.6 秒ずつ。間に 0.4 秒の隙間）= 範囲選択（c-0001〜c-0003）と 1 本だけの回帰（c-0004）
//   置いた文字 c-0101〜c-0103（17〜22 秒・同じ時刻に 3 段）= Cmd クリック 3 本（3 本とも同じ時刻に見える）
// 映像は ffmpeg で作る（L1 専用。単体テストは使わない）。
import { spawnSync } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const OUT = path.resolve(process.argv[2] ?? path.join(os.tmpdir(), 'preview-caption-undo-l1', 'fixture'));
const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const FPS = 30, SECONDS = 24;
const run = (command, args, cwd) => {
    const result = spawnSync(command, args, { cwd, encoding: 'utf8' });
    if (result.status !== 0) throw new Error(`${command} failed: ${result.stderr}`);
};
const SPOKEN = [
    '今日は朝のルーティンを紹介します',
    'まずはコーヒーを淹れるところから',
    'お湯は少し冷ましてから注ぎます',
    'パソコンを開いて今日の予定を確認します'
];
const PLACED = [
    { text: 'ひとつめの置いた文字です', y: 0.12 },
    { text: 'ふたつめの置いた文字です', y: 0.38 },
    { text: 'みっつめの置いた文字です', y: 0.62 }
];

const dir = path.join(OUT, 'project');
await rm(dir, { recursive: true, force: true });
await mkdir(path.join(dir, 'assets'), { recursive: true });
run(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
    '-f', 'lavfi', '-i', `color=c=0x27313f:size=1280x720:rate=${FPS}:duration=${SECONDS}`,
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', path.join(dir, 'assets', 'base.mp4')], dir);
const spoken = SPOKEN.map((text, index) => ({
    id: `c-000${index + 1}`, start: 1 + index * 4, end: Math.round((1 + index * 4 + 3.6) * 1000) / 1000,
    text, speaker: null, sourceRef: { segment: index }, edited: false
}));
const placed = PLACED.map((item, index) => ({
    id: `c-010${index + 1}`, start: 17, end: 22, text: item.text, time_domain: 'output', sourceRef: null, edited: true, speaker: null,
    text_style: { position: { y: item.y }, text_anchor: 'tc' }
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
run('/usr/bin/git', ['config', 'user.email', 'pcu-fixture@localhost'], dir);
run('/usr/bin/git', ['config', 'user.name', 'pcu fixture'], dir);
run('/usr/bin/git', ['add', '-A'], dir);
run('/usr/bin/git', ['commit', '-q', '-m', 'fixture'], dir);
console.log(JSON.stringify({ project: dir, rows: captions.captions.length }));
