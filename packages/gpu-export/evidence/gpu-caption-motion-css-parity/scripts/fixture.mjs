#!/usr/bin/env node
// GPU の字幕の動き（textanim）を CSS 宣言（OSR）と比べる L1 の fixture（ラッパー作成の検証用素材）。
// 使い方: node fixture.mjs [出力先]（既定は OS の一時ディレクトリ gpu-caption-motion-css-parity-l1/fixture）
// 4 秒刻みに 1 本ずつ（各 3 秒・重ならない）。映像は ffmpeg で作る単色（L1 専用。単体テストは使わない）。
// 代表の語彙（GPU が受け付けるもの）: in / out に同じ語彙・loop は別の語彙（無しの行は in / out だけ = 回転 / 拡縮の中心を素で見る）。
//   c-0012 = 動きの無い字幕（宣言なし = 既定の 0.18 秒フェード。GPU の書き出しが before / after で画素一致かを見る）
import { spawnSync } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const FFMPEG = process.env.FFMPEG || 'ffmpeg';
export const FPS = 30;
export const STEP = 4;
export const CUE_SECONDS = 3;
// 比べる時刻（字幕内の秒）: in の途中（in 0.6 秒の半分）/ loop の途中（in は終わり out はまだ）/ out の途中（out 0.6 秒の半分）。1/30 秒の整数倍。
export const PHASES = [['in', 0.3], ['loop', 1.5], ['out', CUE_SECONDS - 0.3]];
export const TMP = path.join(os.tmpdir(), 'gpu-caption-motion-css-parity-l1');
const round = value => Math.round(value * 1000) / 1000;

// [id, 文字, in/out 語彙, loop 語彙]
export const ROWS = [
    ['c-0001', 'ふわっと上へ', 'fade-up', 'float'],
    ['c-0002', 'ポンと出る字幕', 'pop', 'breath'],
    ['c-0003', 'くるっと回るだけ', 'spin-in', null],
    ['c-0004', '横から入る字幕', 'slide-left', 'float'],
    ['c-0005', 'ズームで弾む', 'zoom-pop', 'wobble'],
    ['c-0006', '跳ねて出る字幕', 'bounce', 'wobble'],
    ['c-0007', 'くるっと回る', 'spin-in', 'float'],
    ['c-0008', '少し回って出る', 'rotate-in', 'breath'],
    ['c-0009', '少し回るだけ', 'rotate-in', null],
    ['c-0010', '上から落ちる字幕', 'drop-in', 'float'],
    ['c-0011', 'ポンと弾むだけ', 'zoom-pop', null],
    ['c-0012', '動かない字幕です', null, null]
];

// 文字数に比例して cue の区間を単語へ配る（1 文字 = 1 単語。隙間なし）。
function timed(text, start, end) {
    const chars = Array.from(text);
    return chars.map((char, index) => ({
        start: round(start + (end - start) * index / chars.length),
        end: index === chars.length - 1 ? end : round(start + (end - start) * (index + 1) / chars.length),
        text: char
    }));
}

export function buildCaptions() {
    return {
        captions: ROWS.map(([id, text, anim, loop], index) => {
            const start = index * STEP, end = index * STEP + CUE_SECONDS;
            const animation = anim ? { in: { id: anim }, ...(loop ? { loop: { id: loop } } : {}), out: { id: anim } } : null;
            return {
                id, start, end, text, speaker: null, sourceRef: null, edited: false, words: timed(text, start, end),
                ...(animation ? { text_style: { animation } } : {})
            };
        })
    };
}
export const SECONDS = ROWS.length * STEP;

if (import.meta.url === `file://${process.argv[1]}`) {
    const OUT = path.resolve(process.argv[2] ?? path.join(TMP, 'fixture'));
    const dir = path.join(OUT, 'project');
    const run = (command, args, cwd) => {
        const result = spawnSync(command, args, { cwd, encoding: 'utf8' });
        if (result.status !== 0) throw new Error(`${command} failed: ${result.stderr}`);
    };
    await rm(dir, { recursive: true, force: true });
    await mkdir(path.join(dir, 'assets'), { recursive: true });
    run(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
        '-f', 'lavfi', '-i', `color=c=0x27313f:size=1280x720:rate=${FPS}:duration=${SECONDS}`,
        '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', path.join(dir, 'assets', 'base.mp4')], dir);
    await writeFile(path.join(dir, 'captions.json'), `${JSON.stringify(buildCaptions(), null, 2)}\n`);
    const edit = {
        version: 2, output: { width: 1280, height: 720, fps: FPS }, sources: [{ id: 'a', path: 'assets/base.mp4' }],
        tracks: [
            { id: 'v-main', lane: 'visual', name: 'Base', items: [{ id: 'cut-base', at: 0, duration: SECONDS * FPS, source: { kind: 'media', src: 'a', in: 0, out: SECONDS, speed: 1 } }] },
            { id: 'v-captions', lane: 'visual', name: '字幕', items: [{ id: 'captions', name: '字幕', at: 0, duration: SECONDS * FPS, source: { kind: 'captions', path: 'captions.json' }, items: [] }] }
        ]
    };
    await writeFile(path.join(dir, 'edit.json'), `${JSON.stringify(edit, null, 2)}\n`);
    run('/usr/bin/git', ['init', '-q'], dir);
    run('/usr/bin/git', ['config', 'user.email', 'gccp-fixture@localhost'], dir);
    run('/usr/bin/git', ['config', 'user.name', 'gccp fixture'], dir);
    run('/usr/bin/git', ['add', '-A'], dir);
    run('/usr/bin/git', ['commit', '-q', '-m', 'fixture'], dir);
    console.log(JSON.stringify({ project: '<tmp>/fixture/project', rows: ROWS.length, seconds: SECONDS }));
}
