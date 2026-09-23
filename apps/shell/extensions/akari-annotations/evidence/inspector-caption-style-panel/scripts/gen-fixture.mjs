#!/usr/bin/env node
// インスペクターの字幕スタイル面の L1 fixture（ラッパー作成の検証用素材）。出力先はリポの外（引数 1 つ目。既定は OS の一時ディレクトリ）。
// 字幕の種類を 1 本ずつ: 話した言葉（スタイルなし）/ 話した言葉 2 行 + 座布団あり / スタイルプリセット付き / 置いた文字（output 時間軸）
// + 複数選択用の話した言葉 2 本 + r1 用の 3 本（2 行 / プリセット付き / 素）。映像は ffmpeg で作る（L1 専用。単体テストは使わない）。
import { spawnSync } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const OUT = path.resolve(process.argv[2] ?? path.join(os.tmpdir(), 'inspector-caption-style-panel-l1', 'fixture'));
const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const FPS = 30, SECONDS = 36;
const run = (command, args, cwd) => {
    const result = spawnSync(command, args, { cwd, encoding: 'utf8' });
    if (result.status !== 0) throw new Error(`${command} failed: ${result.stderr}`);
};

await rm(OUT, { recursive: true, force: true });
await mkdir(path.join(OUT, 'assets'), { recursive: true });
run(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
    '-f', 'lavfi', '-i', `color=c=0x5b7288:size=1280x720:rate=${FPS}:duration=${SECONDS}`,
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', path.join(OUT, 'assets', 'base.mp4')], OUT);
const spoken = (id, start, text, extra = {}) => ({
    id, start, end: start + 3.2, text, speaker: null, sourceRef: { segment: Number(id.slice(-2)) }, edited: false, ...extra
});
const captions = {
    default_text_style: { zone: 'bottom' },
    captions: [
        spoken('c-0001', 0, '今日は朝のルーティンを紹介します'),
        spoken('c-0002', 4, 'まずはコーヒーを\n淹れるところから', {
            text_style: { background: { color: '#1e3a8a', opacity: 0.8, radius_px: 6, mode: 'per-line' } }
        }),
        spoken('c-0003', 8, 'ここがすごい', { style_preset: 'subtitle-variety' }),
        spoken('c-0004', 16, 'お湯は少し冷ましてから注ぎます'),
        spoken('c-0005', 20, '蒸らしは 30 秒くらい'),
        // r1（太さ・行間・字間・余白・効果 5 種）用: 2 行の話した言葉 / プリセット付き / 素の 1 本（複数選択 3 本 = c-0006〜c-0008）
        spoken('c-0006', 24, '効果と文字の\n設定を試します'),
        spoken('c-0007', 28, 'プリセットの字幕', { style_preset: 'subtitle-variety' }),
        spoken('c-0008', 32, '三本目の字幕です'),
        {
            id: 'c-0101', start: 12, end: 15.2, text: '置いた文字', time_domain: 'output', sourceRef: null,
            edited: true, speaker: null, text_style: { position: { y: 0.4625 }, text_anchor: 'tc' }
        }
    ]
};
await writeFile(path.join(OUT, 'captions.json'), `${JSON.stringify(captions, null, 2)}\n`);
const edit = {
    version: 2, output: { width: 1280, height: 720, fps: FPS }, sources: [{ id: 'a', path: 'assets/base.mp4' }],
    tracks: [
        { id: 'v-main', lane: 'visual', name: 'Base', items: [{ id: 'cut-base', at: 0, duration: SECONDS * FPS, source: { kind: 'media', src: 'a', in: 0, out: SECONDS, speed: 1 } }] },
        { id: 'v-captions', lane: 'visual', name: '字幕', items: [{ id: 'captions', name: '字幕', at: 0, duration: SECONDS * FPS, source: { kind: 'captions', path: 'captions.json' }, items: [] }] }
    ]
};
await writeFile(path.join(OUT, 'edit.json'), `${JSON.stringify(edit, null, 2)}\n`);
run('/usr/bin/git', ['init', '-q'], OUT);
run('/usr/bin/git', ['config', 'user.email', 'icsp-fixture@localhost'], OUT);
run('/usr/bin/git', ['config', 'user.name', 'icsp fixture'], OUT);
run('/usr/bin/git', ['add', '-A'], OUT);
run('/usr/bin/git', ['commit', '-q', '-m', 'fixture'], OUT);
console.log(JSON.stringify({ fixture: OUT, rows: captions.captions.length }));
