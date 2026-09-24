#!/usr/bin/env node
// 字幕の動き（text_style.animation = textanim の in / loop / out）の L1 fixture（ラッパー作成の検証用素材）。
// 使い方: node gen-fixture.mjs [--gpu] [出力先]（既定は OS の一時ディレクトリ）
//   --gpu = GPU 書き出しが受け付ける版（GPU の字幕の動きに無い typewriter / wipe-left の c-0003 / c-0009 だけ動きを外す）
//   --overlap = 同時に 3 本見える版（o-top = spin-in / o-mid = 動き無し / o-bottom = fade-up。0〜3 秒）。行ごとの宣言が混ざらないかを見る
// 4 秒刻みに 1 本ずつ（各 3 秒・重ならない）。映像は ffmpeg で作る単色（L1 専用。単体テストは使わない）。
//   c-0001..c-0010 = 代表 10 語彙（in と out に同じ語彙・loop は別の語彙）
//   c-0010 は強調（emphasis_words の one-char-bang = 1 文字ずつの描画）つき = styled 経路
//   c-0011 = 文字範囲（runs・紫）つき + run の animation（loop float）
//   c-0012 = 動きの無い字幕（不変の比較用）
import { spawnSync } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const FFMPEG = process.env.FFMPEG || 'ffmpeg';
export const FPS = 30;
export const STEP = 4;
export const CUE_SECONDS = 3;
const round = value => Math.round(value * 1000) / 1000;

// [id, 文字, in/out 語彙, loop 語彙]
export const ROWS = [
    ['c-0001', 'ふわっと上へ', 'fade-up', 'float'],
    ['c-0002', 'ポンと出る字幕', 'pop', 'breath'],
    ['c-0003', 'タイプ印字です', 'typewriter', 'wobble'],
    ['c-0004', '横から入る字幕', 'slide-left', 'float'],
    ['c-0005', 'ズームで弾む', 'zoom-pop', 'hologram'],
    ['c-0006', '跳ねて出る字幕', 'bounce', 'wobble'],
    ['c-0007', 'くるっと回る', 'spin-in', 'float'],
    ['c-0008', '少し回って出る', 'rotate-in', 'breath'],
    ['c-0009', 'ワイプで出る字幕', 'wipe-left', 'float'],
    ['c-0010', '上から落ちる発見', 'drop-in', 'float'],
    ['c-0011', 'ここが一番の見所', 'fade-up', 'float'],
    ['c-0012', '動かない字幕です', null, null]
];
export const REPRESENTATIVE = ROWS.slice(0, 10).map(([id, , anim]) => ({ id, anim }));

// 文字数に比例して cue の区間を単語へ配る（1 文字 = 1 単語。隙間なし）。
function timed(text, start, end) {
    const chars = Array.from(text);
    return chars.map((char, index) => ({
        start: round(start + (end - start) * index / chars.length),
        end: index === chars.length - 1 ? end : round(start + (end - start) * (index + 1) / chars.length),
        text: char
    }));
}

export const GPU_UNSUPPORTED = new Set(['typewriter', 'wipe-left']);
export function buildCaptions({ gpu = false } = {}) {
    const captions = ROWS.map(([id, text, anim0, loop], index) => {
        const anim = gpu && GPU_UNSUPPORTED.has(anim0) ? null : anim0;
        const start = index * STEP, end = index * STEP + CUE_SECONDS;
        return {
            id, start, end, text, speaker: null, sourceRef: null, edited: false, words: timed(text, start, end),
            ...(anim ? { text_style: { animation: { in: { id: anim }, loop: { id: loop }, out: { id: anim } } } } : {}),
            ...(id === 'c-0011' ? { runs: [{ from: 2, to: 4, style: { color: '#b388ff' }, animation: { loop: { id: 'float' } } }] } : {})
        };
    });
    const c10 = captions.find(c => c.id === 'c-0010');
    // 「発見」（6〜7 文字目）を one-char-bang（1 文字ずつ）に。
    const w = c10.words.slice(6, 8);
    return {
        emphasis_words: [{ id: 'e-0001', src: 'a', t_start: w[0].start, t_end: w[1].end, word: '発見', emotion: 'surprise', style_hint: 'one-char-bang' }],
        captions
    };
}
export const SECONDS = ROWS.length * STEP;

export function buildOverlapCaptions() {
    const row = (id, text, zone, anim) => ({
        id, start: 0, end: CUE_SECONDS, text, speaker: null, sourceRef: null, edited: false, words: timed(text, 0, CUE_SECONDS),
        text_style: { zone, ...(anim ? { animation: { in: { id: anim }, out: { id: anim } } } : {}) }
    });
    return { captions: [row('o-top', '上の字幕は回る', 'top', 'spin-in'), row('o-mid', '中の字幕は動かない', 'center', null), row('o-bottom', '下の字幕は上へ', 'bottom', 'fade-up')] };
}

if (import.meta.url === `file://${process.argv[1]}`) {
    const GPU = process.argv.includes('--gpu');
    const OVERLAP = process.argv.includes('--overlap');
    const OUT = path.resolve(process.argv.slice(2).find(v => !v.startsWith('--')) ?? path.join(os.tmpdir(), 'preview-caption-textanim-l1', OVERLAP ? 'fixture-overlap' : GPU ? 'fixture-gpu' : 'fixture'));
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
    await writeFile(path.join(dir, 'captions.json'), `${JSON.stringify(OVERLAP ? buildOverlapCaptions() : buildCaptions({ gpu: GPU }), null, 2)}\n`);
    const edit = {
        version: 2, output: { width: 1280, height: 720, fps: FPS }, sources: [{ id: 'a', path: 'assets/base.mp4' }],
        tracks: [
            { id: 'v-main', lane: 'visual', name: 'Base', items: [{ id: 'cut-base', at: 0, duration: SECONDS * FPS, source: { kind: 'media', src: 'a', in: 0, out: SECONDS, speed: 1 } }] },
            { id: 'v-captions', lane: 'visual', name: '字幕', items: [{ id: 'captions', name: '字幕', at: 0, duration: SECONDS * FPS, source: { kind: 'captions', path: 'captions.json' }, items: [] }] }
        ]
    };
    await writeFile(path.join(dir, 'edit.json'), `${JSON.stringify(edit, null, 2)}\n`);
    run('/usr/bin/git', ['init', '-q'], dir);
    run('/usr/bin/git', ['config', 'user.email', 'pct-fixture@localhost'], dir);
    run('/usr/bin/git', ['config', 'user.name', 'pct fixture'], dir);
    run('/usr/bin/git', ['add', '-A'], dir);
    run('/usr/bin/git', ['commit', '-q', '-m', 'fixture'], dir);
    console.log(JSON.stringify({ project: '<tmp>/project', rows: ROWS.length, seconds: SECONDS }));
}
