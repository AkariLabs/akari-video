#!/usr/bin/env node
// 台本の添付（HTML オーバーレイ・画像）L1 用 fixture を作る。
// 話した言葉 8 行（4 秒刻み・各行 3.2 秒）の上に:
//   attach: HTML「YouTube ロゴ」（全体）・HTML「下帯: チャプター 1」（3 行）・画像 coffee-beans.png（1 行）
//           + 置いた文字 2 本（全体 1・2 行 1）。置いた文字と添付が同じ列の規則で並ぶかを見る
//   many:   HTML 6 本（すべて先頭行から始まり 2〜7 行にまたがる）= 列 6 本 → 4 本 + 数字に畳む
// 出力先はリポの外（引数 1 つ目。既定は OS の一時ディレクトリ）。映像・画像は ffmpeg で生成する（L1 専用）。
import { spawn } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const OUT = path.resolve(process.argv[2] ?? path.join(os.tmpdir(), 'daihon-attachments-l1', 'fixture'));
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
const PLACED = [
    { id: 'p-a', start: 0, end: 32, text: 'MORNING ROUTINE' },
    { id: 'p-d', start: 20, end: 27.2, text: '今日の予定' }
];
// 秒 → フレーム（edit.json v2 の at / duration はフレーム）。
const f = seconds => Math.round(seconds * FPS);
export const ATTACH = [
    { id: 'ov-logo', name: 'YouTube ロゴ', kind: 'html', path: 'overlays/logo.html', start: 0, end: 32, expect: { first: 0, last: 7 } },
    { id: 'ov-lower', name: '下帯: チャプター 1', kind: 'html', path: 'overlays/lower-third.html', start: 4, end: 15.2, expect: { first: 1, last: 3 } },
    { id: 'img-beans', name: null, kind: 'image', path: 'assets/coffee-beans.png', start: 8, end: 11.2, expect: { first: 2, last: 2 } }
];
export const MANY = Array.from({ length: 6 }, (_, index) => ({
    id: `ov-many-${index + 1}`, name: `帯 ${index + 1}`, kind: 'html', path: 'overlays/lower-third.html',
    start: 0, end: (index + 2) * 4 - 0.8, expect: { first: 0, last: index + 1 }
}));

function spoken() {
    return SPOKEN.map((text, index) => ({
        id: `s-${index + 1}`, start: index * 4, end: Math.round((index * 4 + 3.2) * 1000) / 1000,
        text, speaker: null, sourceRef: { segment: index }, edited: false
    }));
}

const html = title => `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:transparent}` +
    `.b{position:absolute;left:24px;bottom:24px;padding:6px 12px;background:#0b1220cc;color:#fff;font:16px sans-serif;border-radius:6px}</style></head>` +
    `<body><div class="b">${title}</div></body></html>\n`;

async function project(name, attachments, placed) {
    const dir = path.join(OUT, name);
    await rm(dir, { recursive: true, force: true });
    await mkdir(path.join(dir, 'assets'), { recursive: true });
    await mkdir(path.join(dir, 'overlays'), { recursive: true });
    await run(FFMPEG, ['-hide_banner', '-loglevel', 'error',
        '-f', 'lavfi', '-i', `color=c=#27313f:s=320x180:r=${FPS}`,
        '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=mono',
        '-t', String(SECONDS), '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '42', '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-shortest', '-movflags', '+faststart', path.join(dir, 'assets', 'base.mp4')], dir);
    await run(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi',
        '-i', 'gradients=s=160x90:c0=0x6b4226:c1=0xd9b38c:seed=7', '-frames:v', '1', '-y',
        path.join(dir, 'assets', 'coffee-beans.png')], dir);
    await writeFile(path.join(dir, 'overlays', 'logo.html'), html('YouTube'));
    await writeFile(path.join(dir, 'overlays', 'lower-third.html'), html('チャプター 1'));
    const rows = spoken();
    const placedCaptions = placed.map(caption => ({ ...caption, speaker: null, sourceRef: null, edited: false, time_domain: 'output' }));
    const captions = placedCaptions.length
        ? [rows[0], placedCaptions[0], rows[1], rows[2], rows[3], rows[4], placedCaptions[1], rows[5], rows[6], rows[7]]
        : rows;
    const sources = [{ id: 'main', path: 'assets/base.mp4' }];
    if (attachments.some(item => item.kind === 'image')) sources.push({ id: 'beans', path: 'assets/coffee-beans.png' });
    const overlayItems = attachments.map(item => ({
        id: item.id, ...(item.name ? { name: item.name } : {}), at: f(item.start), duration: f(item.end) - f(item.start),
        source: item.kind === 'html'
            ? { kind: 'html', path: item.path }
            : { kind: 'media', src: 'beans', in: 0, out: item.end - item.start }
    }));
    const edit = {
        version: 2,
        output: { width: 320, height: 180, fps: FPS },
        sources,
        tracks: [
            { id: 'v-main', lane: 'visual', items: [{
                id: 'main-clip', at: 0, duration: SECONDS * FPS,
                source: { kind: 'media', src: 'main', in: 0, out: SECONDS }
            }] },
            // v2 は同じトラック内の重なりを許さない（v2.track-no-overlap）ので、添付は 1 本ずつ別トラックに置く。
            ...overlayItems.map(item => ({ id: `v-${item.id}`, lane: 'visual', items: [item] })),
            { id: 'captions', lane: 'visual', content: { from: 'captions.json' } }
        ]
    };
    await writeFile(path.join(dir, 'captions.json'), `${JSON.stringify(captions, null, 2)}\n`);
    await writeFile(path.join(dir, 'edit.json'), `${JSON.stringify(edit, null, 2)}\n`);
    await run('/usr/bin/git', ['init', '-q'], dir);
    await run('/usr/bin/git', ['config', 'user.email', 'daihon-attachments-fixture@localhost'], dir);
    await run('/usr/bin/git', ['config', 'user.name', 'daihon-attachments fixture'], dir);
    await run('/usr/bin/git', ['add', '-A'], dir);
    await run('/usr/bin/git', ['commit', '-q', '-m', 'fixture'], dir);
    return { name, items: overlayItems.length, captions: captions.length };
}

if (import.meta.url === `file://${process.argv[1]}`) {
    const made = [await project('attach', ATTACH, PLACED), await project('many', MANY, [])];
    process.stdout.write(`${JSON.stringify({ ok: true, made })}\n`);
}
