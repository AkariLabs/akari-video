#!/usr/bin/env node
// gpu-track-z-order の L1 fixture（osr-track-z-order の fixture に GPU で書き出せる e-gpu / g を足した写し。ラッパー作成の検証用。リポの外に出力する）。1280×720・30fps。
// a      : V1 本編・V2 図形（橙 x700〜1180 / y200〜520）・V3 B ロール写真（緑・中央 50% = x320〜960 / y180〜540）→ 重なりは写真が手前
// a-rev  : a の V2 と V3 を入れ替え（図形が手前）— 対照
// b      : a の図形を字幕 item（置いた文字 c-0002・袋は exclude）に置き換え。袋は V4（話した言葉 c-0001）
// c      : V2 字幕の袋（話した言葉 c-0001・下）・V3 写真（下半分 x320〜960 / y360〜720）→ 字幕は写真に隠れる
// d      : V2 ブレンド multiply の HTML（桃 x100〜1180 / y250〜470）・V3 写真（中央）→ 写真は乗算されない
// d-top  : d の V2 と V3 を入れ替え（multiply が一番上）— 今の見え方の対照
// e      : ふつうの案件（写真 V2・図形 V3・HTML V4・字幕の袋 V5 = 全部映像の上）8 秒（図形があるので GPU は不適格）
// e-gpu  : e から図形を抜いた GPU で書き出せるふつうの案件（写真 V2・HTML V4・字幕の袋 V5 = 帯 1 つ）8 秒
// d-<mode> / d-top-<mode>: d / d-top の multiply を他のブレンド（screen / add / difference / darken / lighten / overlay / hardlight / softlight）に替えた対照（引数 --blend-only のときはこれだけを作る）
// g      : 複数帯で overlay が多い GPU の案件（字幕の袋 V2 に 0.04 秒ずつの cue 200 個・写真 V3 下半分・HTML V4）8 秒
import { spawnSync } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const OUT = path.resolve(process.argv[2]);
const BLEND_ONLY = process.argv.includes('--blend-only');
const FPS = 30;
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
const box = (x, y, w, h, bg, label) => `<div style="position:absolute;left:${x}px;top:${y}px;width:${w}px;height:${h}px;background:${bg};color:white;font:28px sans-serif;display:flex;align-items:center;justify-content:center">${label}</div>\n`;
const shape = (id, at, dur, x, y, w, h, fill) => ({ id, at: f(at), duration: f(dur), transform: { x, y },
    source: { kind: 'shape', shape: 'rect', params: { fill, stroke: 'none', strokeWidth: 0, width: w, height: h } } });
const media = (id, src, at, dur, transform) => ({ id, at: f(at), duration: f(dur), ...(transform ? { transform } : {}),
    source: { kind: 'media', src, in: 0, out: dur } });
const html = (id, at, dur, file, extra = {}) => ({ id, at: f(at), duration: f(dur), ...extra, source: { kind: 'html', path: `overlays/${file}` } });
const bag = (id, dur, exclude) => ({ id, name: '字幕', at: 0, duration: f(dur), source: { kind: 'captions', path: 'captions.json', ...(exclude ? { exclude } : {}) } });
const capItem = (id, captionId, at, dur) => ({ id, at: f(at), duration: f(dur), source: { kind: 'caption', path: 'captions.json', id: captionId } });
const track = (id, name, items) => ({ id, lane: 'visual', name, items });
const cap = (id, start, end, text, extra = {}) => ({ id, start, end, text, speaker: null, sourceRef: null, edited: false, src: 'base', ...extra });
const placed = (id, start, end, text, x, y) => cap(id, start, end, text, { time_domain: 'output', text_style: { position: { x, y }, size_px: 96, color: '#ffe14d' } });

async function base(name, seconds) {
    const dir = path.join(OUT, name);
    await rm(dir, { recursive: true, force: true });
    for (const sub of ['assets', 'overlays', '.akari']) await mkdir(path.join(dir, sub), { recursive: true });
    color(dir, 'base.mp4', '0x27313f', 1280, 720, seconds);
    color(dir, 'broll.png', '0x2fb85a', 1280, 720);
    return dir;
}
async function finish(dir, tracks, captions) {
    if (captions) await writeFile(path.join(dir, 'captions.json'), `${JSON.stringify({ default_text_style: { zone: 'bottom' }, captions }, null, 2)}\n`);
    const sources = [{ id: 'base', path: 'assets/base.mp4' }, { id: 'broll', path: 'assets/broll.png' }];
    await writeFile(path.join(dir, 'edit.json'), `${JSON.stringify({ version: 2, output: { width: 1280, height: 720, fps: FPS }, sources, tracks }, null, 2)}\n`);
    await writeFile(path.join(dir, '.akari', 'lint.json'), '{"version":1,"verdict":"pass"}\n');
    run('/usr/bin/git', ['init', '-q'], dir);
    run('/usr/bin/git', ['config', 'user.email', 'gpu-z-fixture@localhost'], dir);
    run('/usr/bin/git', ['config', 'user.name', 'gpu z fixture'], dir);
    run('/usr/bin/git', ['add', '-A'], dir);
    run('/usr/bin/git', ['commit', '-q', '-m', 'fixture'], dir);
    return dir;
}
const S = 4;
const baseTrack = seconds => track('v1', 'V1', [media('cut-base', 'base', 0, seconds)]);
const brollCenter = () => media('broll-item', 'broll', 0, S, { x: 0, y: 0, scale: 0.5 });
const shapeZ = () => shape('shape-z', 0, S, 700, 200, 480, 320, '#ff8c1a');
const spoken = [cap('c-0001', 0, S, '話した言葉の字幕')];
const result = {};

if (BLEND_ONLY) {
    for (const mode of ['screen', 'add', 'difference', 'darken', 'lighten', 'overlay', 'hardlight', 'softlight']) {
        for (const [name, order] of [[`d-${mode}`, 'under'], [`d-top-${mode}`, 'over']]) {
            const d = await base(name, S);
            await writeFile(path.join(d, 'overlays', 'band.html'), box(100, 250, 1080, 220, 'linear-gradient(90deg,#ff4080,#40c0ff 50%,#f0f0f0)', mode));
            const band = track('v-band', 'V-band', [html('band-item', 0, S, 'band.html', { blend: mode })]);
            const photo = track('v-photo', 'V-photo', [brollCenter()]);
            result[name] = await finish(d, [baseTrack(S), ...(order === 'under' ? [band, photo] : [photo, band])]);
        }
    }
    console.log(JSON.stringify(result));
    process.exit(0);
}
{ const d = await base('a', S); result.a = await finish(d, [baseTrack(S), track('v2', 'V2', [shapeZ()]), track('v3', 'V3', [brollCenter()])]); }
{ const d = await base('a-rev', S); result.aRev = await finish(d, [baseTrack(S), track('v2', 'V2', [brollCenter()]), track('v3', 'V3', [shapeZ()])]); }
{
    const d = await base('b', S);
    result.b = await finish(d, [baseTrack(S), track('v2', 'V2', [capItem('cap-c-0002', 'c-0002', 0, S)]), track('v3', 'V3', [brollCenter()]),
        track('v4', '字幕', [bag('captions', S, ['c-0002'])])],
    [...spoken, placed('c-0002', 0, S, '置いた文字', 0.56, 0.5)]);
}
{
    const d = await base('c', S);
    result.c = await finish(d, [baseTrack(S), track('v2', '字幕', [bag('captions', S)]),
        track('v3', 'V3', [media('broll-item', 'broll', 0, S, { x: 0, y: 180, scale: 0.5 })])], spoken);
}
for (const [name, order] of [['d', 'under'], ['d-top', 'over']]) {
    const d = await base(name, S);
    await writeFile(path.join(d, 'overlays', 'band.html'), box(100, 250, 1080, 220, '#ff4080', 'multiply'));
    const band = track('v-band', 'V-band', [html('band-item', 0, S, 'band.html', { blend: 'multiply' })]);
    const photo = track('v-photo', 'V-photo', [brollCenter()]);
    result[name] = await finish(d, [baseTrack(S), ...(order === 'under' ? [band, photo] : [photo, band])]);
}
{
    const E = 8;
    const d = await base('e', E);
    await writeFile(path.join(d, 'overlays', 'label.html'), box(60, 60, 360, 100, '#3e5ec8', 'HTML'));
    result.e = await finish(d, [baseTrack(E), track('v2', 'V2', [media('broll-item', 'broll', 0, E, { x: -320, y: -180, scale: 0.4 })]),
        track('v3', 'V3', [shape('shape-z', 0, E, 700, 200, 480, 320, '#ff8c1a')]),
        track('v4', 'V4', [html('label-item', 0, E, 'label.html')]),
        track('v5', '字幕', [bag('captions', E)])], [cap('c-0001', 0, E, '話した言葉の字幕')]);
}
{
    // f: (a) と同じ交互の重なり（図形 V2 < 写真 V3）+ 字幕の袋 V4 に 0.04 秒ずつの cue を 200 個（複数帯で overlay が多い案件の性能確認）
    const F = 8;
    const d = await base('f', F);
    const cues = Array.from({ length: 200 }, (_, i) => cap(`c-${String(i + 1).padStart(4, '0')}`, i * 0.04, (i + 1) * 0.04, `字幕 ${i + 1}`));
    result.f = await finish(d, [baseTrack(F), track('v2', 'V2', [shape('shape-z', 0, F, 700, 200, 480, 320, '#ff8c1a')]),
        track('v3', 'V3', [media('broll-item', 'broll', 0, F, { x: 0, y: 0, scale: 0.5 })]), track('v4', '字幕', [bag('captions', F)])], cues);
}
{
    const E = 8;
    const d = await base('e-gpu', E);
    await writeFile(path.join(d, 'overlays', 'label.html'), box(60, 60, 360, 100, '#3e5ec8', 'HTML'));
    result.eGpu = await finish(d, [baseTrack(E), track('v2', 'V2', [media('broll-item', 'broll', 0, E, { x: -320, y: -180, scale: 0.4 })]),
        track('v4', 'V4', [html('label-item', 0, E, 'label.html')]),
        track('v5', '字幕', [bag('captions', E)])], [cap('c-0001', 0, E, '話した言葉の字幕')]);
}
{
    const G = 8;
    const d = await base('g', G);
    await writeFile(path.join(d, 'overlays', 'label.html'), box(60, 60, 360, 100, '#3e5ec8', 'HTML'));
    const cues = Array.from({ length: 200 }, (_, i) => cap(`c-${String(i + 1).padStart(4, '0')}`, i * 0.04, (i + 1) * 0.04, `字幕 ${i + 1}`));
    result.g = await finish(d, [baseTrack(G), track('v2', '字幕', [bag('captions', G)]),
        track('v3', 'V3', [media('broll-item', 'broll', 0, G, { x: 0, y: 180, scale: 0.5 })]),
        track('v4', 'V4', [html('label-item', 0, G, 'label.html')])], cues);
}
console.log(JSON.stringify(result));
