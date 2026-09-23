#!/usr/bin/env node
// 台本で 1 文字直したときに見た目（強調・改行・整文）が保たれるかを見る L1 用 fixture。
// display_policy（2 行同時表示）付きの captions.json に 5 本の cue を置く:
//   c-0001 強調 2 か所（大事・話）/ c-0002 手動の改行（display_fragments 2 断片）/
//   c-0003 整文（display_text）/ c-0004 空白を含む文（Claude Code・強調あり）/
//   c-0005 直す単語そのものに強調（簡単）
// 出力先はリポの外（引数 1 つ目。既定は OS の一時ディレクトリ）。映像は ffmpeg で生成する（L1 専用。単体テストは使わない）。
import { spawn } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const OUT = path.resolve(process.argv[2] ?? path.join(os.tmpdir(), 'dek-style-l1', 'fixture'));
const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const FPS = 30;
const SECONDS = 20;
const run = (command, args, cwd) => new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', code => code === 0 ? resolve() : reject(new Error(`${command} failed (${code}): ${stderr.slice(-1200)}`)));
});

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

// 1 文字だけ直す編集（台本の入力欄の値に対して from → to を 1 回置換する）。
export const EDITS = [
    { id: 'c-0001', from: '今日', to: '明日', note: '強調の無い単語を 1 文字置換（強調 2 か所は別の単語）' },
    { id: 'c-0002', from: '淹れ', to: '入れ', note: '手動の改行（2 断片）の 2 断片目の中で 1 文字置換' },
    { id: 'c-0003', from: 'これが', to: 'それが', note: '整文（display_text）のある cue で 1 文字置換' },
    { id: 'c-0004', from: '毎日', to: '毎朝', note: '空白を含む文（Claude Code に強調）で 1 文字置換' },
    { id: 'c-0005', from: '簡単', to: '簡便', note: '強調の掛かった単語そのものを 1 文字置換' }
];

export function buildCaptions() {
    const c1 = timed(['今日', 'は', 'とても', '大事', 'な', '話', 'を', 'します'], 0.2, 3.6);
    const c2 = timed(['朝', 'の', 'コーヒー', 'は', '挽き', 'たて', 'の', '豆', 'で', '淹れ', 'ます'], 4.2, 7.6);
    const c3 = timed(['えーと', '、', 'これ', 'が', '新しい', '機能', 'です'], 8.2, 11.6);
    const c4 = timed(['Claude', ' Code', ' を', '毎日', '使って', 'います'], 12.2, 15.6);
    const c5 = timed(['この', '方法', 'は', '本当', 'に', '簡単', 'です'], 16.2, 19.6);
    const cue = (id, words, extra = {}) => ({
        id, start: words[0].start, end: words[words.length - 1].end, text: words.map(word => word.text).join(''),
        speaker: null, sourceRef: null, edited: false, words, ...extra
    });
    const captions = [
        cue('c-0001', c1),
        cue('c-0002', c2, { display_fragments: ['朝のコーヒーは', '挽きたての豆で淹れます'] }),
        cue('c-0003', c3, { display_text: 'これが新しい機能です' }),
        cue('c-0004', c4),
        cue('c-0005', c5)
    ];
    const span = (id, from, to, word) => ({
        id, t_start: from.start, t_end: to.end, word, emotion: 'emphasis', style_preset: 'emphasis-red'
    });
    return {
        display_policy: {
            mode: 'single_line_sequential', algorithm: 'a4-ja-two-fragment-v1', unit_metric: 'ascii-half-other-one-v1',
            max_line_units: 14, minimum_fragment_duration_seconds: 0.6, locale: 'ja', lines: 2, wrap: 'multi'
        },
        emphasis_words: [
            span('e-0001', c1[3], c1[3], '大事'),
            span('e-0002', c1[5], c1[5], '話'),
            span('e-0003', c4[0], c4[1], 'Claude Code'),
            span('e-0004', c5[5], c5[5], '簡単')
        ],
        captions
    };
}

async function project() {
    const dir = path.join(OUT, 'project');
    await rm(dir, { recursive: true, force: true });
    await mkdir(path.join(dir, 'assets'), { recursive: true });
    await run(FFMPEG, ['-hide_banner', '-loglevel', 'error',
        '-f', 'lavfi', '-i', `color=c=#27313f:s=1280x720:r=${FPS}`,
        '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=mono',
        '-t', String(SECONDS), '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '42', '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-shortest', '-movflags', '+faststart', path.join(dir, 'assets', 'base.mp4')], dir);
    const root = buildCaptions();
    // 1 cue = 1 行（台本・文字起こしパネルの 1 行書式）。
    const lines = root.captions.map(caption => `    ${JSON.stringify(caption)}`).join(',\n');
    const head = { display_policy: root.display_policy, emphasis_words: root.emphasis_words };
    const headText = JSON.stringify(head, null, 2).replace(/\n\}$/u, '');
    await writeFile(path.join(dir, 'captions.json'), `${headText},\n  "captions": [\n${lines}\n  ]\n}\n`);
    const edit = {
        version: 2,
        output: { width: 1280, height: 720, fps: FPS },
        sources: [{ id: 'main', path: 'assets/base.mp4' }],
        tracks: [
            { id: 'v-main', lane: 'visual', items: [{
                id: 'main-clip', at: 0, duration: SECONDS * FPS,
                source: { kind: 'media', src: 'main', in: 0, out: SECONDS }
            }] },
            { id: 'captions', lane: 'visual', content: { from: 'captions.json' } }
        ]
    };
    await writeFile(path.join(dir, 'edit.json'), `${JSON.stringify(edit, null, 2)}\n`);
    await run('/usr/bin/git', ['init', '-q'], dir);
    await run('/usr/bin/git', ['config', 'user.email', 'dek-style-fixture@localhost'], dir);
    await run('/usr/bin/git', ['config', 'user.name', 'daihon-edit-keeps-style fixture'], dir);
    await run('/usr/bin/git', ['add', '-A'], dir);
    await run('/usr/bin/git', ['commit', '-q', '-m', 'fixture'], dir);
    return dir;
}

if (import.meta.url === `file://${process.argv[1]}`) {
    const dir = await project();
    process.stdout.write(`${JSON.stringify({ ok: true, captions: buildCaptions().captions.length, dir: path.basename(dir) })}\n`);
}
