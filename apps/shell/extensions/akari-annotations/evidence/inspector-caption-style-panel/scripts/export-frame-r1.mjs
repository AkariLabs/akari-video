#!/usr/bin/env node
// r1: 効果 5 種（影 / 浮き出し / ネオン / 袋文字 / なし）が書き出しでも描かれるかを 1 フレームで測る（ラッパー作成の検証スクリプト）。
// 使い方: node export-frame-r1.mjs [fixture dir]
// results-after.json の r1.exportVariants（インスペクターの実操作で captions.json に書かれた text_style。効果の色は赤 #E02020）を、
// fixture の映像の先頭 3 秒 + 字幕 1 本だけの一時プロジェクトに置き、render-cut で MP4 へ書き出して 1.5 秒のフレームの
// 赤い画素（効果の色 #E02020 付近）を数え、さらに「なし」のフレームとの差分で赤み（R − G）が 15 以上増えた画素を数える
// （ぼかしの大きい 浮き出し / ネオン は色が暗い座布団や背景に薄く混ざり、絶対値のしきい値には届かないため）。L1 専用（単体テストでは使わない）。
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
const ELECTRON = process.env.AKARI_OSR_ELECTRON
    || path.join(REPO, 'apps/shell/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
const W = 1280, H = 720, T = 1.5;

const results = JSON.parse(await readFile(path.join(EVIDENCE, 'results-after.json'), 'utf8'));
const variantsIn = results.r1?.exportVariants;
if (!variantsIn) throw new Error('results-after.json に r1.exportVariants がありません（l1.mjs after を先に実行）');
const labels = { shadow: '影', raised: '浮き出し', neon: 'ネオン', outline: '袋文字', none: 'なし' };
const measured = { frameAtSeconds: T, variants: [] };
const frames = {};
const order = ['none', ...Object.keys(variantsIn).filter(n => n !== 'none')];
for (const name of order) {
    const variant = variantsIn[name];
    const work = path.join(TMP, `export-r1-${name}`);
    await rm(work, { recursive: true, force: true });
    await cp(FIXTURE_SRC, work, { recursive: true });
    const project = await realpath(work);
    const root = { default_text_style: { zone: 'bottom' }, captions: [{ id: 'c-0006', start: 0, end: 3, text: '効果と文字の\n設定を試します',
        speaker: null, sourceRef: { segment: 6 }, edited: false, text_style: variant.text_style }] };
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
        { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 1_800_000, killSignal: 'SIGKILL', env: { ...process.env, AKARI_OSR_ELECTRON: ELECTRON } });
    if (render.status !== 0) throw new Error(`render-cut exit ${render.status}: ${(render.stderr || render.stdout).slice(-2000)}`);
    const renderJson = JSON.parse(await readFile(path.join(project, '.akari', 'render.json'), 'utf8'));
    const frame = spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-ss', String(T), '-i', out, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: W * H * 4 });
    if (frame.status !== 0 || frame.stdout.length !== W * H * 3) throw new Error(`frame extract failed: ${frame.stderr?.toString()}`);
    const png = path.join(EVIDENCE, `r1-export-${name}.png`);
    spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-ss', String(T), '-i', out, '-frames:v', '1', '-vf', 'scale=640:-2', png]);
    frames[name] = frame.stdout;
    const base = frames.none;
    let red = 0, white = 0, redderThanNone = 0;
    for (let i = 0; i < W * H; i++) {
        const r = frame.stdout[i * 3], g = frame.stdout[i * 3 + 1], b = frame.stdout[i * 3 + 2];
        if (r > 150 && g < 100 && b < 100 && r - g > 70) red++;
        if (r > 225 && g > 225 && b > 225) white++;
        if (base && (r - g) - (base[i * 3] - base[i * 3 + 1]) >= 15) redderThanNone++;
    }
    measured.variants.push({
        name, label: labels[name] ?? name, text_style: variant.text_style, preview: variant.preview, renderSeconds: Math.round((Date.now() - started) / 1000),
        rasterizer: renderJson.provenance?.rasterizer?.selected ?? renderJson.provenance?.rasterizer ?? null,
        verify: renderJson.verify?.verdict ?? renderJson.verify?.status ?? null,
        redEffectPixels: red, redderThanNonePixels: redderThanNone, whiteTextPixels: white, screenshot: path.basename(png)
    });
}
const byName = Object.fromEntries(measured.variants.map(v => [v.name, v]));
measured.pass = ['shadow', 'raised', 'neon', 'outline'].every(n => byName[n]?.redderThanNonePixels > 1000)
    && byName.none?.redEffectPixels < 50 && measured.variants.every(v => v.whiteTextPixels > 300 || v.name === 'outline');
await writeFile(path.join(EVIDENCE, 'export-r1.json'), `${JSON.stringify(measured, null, 2)}\n`);
console.log(JSON.stringify(measured.variants.map(v => [v.name, v.redEffectPixels, v.redderThanNonePixels, v.whiteTextPixels, v.renderSeconds]).concat([['pass', measured.pass]])));
