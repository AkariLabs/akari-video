#!/usr/bin/env node
// preview-selection-sync の L1 fixture（ラッパー作成の検証用。リポの外に出力する）。
// sel      = (a)(b) 用: 0〜3 秒に 字幕A・置いた文字A・写真A・HTML A・図形A、5〜9 秒に 字幕B・置いた文字B・写真B・HTML B・図形B
// z-plain  = (c) 用: V7 に図形（中央）、その上の V8 に B ロールの画像（中央 50%）。group 字幕なし
// z-group  = (c) 用: z-plain + キャンバス（group）の中に字幕（resolvePreviewItemStackOrder が効く木）
// z-multi  = (c) 用: z-plain + 本編の 2 カットが 5〜7 秒でディゾルブ（複数 cut が同時に見える）
import { spawnSync } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const OUT = path.resolve(process.argv[2]);
const FPS = 30, SECONDS = 12;
const run = (command, args, cwd) => {
    const result = spawnSync(command, args, { cwd, encoding: 'utf8' });
    if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed: ${result.stderr}`);
};
const color = (dir, name, c, w, h, seconds) => run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
    '-f', 'lavfi', '-i', `color=c=${c}:size=${w}x${h}:rate=${FPS}${seconds ? `:duration=${seconds}` : ''}`,
    ...(seconds ? ['-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-movflags', '+faststart']
        : ['-frames:v', '1']),
    path.join(dir, 'assets', name)], dir);
const f = s => Math.round(s * FPS);
const html = (id, x, y, w, h, bg, label) => `<div style="position:absolute;left:${x}px;top:${y}px;width:${w}px;height:${h}px;background:${bg};color:white;font:28px sans-serif;display:flex;align-items:center;justify-content:center">${label}</div>\n`;
const shape = (id, at, dur, x, y, w, h, fill) => ({ id, at: f(at), duration: f(dur), transform: { x, y },
    source: { kind: 'shape', shape: 'rect', params: { fill, stroke: 'none', strokeWidth: 0, width: w, height: h } } });
const media = (id, src, at, dur, transform, extra = {}) => ({ id, at: f(at), duration: f(dur), ...(transform ? { transform } : {}),
    source: { kind: 'media', src, in: 0, out: dur, ...extra } });
const track = (id, name, items) => ({ id, lane: 'visual', name, items });

async function base(name) {
    const dir = path.join(OUT, name);
    await rm(dir, { recursive: true, force: true });
    await mkdir(path.join(dir, 'assets'), { recursive: true });
    await mkdir(path.join(dir, 'overlays'), { recursive: true });
    await mkdir(path.join(dir, '.akari'), { recursive: true });
    color(dir, 'base.mp4', '0x27313f', 1280, 720, SECONDS);
    return dir;
}
async function finish(dir, edit, captions) {
    if (captions) await writeFile(path.join(dir, 'captions.json'), `${JSON.stringify({ default_text_style: { zone: 'bottom' }, captions }, null, 2)}\n`);
    await writeFile(path.join(dir, 'edit.json'), `${JSON.stringify({ version: 2, output: { width: 1280, height: 720, fps: FPS }, ...edit }, null, 2)}\n`);
    await writeFile(path.join(dir, '.akari', 'lint.json'), '{"version":1,"verdict":"pass"}\n');
    run('/usr/bin/git', ['init', '-q'], dir);
    run('/usr/bin/git', ['config', 'user.email', 'pss-fixture@localhost'], dir);
    run('/usr/bin/git', ['config', 'user.name', 'pss fixture'], dir);
    run('/usr/bin/git', ['add', '-A'], dir);
    run('/usr/bin/git', ['commit', '-q', '-m', 'fixture'], dir);
    return dir;
}
const cap = (id, start, end, text, extra = {}) => ({ id, start, end, text, speaker: null, sourceRef: null, edited: false, src: 'base', ...extra });
const placed = (id, start, end, text, x, y) => cap(id, start, end, text, { time_domain: 'output', text_style: { position: { x, y }, size_px: 40, color: '#ffe14d' } });

const result = {};
{
    const dir = await base('sel');
    color(dir, 'photo-a.png', 'red', 1280, 720);
    color(dir, 'photo-b.png', 'green', 1280, 720);
    await writeFile(path.join(dir, 'overlays', 'html-a.html'), html('a', 900, 60, 260, 120, '#8a3ec8', 'HTML A'));
    await writeFile(path.join(dir, 'overlays', 'html-b.html'), html('b', 900, 250, 260, 120, '#c83e8a', 'HTML B'));
    result.sel = await finish(dir, {
        sources: [{ id: 'base', path: 'assets/base.mp4' }, { id: 'photo-a', path: 'assets/photo-a.png' }, { id: 'photo-b', path: 'assets/photo-b.png' }],
        tracks: [
            track('v-base', 'Base', [media('cut-base', 'base', 0, SECONDS)]),
            track('v-photo', '写真', [media('photo-a-item', 'photo-a', 0, 3, { x: -420, y: -200, scale: 0.25 }),
                media('photo-b-item', 'photo-b', 5, 4, { x: -420, y: 60, scale: 0.25 })]),
            track('v-shape', '図形', [shape('shape-a', 0, 3, 420, 180, 200, 120, '#2f7de1'), shape('shape-b', 5, 4, 420, 380, 200, 120, '#e18a2f')]),
            track('v-html', 'HTML', [{ id: 'html-a-item', at: 0, duration: f(3), source: { kind: 'html', path: 'overlays/html-a.html' } },
                { id: 'html-b-item', at: f(5), duration: f(4), source: { kind: 'html', path: 'overlays/html-b.html' } }]),
            track('v-captions', '字幕', [{ id: 'captions', name: '字幕', at: 0, duration: f(SECONDS), source: { kind: 'captions', path: 'captions.json' } }])
        ]
    }, [cap('c-0001', 0, 3, '字幕エーの行'), cap('c-0002', 5, 8, '字幕ビーの行'),
        placed('c-0003', 0, 3, '置いた文字エー', 0.5, 0.12), placed('c-0004', 5, 8, '置いた文字ビー', 0.5, 0.3)]);
}
async function zorder(name, variant) {
    const dir = await base(name);
    color(dir, 'broll.png', '0x2fb85a', 1280, 720);
    const tracks = [];
    const sources = [{ id: 'base', path: 'assets/base.mp4' }, { id: 'broll', path: 'assets/broll.png' }];
    if (variant === 'multi') {
        color(dir, 'base2.mp4', '0x3f2731', 1280, 720, SECONDS);
        sources.push({ id: 'base2', path: 'assets/base2.mp4' });
        tracks.push(track('v1', 'V1', [media('cut-1', 'base', 0, 7, null, { transition_out: { type: 'dissolve', duration: 2 } }),
            media('cut-2', 'base2', 5, 7)]));
    } else tracks.push(track('v1', 'V1', [media('cut-1', 'base', 0, SECONDS)]));
    for (let n = 2; n <= 6; n++) tracks.push(track(`v${n}`, `V${n}`, []));
    // 図形 = 中央 480×320 のオレンジ。B ロール = 中央 50%（640×360）の緑 → 図形の中央部分を覆う
    tracks.push(track('v7', 'V7', [shape('shape-z', 0, SECONDS, 700, 200, 480, 320, '#ff8c1a')]));
    tracks.push(track('v8', 'V8', [media('broll-item', 'broll', 0, SECONDS, { x: 0, y: 0, scale: 0.5 })]));
    let captions = null;
    if (variant === 'group') {
        tracks.push(track('v9', 'V9', [{ id: 'g-1', name: 'キャンバス 1', at: 0, duration: f(SECONDS), source: { kind: 'group', canvas: { origin: 'user', durationMode: 'fixed' } },
            items: [{ id: 'g-cap', at: 0, duration: f(SECONDS), source: { kind: 'caption', path: 'captions.json', id: 'c-0001' } }] }]));
        captions = [cap('c-0001', 0, 12, 'キャンバスの中の字幕', { time_domain: 'output' })];
    }
    return finish(dir, { sources, tracks }, captions);
}
result.zPlain = await zorder('z-plain', 'plain');
result.zGroup = await zorder('z-group', 'group');
result.zMulti = await zorder('z-multi', 'multi');
console.log(JSON.stringify(result));
