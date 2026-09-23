#!/usr/bin/env node
// 効果（袋文字 / なし）が書き出しでも描かれるかを 1 フレームで測る（ラッパー作成の検証スクリプト）。
// 使い方: node export-frame.mjs [fixture dir]
// results-after.json の「効果 / 効果の色」（袋文字 + 効果の色 #E02020）と「効果 / なし」の保存値（インスペクターの実操作で
// captions.json に書かれた text_style そのもの）を、fixture の映像の先頭 3 秒 + 字幕 1 本だけの一時プロジェクトに置き、
// render-cut で MP4 へ書き出して 1.5 秒のフレームの赤い画素（縁取りの色 #E02020 付近）を数える。L1 専用（単体テストでは使わない）。
import { spawnSync } from 'node:child_process';
import { cp, readFile, rm, writeFile, realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const EVIDENCE = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REPO = path.resolve(EVIDENCE, '..', '..', '..', '..', '..', '..');
const TMP = path.join(os.tmpdir(), 'inspector-caption-style-panel-l1');
const FIXTURE_SRC = path.resolve(process.argv[2] ?? path.join(TMP, 'fixture'));
const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const ELECTRON = path.join(REPO, 'apps/shell/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
const W = 1280, H = 720, T = 1.5;

const results = JSON.parse(await readFile(path.join(EVIDENCE, 'results-after.json'), 'utf8'));
const styleOf = field => {
    const record = results.writes.find(w => w.field === field);
    if (!record) throw new Error(`results-after.json に「${field}」の記録がありません`);
    return record.text_style;
};
const variants = [
    { name: 'outline', label: '効果 = 袋文字（効果の色 #E02020）', text_style: styleOf('効果 / 効果の色') },
    { name: 'none', label: '効果 = なし', text_style: styleOf('効果 / なし') }
];
const measured = { frameAtSeconds: T, variants: [] };
for (const variant of variants) {
    const work = path.join(TMP, `export-${variant.name}`);
    await rm(work, { recursive: true, force: true });
    await cp(FIXTURE_SRC, work, { recursive: true });
    const project = await realpath(work);
    const root = { default_text_style: { zone: 'bottom' }, captions: [{ id: 'c-0001', start: 0, end: 3, text: '今日は朝のルーティンを紹介します',
        speaker: null, sourceRef: { segment: 1 }, edited: false, text_style: variant.text_style }] };
    await writeFile(path.join(project, 'captions.json'), `${JSON.stringify(root, null, 2)}\n`);
    const editFile = path.join(project, 'edit.json');
    const edit = JSON.parse(await readFile(editFile, 'utf8'));
    for (const track of edit.tracks) for (const item of track.items) {
        item.duration = 3 * edit.output.fps;
        if (item.source.kind === 'media') item.source.out = 3;
    }
    await writeFile(editFile, `${JSON.stringify(edit, null, 2)}\n`);
    const out = path.join(project, 'exports', 'out.mp4');
    const started = Date.now();
    const render = spawnSync(process.execPath, [path.join(REPO, 'packages', 'render-cut', 'bin', 'render-cut.mjs'), project, '--force', '--no-verify-blank', '--out', out],
        { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 900_000, killSignal: 'SIGKILL', env: { ...process.env, AKARI_OSR_ELECTRON: ELECTRON } });
    if (render.status !== 0) throw new Error(`render-cut exit ${render.status}: ${(render.stderr || render.stdout).slice(-2000)}`);
    const renderJson = JSON.parse(await readFile(path.join(project, '.akari', 'render.json'), 'utf8'));
    const frame = spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-ss', String(T), '-i', out, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: W * H * 4 });
    if (frame.status !== 0 || frame.stdout.length !== W * H * 3) throw new Error(`frame extract failed: ${frame.stderr?.toString()}`);
    const png = path.join(EVIDENCE, `after-export-${variant.name}.png`);
    spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-ss', String(T), '-i', out, '-frames:v', '1', '-vf', 'scale=640:-2', png]);
    let red = 0, yellow = 0;
    for (let i = 0; i < W * H; i++) {
        const r = frame.stdout[i * 3], g = frame.stdout[i * 3 + 1], b = frame.stdout[i * 3 + 2];
        if (r > 170 && g < 90 && b < 90) red++;
        if (r > 200 && g > 170 && b < 90) yellow++;
    }
    measured.variants.push({
        name: variant.name, label: variant.label, text_style: variant.text_style, renderSeconds: Math.round((Date.now() - started) / 1000),
        rasterizer: renderJson.provenance?.rasterizer?.selected ?? renderJson.provenance?.rasterizer ?? null,
        verify: renderJson.verify?.verdict ?? renderJson.verify?.status ?? null,
        redStrokePixels: red, yellowTextPixels: yellow, screenshot: path.basename(png)
    });
}
const [outline, none] = measured.variants;
measured.pass = outline.redStrokePixels > 1000 && none.redStrokePixels < 50 && outline.yellowTextPixels > 500 && none.yellowTextPixels > 500;
await writeFile(path.join(EVIDENCE, 'export-after.json'), `${JSON.stringify(measured, null, 2)}\n`);
console.log(JSON.stringify(measured));
