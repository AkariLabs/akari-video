#!/usr/bin/env node
// 台本の置いた文字（出力時間軸の字幕）の L1 用 fixture を作る。
// 話した言葉 8 行（4 秒刻み・行の間に 0.8 秒の無音）+ 置いた文字 4 本
// （全体 1・3 行 1・1 行だけ 1・2 行 1。3 行と 2 行は重ならない）と、置いた文字 0 本の対照。
// 出力先はリポの外（引数 1 つ目。既定は OS の一時ディレクトリ）。映像は ffmpeg で生成する（L1 専用。単体テストは使わない）。
import { spawn } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const OUT = path.resolve(process.argv[2] ?? path.join(os.tmpdir(), 'daihon-bar-handles-l1', 'fixture'));
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

const SPOKEN = [
    '今日は朝のルーティンを紹介します', 'まずはコーヒーを淹れるところから', '豆は挽きたてが一番おいしい',
    'お湯は少し冷ましてから注ぎます', '蒸らしは 30 秒くらい', 'その間にデスクを片付けます',
    'パソコンを開いて今日の予定を確認', '最後にチャンネル登録お願いします'
];
export const PLACED = [
    { id: 'p-a', start: 0, end: 32, text: 'MORNING ROUTINE', expect: { first: 0, last: 7 } },
    { id: 'p-b', start: 4, end: 15.2, text: '豆: エチオピア 浅煎り', expect: { first: 1, last: 3 } },
    { id: 'p-c', start: 16.2, end: 19, text: '蒸らし 30 秒', expect: { first: 4, last: 4 } },
    { id: 'p-d', start: 20, end: 27.2, text: '今日の予定', expect: { first: 5, last: 6 } }
];

function spoken() {
    return SPOKEN.map((text, index) => ({
        id: `s-${index + 1}`, start: index * 4, end: Math.round((index * 4 + 3.2) * 1000) / 1000,
        text, speaker: null, sourceRef: { segment: index }, edited: false
    }));
}

async function project(name, withPlaced) {
    const dir = path.join(OUT, name);
    await rm(dir, { recursive: true, force: true });
    await mkdir(path.join(dir, 'assets'), { recursive: true });
    await run(FFMPEG, ['-hide_banner', '-loglevel', 'error',
        '-f', 'lavfi', '-i', `color=c=#27313f:s=320x180:r=${FPS}`,
        '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=mono',
        '-t', String(SECONDS), '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '42', '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-shortest', '-movflags', '+faststart', path.join(dir, 'assets', 'base.mp4')], dir);
    const placed = withPlaced ? PLACED.map(({ expect: _expect, ...caption }) => ({
        ...caption, speaker: null, sourceRef: null, edited: false, time_domain: 'output'
    })) : [];
    // 置いた文字は話した言葉の行のあいだに混ぜて書く（行の並びから外れることを見る）。
    const rows = spoken();
    const captions = withPlaced
        ? [rows[0], placed[0], rows[1], placed[1], rows[2], rows[3], rows[4], placed[2], rows[5], placed[3], rows[6], rows[7]]
        : rows;
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
    await run('/usr/bin/git', ['config', 'user.email', 'dbh-fixture@localhost'], dir);
    await run('/usr/bin/git', ['config', 'user.name', 'dbh fixture'], dir);
    await run('/usr/bin/git', ['add', '-A'], dir);
    await run('/usr/bin/git', ['commit', '-q', '-m', 'fixture'], dir);
    return { name, dir, captions: captions.length };
}

if (import.meta.url === `file://${process.argv[1]}`) {
    const made = [await project('placed', true), await project('none', false)];
    process.stdout.write(`${JSON.stringify({ ok: true, made: made.map(({ name, captions }) => ({ name, captions })) })}\n`);
}
