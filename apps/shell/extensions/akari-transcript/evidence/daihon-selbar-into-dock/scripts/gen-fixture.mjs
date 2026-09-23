#!/usr/bin/env node
// 台本の選択バーのドック統合 L1 用 fixture を作る（daihon-dock-surface の証跡と同じ中身）。
// 話した言葉 8 行（4 秒刻み・各行 3.2 秒・語の時刻つき）+ 置いた文字 2 本（全体 1・2 行 1）。
// 出力先はリポの外（引数 1 つ目。既定は OS の一時ディレクトリ）。映像は ffmpeg で生成する（L1 専用）。
import { spawn } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const OUT = path.resolve(process.argv[2] ?? path.join(os.tmpdir(), 'daihon-selbar-l1', 'fixture'));
const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const FPS = 30;
const SECONDS = 32;
const run = (command, args, cwd) => new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', code => code === 0 ? resolve() : reject(new Error(`${command} failed (${code}): ${stderr.slice(-1200)}`)));
});
const round = value => Math.round(value * 1000) / 1000;

export const SPOKEN = [
    ['今日は', '朝の', 'ルーティンを', '紹介します'], ['まずは', 'コーヒーを', '淹れる', 'ところから'],
    ['豆は', '挽きたてが', '一番', 'おいしい'], ['お湯は', '少し', '冷ましてから', '注ぎます'],
    ['蒸らしは', '30 秒', 'くらい'], ['その間に', 'デスクを', '片付けます'],
    ['パソコンを', '開いて', '今日の', '予定を', '確認'], ['最後に', 'チャンネル', '登録', 'お願いします']
];
export const PLACED = [
    { id: 'c-0101', start: 0, end: 32, text: 'MORNING ROUTINE' },
    { id: 'c-0102', start: 20, end: 27.2, text: '今日の予定' }
];

function spoken() {
    return SPOKEN.map((words, index) => {
        const start = index * 4;
        const step = 3.2 / words.length;
        return {
            id: `c-${String(index + 1).padStart(4, '0')}`, start, end: round(start + 3.2),
            text: words.join(''), speaker: null, sourceRef: { segment: index }, edited: false,
            words: words.map((text, at) => ({ text, start: round(start + at * step), end: round(start + (at + 1) * step - 0.05) }))
        };
    });
}

async function project(name) {
    const dir = path.join(OUT, name);
    await rm(dir, { recursive: true, force: true });
    await mkdir(path.join(dir, 'assets'), { recursive: true });
    await run(FFMPEG, ['-hide_banner', '-loglevel', 'error',
        '-f', 'lavfi', '-i', `color=c=#27313f:s=320x180:r=${FPS}`,
        '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=mono',
        '-t', String(SECONDS), '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '42', '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-shortest', '-movflags', '+faststart', path.join(dir, 'assets', 'base.mp4')], dir);
    const rows = spoken();
    const placed = PLACED.map(caption => ({ ...caption, speaker: null, sourceRef: null, edited: false, time_domain: 'output' }));
    const captions = [rows[0], placed[0], rows[1], rows[2], rows[3], rows[4], placed[1], rows[5], rows[6], rows[7]];
    const edit = {
        version: 2,
        output: { width: 320, height: 180, fps: FPS },
        sources: [{ id: 'main', path: 'assets/base.mp4' }],
        tracks: [
            { id: 'v-main', lane: 'visual', items: [{
                id: 'main-clip', at: 0, duration: SECONDS * FPS,
                source: { kind: 'media', src: 'main', in: 0, out: SECONDS }
            }] },
            { id: 'captions', lane: 'visual', content: { from: 'captions.json' } }
        ]
    };
    await writeFile(path.join(dir, 'captions.json'), `${JSON.stringify(captions, null, 2)}\n`);
    await writeFile(path.join(dir, 'edit.json'), `${JSON.stringify(edit, null, 2)}\n`);
    await run('/usr/bin/git', ['init', '-q'], dir);
    await run('/usr/bin/git', ['config', 'user.email', 'daihon-selbar-fixture@localhost'], dir);
    await run('/usr/bin/git', ['config', 'user.name', 'daihon-selbar fixture'], dir);
    await run('/usr/bin/git', ['add', '-A'], dir);
    await run('/usr/bin/git', ['commit', '-q', '-m', 'fixture'], dir);
    return { name, captions: captions.length };
}

if (import.meta.url === `file://${process.argv[1]}`) {
    const made = [await project('dock')];
    process.stdout.write(`${JSON.stringify({ ok: true, made })}\n`);
}
