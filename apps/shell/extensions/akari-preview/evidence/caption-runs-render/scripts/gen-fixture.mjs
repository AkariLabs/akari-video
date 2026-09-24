#!/usr/bin/env node
// 字幕の文字範囲（runs）の L1 fixture（ラッパー作成の検証用素材）。
// 使い方: node gen-fixture.mjs [--runs] [出力先]（既定は OS の一時ディレクトリ）
//   --runs なし = BEFORE 用（runs を書かない。変更前のビルドはスキーマに無い runs を拒むため）
//   --runs あり = AFTER 用（同じ字幕に手で runs を書く）
// 2 秒刻みに 1 本ずつ（重ならない）。映像は ffmpeg で作る（L1 専用。単体テストは使わない）。
//   c-0001 「これは最高のアイデアです」— 最高 = 赤・1.3 倍・太字 900・上へ 0.1em・8° / アイデア = 字間 0.05em
//   c-0002 手動の改行（display_fragments）をまたぐ run（天気は|晴れ = 水色・1.2 倍）
//   c-0003 絵文字（🍻 と肌色つき 👍🏽）の run（1.3 倍）と結合文字（か + U+3099）の run（シアン・下線）
//   c-0004 run の動き（一番 = 紫・loop float）
//   c-0005 強調 emphasis_words（one-char-bang = 1 文字ずつ）/ c-0006 強調（emphasis-red）
//   c-0007 1 文字ずつ動く animator（basis chars）— --animator で c-0007 だけの別 fixture（字幕アイテムに animator）
//   c-0008 runs も強調も無い字幕（不変の比較用）
//   c-0009 / c-0010 折り返しで 2 行が同時に見える長い字幕（日本語 / 空白を含む英語）の、行をまたぐ run（橙）
import { spawnSync } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const RUNS = process.argv.includes('--runs');
const ANIMATOR = process.argv.includes('--animator');
const OUT = path.resolve(process.argv.slice(2).find(v => !v.startsWith('--')) ?? path.join(os.tmpdir(), 'caption-runs-render-l1', ANIMATOR ? 'fixture-animator' : RUNS ? 'fixture-runs' : 'fixture'));
const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const FPS = 30, STEP = 2, SECONDS = 20;
const run = (command, args, cwd) => {
    const result = spawnSync(command, args, { cwd, encoding: 'utf8' });
    if (result.status !== 0) throw new Error(`${command} failed: ${result.stderr}`);
};
const round = value => Math.round(value * 1000) / 1000;
// 文字数に比例して cue の区間を単語へ配る（隙間なし）。
function timed(tokens, start, end) {
    const weights = tokens.map(token => Math.max(1, Array.from(token.trim()).length));
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    let cursor = start;
    return tokens.map((text, index) => {
        const wordStart = round(cursor);
        cursor += (end - start) * weights[index] / total;
        return { start: wordStart, end: index === tokens.length - 1 ? end : round(cursor), text };
    });
}

export const COLORS = { red: '#ff5a5f', sky: '#4fc3f7', cyan: '#00e5ff', purple: '#b388ff', orange: '#ffa726' };
export const RUNS_BY_ID = {
    'c-0001': [
        { from: 3, to: 5, role: 'emphasis', style: { color: COLORS.red, font_weight: 900, scale: 1.3, baseline_shift_em: -0.1, rotate_deg: 8 } },
        { from: 6, to: 10, role: 'keyword', style: { letter_spacing_em: 0.05 } }
    ],
    'c-0002': [{ from: 3, to: 8, style: { color: COLORS.sky, scale: 1.2 } }],
    'c-0003': [
        { from: 2, to: 4, style: { scale: 1.3 } },
        { from: 7, to: 8, style: { color: COLORS.cyan, underline: true } }
    ],
    'c-0004': [{ from: 3, to: 5, style: { color: COLORS.purple }, animation: { loop: { id: 'float' } } }],
    // 折り返しで 2 行が同時に見える字幕の、行をまたぐ run（日本語 / 空白を含む英語）
    'c-0009': [{ from: 14, to: 34, style: { color: COLORS.orange, scale: 1.15 } }],
    'c-0010': [{ from: 40, to: 70, style: { color: COLORS.orange, letter_spacing_em: 0.05 } }]
};
export const ROWS = [
    ['c-0001', ['これ', 'は', '最高', 'の', 'アイデア', 'です']],
    ['c-0002', ['今日', 'の', '天気', 'は', '晴れ', 'のち', '曇り', 'です'], { display_fragments: ['今日の天気は', '晴れのち曇りです'] }],
    ['c-0003', ['乾杯', '🍻👍🏽', 'みんな', 'が', '来た']],
    ['c-0004', ['ここ', 'が', '一番', 'の', 'ポイント']],
    ['c-0005', ['これ', 'は', 'すごい', '発見', 'です']],
    ['c-0006', ['ここ', 'は', '大事', 'な', 'ところ', 'です']],
    ['c-0007', ['一文字', 'ずつ', '動く', '字幕']],
    ['c-0008', ['ふつう', 'の', '字幕', 'です']],
    ['c-0009', ['その', '間', 'に', 'デスク', 'の', '上', 'を', 'さっと', '片付けて', '気分', 'を', '切り替えて', 'から', '今日', 'いちばん', '大事', 'な', '作業', 'を', '一つ', 'だけ', '決めて', 'おきます']],
    ['c-0010', ['The', ' quick', ' brown', ' fox', ' jumps', ' over', ' the', ' lazy', ' dog', ' and', ' then', ' keeps', ' running', ' far', ' away', ' from', ' here']]
];

export function buildCaptions(withRuns) {
    const words = {};
    const captions = ROWS.map(([id, tokens, extra], index) => {
        const start = index * STEP, end = round(index * STEP + STEP - 0.2);
        const w = timed(tokens, start, end);
        words[id] = w;
        return {
            id, start, end, text: tokens.join(''), speaker: null, sourceRef: null, edited: false, words: w,
            ...(extra ?? {}),
            ...(withRuns && RUNS_BY_ID[id] ? { runs: RUNS_BY_ID[id] } : {})
        };
    });
    const emphasis = (eid, word, preset) => ({ id: eid, src: 'a', t_start: word.start, t_end: word.end, word: word.text, emotion: 'emphasis', style_preset: preset });
    return {
        emphasis_words: [
            emphasis('e-0001', words['c-0005'][2], 'one-char-bang'),
            emphasis('e-0002', words['c-0006'][2], 'emphasis-red')
        ],
        captions
    };
}

if (import.meta.url === `file://${process.argv[1]}`) {
    const dir = path.join(OUT, 'project');
    await rm(dir, { recursive: true, force: true });
    await mkdir(path.join(dir, 'assets'), { recursive: true });
    run(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
        '-f', 'lavfi', '-i', `color=c=0x27313f:size=1280x720:rate=${FPS}:duration=${SECONDS}`,
        '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', path.join(dir, 'assets', 'base.mp4')], dir);
    const root = buildCaptions(RUNS);
    // c-0007（animator）は字幕アイテム全体に掛かり、子の caption アイテムに付けると GPU 書き出しが拒否するため、
    // --animator のときだけ c-0007 1 本の別 fixture を作り、字幕アイテムに animator を付ける。本 fixture からは外す。
    const captions = root.captions.filter(c => ANIMATOR ? c.id === 'c-0007' : c.id !== 'c-0007');
    await writeFile(path.join(dir, 'captions.json'), `${JSON.stringify(ANIMATOR ? { captions } : { ...root, captions }, null, 2)}\n`);
    const edit = {
        version: 2, output: { width: 1280, height: 720, fps: FPS }, sources: [{ id: 'a', path: 'assets/base.mp4' }],
        tracks: [
            { id: 'v-main', lane: 'visual', name: 'Base', items: [{ id: 'cut-base', at: 0, duration: SECONDS * FPS, source: { kind: 'media', src: 'a', in: 0, out: SECONDS, speed: 1 } }] },
            { id: 'v-captions', lane: 'visual', name: '字幕', items: [{
                id: 'captions', name: '字幕', at: 0, duration: SECONDS * FPS, source: { kind: 'captions', path: 'captions.json' }, items: [],
                ...(ANIMATOR ? { animator: [{ id: 'a1', basis: 'chars', shape: 'triangle', start: 0, end: 1, offset: 0, amount: { y: -18, rotate: 10 } }] } : {})
            }] }
        ]
    };
    await writeFile(path.join(dir, 'edit.json'), `${JSON.stringify(edit, null, 2)}\n`);
    run('/usr/bin/git', ['init', '-q'], dir);
    run('/usr/bin/git', ['config', 'user.email', 'crr-fixture@localhost'], dir);
    run('/usr/bin/git', ['config', 'user.name', 'crr fixture'], dir);
    run('/usr/bin/git', ['add', '-A'], dir);
    run('/usr/bin/git', ['commit', '-q', '-m', 'fixture'], dir);
    console.log(JSON.stringify({ project: dir, rows: captions.length, runs: RUNS, animator: ANIMATOR }));
}
