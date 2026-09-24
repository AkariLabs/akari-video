#!/usr/bin/env node
// 書き出し（render-cut・GPU 経路）したフレームで、文字範囲の見た目がプレビューの再読込後と同じ場所・同じ色に出るかを測る（ラッパー作成の検証スクリプト）。
// 使い方: node export-frame.mjs [fixture dir]
// l1.mjs が残した再読込後の captions.json（台本の手順より前）で書き出し、c-0001 の中点（1.8 秒）のフレームを ffmpeg で RGB の生画素に落とし、
// 赤（「最高」= #f26666）と緑（「アイデア」= #22c55e）の画素の外接矩形を、プレビューの run の span の矩形（フレーム比）と比べる。L1 専用。
import { spawnSync } from 'node:child_process';
import { cp, readFile, rm, writeFile, realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REPO = path.resolve(ROOT, '..', '..', '..', '..', '..', '..');
const TMP = path.join(os.tmpdir(), 'caption-runs-edit-ui-l1');
const FIXTURE_SRC = path.resolve(process.argv[2] ?? path.join(TMP, 'fixture'));
const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const W = 1280, H = 720, T = 1.8;
const round = (v, d = 4) => Math.round(v * 10 ** d) / 10 ** d;

const results = JSON.parse(await readFile(path.join(ROOT, 'results-after.json'), 'utf8'));
const fr = results.frameAfterReload, spans = results.spansAfterReload;
if (!fr || !spans?.length) throw new Error('results に再読込後の実測がありません');
const work = path.join(TMP, 'export-after');
await rm(work, { recursive: true, force: true });
await cp(FIXTURE_SRC, work, { recursive: true });
const project = await realpath(path.join(work, 'project'));
await writeFile(path.join(project, 'captions.json'), await readFile(path.join(TMP, 'captions-after-reload.json'), 'utf8'));
const out = path.join(project, 'exports', 'out.mp4');
const started = Date.now();
const render = spawnSync(process.execPath, [path.join(REPO, 'packages', 'render-cut', 'bin', 'render-cut.mjs'), project, '--engine', 'gpu', '--force', '--no-verify-blank', '--out', out], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 1_800_000, killSignal: 'SIGKILL' });
const renderSeconds = Math.round((Date.now() - started) / 1000);
if (render.status !== 0) throw new Error(`render-cut exit ${render.status}: ${(render.stderr || render.stdout).slice(-2000)}`);
const renderJson = JSON.parse(await readFile(path.join(project, '.akari', 'render.json'), 'utf8'));
const frame = spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-ss', String(T), '-i', out, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: W * H * 4 });
if (frame.status !== 0 || frame.stdout.length !== W * H * 3) throw new Error(`frame extract failed: ${frame.stderr?.toString()}`);
spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-ss', String(T), '-i', out, '-frames:v', '1', path.join(ROOT, 'after-11-export-gpu.png')]);
const px = frame.stdout;
const box = test => {
    let minX = W, maxX = -1, minY = H, maxY = -1, count = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 3; if (!test(px[i], px[i + 1], px[i + 2])) continue;
        count++; if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    return count ? { left: round(minX / W), right: round((maxX + 1) / W), top: round(minY / H), bottom: round((maxY + 1) / H), count } : null;
};
const spanBox = texts => {
    const rs = spans.filter(s => texts.includes(s.text)).map(s => s.rect);
    const l = Math.min(...rs.map(r => r.left)), r = Math.max(...rs.map(r => r.left + r.width)), t = Math.min(...rs.map(r => r.top)), b = Math.max(...rs.map(r => r.top + r.height));
    return { left: round((l - fr.x) / fr.w), right: round((r - fr.x) / fr.w), top: round((t - fr.y) / fr.h), bottom: round((b - fr.y) / fr.h) };
};
const compare = (exported, preview) => exported && {
    cx: round((exported.left + exported.right) / 2 - (preview.left + preview.right) / 2),
    cy: round((exported.top + exported.bottom) / 2 - (preview.top + preview.bottom) / 2)
};
const red = box((r, g, b) => r > 190 && g < 150 && b < 150 && r - g > 70);
const green = box((r, g, b) => g > 150 && r < 120 && b < 150 && g - r > 60);
const cases = [
    { name: '最高（赤・大きく・上へ・回転）', exported: red, preview: spanBox(['最', '高']) },
    { name: 'アイデア（マイスタイルの緑）', exported: green, preview: spanBox(['ア', 'イ', 'デ']) }
].map(c => ({ ...c, diff: compare(c.exported, c.preview) }));
const measured = { renderSeconds, engine: renderJson.provenance?.engine ?? renderJson.engine ?? null, rasterizer: renderJson.provenance?.rasterizer?.selected ?? renderJson.provenance?.rasterizer ?? null,
    verify: renderJson.verify?.verdict ?? renderJson.verify?.status ?? null, frameAtSeconds: T, cases,
    pass: cases.every(c => c.exported && Math.abs(c.diff.cx) <= 0.01 && Math.abs(c.diff.cy) <= 0.015) };
await writeFile(path.join(ROOT, 'export-after.json'), `${JSON.stringify(measured, null, 2)}\n`);
console.log(JSON.stringify(measured, null, 2));
