#!/usr/bin/env node
// インスペクターの書き込み先の L1 fixture（ラッパー作成の検証用素材）。出力先はリポの外（引数 1 つ目。既定は OS の一時ディレクトリ）。
// 4 案件を作る:
//   two          = タイムライン 2 本（edit.json + captions.json / edit.short.json + captions.short.json）。
//                  c-0001 は両方のファイルにある（同じ id・別の文）= 書き先の取り違えが黙って起きるかを見る。c-0002 / c-0101（置いた文字）は edit.json 側だけ
//   one          = タイムライン 1 本（回帰の基準）
//   zero-missing = captions.json が無い（台本 0 行）
//   zero-empty   = captions.json が空（{"captions": []}）
//   zero-two     = captions.json が無い + タイムライン 2 本（edit.json / edit.short.json。どちらも字幕なし）
// 映像は ffmpeg で作る（L1 専用。単体テストは使わない）。
import { spawnSync } from 'node:child_process';
import { mkdir, rm, writeFile, copyFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const OUT = path.resolve(process.argv[2] ?? path.join(os.tmpdir(), 'inspector-write-owner-l1', 'fixtures'));
const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const FPS = 30, SECONDS = 20;
const run = (command, args, cwd) => {
    const result = spawnSync(command, args, { cwd, encoding: 'utf8' });
    if (result.status !== 0) throw new Error(`${command} failed: ${result.stderr}`);
};
const json = value => `${JSON.stringify(value, null, 2)}\n`;
const spoken = (id, start, text, extra = {}) => ({
    id, start, end: start + 3.2, text, speaker: null, sourceRef: { segment: Number(id.slice(-2)) }, edited: false, ...extra
});
const placed = (id, start, text) => ({
    id, start, end: start + 3.2, text, time_domain: 'output', sourceRef: null, edited: true, speaker: null,
    text_style: { position: { y: 0.4625 }, text_anchor: 'tc' }
});
const edit = captionsPath => ({
    version: 2, output: { width: 1280, height: 720, fps: FPS }, sources: [{ id: 'a', path: 'assets/base.mp4' }],
    tracks: [
        { id: 'v-main', lane: 'visual', name: 'Base', items: [{ id: 'cut-base', at: 0, duration: SECONDS * FPS, source: { kind: 'media', src: 'a', in: 0, out: SECONDS, speed: 1 } }] },
        ...(captionsPath ? [{ id: 'v-captions', lane: 'visual', name: '字幕', items: [{ id: 'captions', name: '字幕', at: 0, duration: SECONDS * FPS, source: { kind: 'captions', path: captionsPath }, items: [] }] }] : [])
    ]
});

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });
const video = path.join(OUT, 'base.mp4');
run(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
    '-f', 'lavfi', '-i', `color=c=0x5b7288:size=1280x720:rate=${FPS}:duration=${SECONDS}`,
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', video], OUT);

async function project(name, files) {
    const dir = path.join(OUT, name);
    await mkdir(path.join(dir, 'assets'), { recursive: true });
    await copyFile(video, path.join(dir, 'assets', 'base.mp4'));
    for (const [file, value] of Object.entries(files)) await writeFile(path.join(dir, file), json(value));
    run('/usr/bin/git', ['init', '-q'], dir);
    run('/usr/bin/git', ['config', 'user.email', 'iwo-fixture@localhost'], dir);
    run('/usr/bin/git', ['config', 'user.name', 'iwo fixture'], dir);
    run('/usr/bin/git', ['add', '-A'], dir);
    run('/usr/bin/git', ['commit', '-q', '-m', 'fixture'], dir);
    return dir;
}

const mainCaptions = {
    default_text_style: { zone: 'bottom' },
    captions: [
        spoken('c-0001', 0, '本編の一本目です'),
        spoken('c-0002', 4, '本編の二本目です'),
        placed('c-0101', 8, '本編に置いた文字')
    ]
};
const shortCaptions = {
    default_text_style: { zone: 'bottom' },
    captions: [
        spoken('c-0001', 0, 'ショートの一本目'),
        spoken('s-0002', 4, 'ショートの二本目'),
        placed('s-0101', 8, 'ショートに置いた文字')
    ]
};
await project('two', {
    'edit.json': edit('captions.json'), 'captions.json': mainCaptions,
    'edit.short.json': edit('captions.json') /* スラグ付きの edit も字幕トラックは captions.json と書く（実体は captions.short.json） */, 'captions.short.json': shortCaptions
});
await project('one', { 'edit.json': edit('captions.json'), 'captions.json': mainCaptions });
await project('zero-missing', { 'edit.json': edit(undefined) });
await project('zero-empty', { 'edit.json': edit(undefined), 'captions.json': { captions: [] } });
await project('zero-two', { 'edit.json': edit(undefined), 'edit.short.json': edit(undefined) });
await rm(video, { force: true });
console.log(JSON.stringify({ fixtures: OUT, projects: ['two', 'one', 'zero-missing', 'zero-empty', 'zero-two'] }));
