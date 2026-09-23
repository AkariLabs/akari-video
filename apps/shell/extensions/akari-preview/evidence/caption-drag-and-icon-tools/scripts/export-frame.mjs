#!/usr/bin/env node
// 書き出し（render-cut）したフレームで、プレビューで動かした字幕がプレビューと同じ位置に出るかを測る（ラッパー作成の検証スクリプト）。
// 使い方: node export-frame.mjs <before|after> [fixture dir]
// results-<phase>.json の保存値（中央吸着 c-0004 / 左寄り c-0005 / はみ出し c-0003）をそのまま 1 秒ずつ並べた 3 秒の検証用プロジェクトを
// 一時ディレクトリに作り、render-cut で MP4 へ書き出し、各区間の中点のフレームを ffmpeg で灰色の生画素に落として
// 明るい画素（文字の塗り）の外接矩形を出し、プレビューの再読込後の文字の矩形（フレーム比）と比べる。L1 専用（単体テストでは使わない）。
import { spawnSync } from 'node:child_process';
import { cp, readFile, rm, writeFile, realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PHASE = process.argv[2];
if (!['before', 'after'].includes(PHASE)) throw new Error('phase must be before|after');
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REPO = path.resolve(ROOT, '..', '..', '..', '..', '..', '..');
const TMP = path.join(os.tmpdir(), 'caption-drag-and-icon-tools-l1');
const FIXTURE_SRC = path.resolve(process.argv[3] ?? path.join(TMP, 'fixture'));
const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const W = 1280, H = 720;
const round = (v, d = 4) => Math.round(v * 10 ** d) / 10 ** d;

const results = JSON.parse(await readFile(path.join(ROOT, `results-${PHASE}.json`), 'utf8'));
const reload = results.checks.find(c => c.name.startsWith('再読込'))?.detail;
const fr = results.frameAfterReload;
if (!reload || !fr) throw new Error('results に再読込後の実測がありません');
const work = path.join(TMP, `export-${PHASE}`);
await rm(work, { recursive: true, force: true });
await cp(FIXTURE_SRC, work, { recursive: true });
const project = await realpath(path.join(work, 'project'));
const source = JSON.parse(await readFile(path.join(results.fixtureProject ?? path.join(TMP, `work-${PHASE}`, 'project'), 'captions.json'), 'utf8'));
const CASES = [['中央吸着', 'c-0004'], ['左寄り', 'c-0005'], ['はみ出し', 'c-0003']];
const rows = CASES.map(([name, id], index) => {
    const row = source.captions.find(c => c.id === id);
    return { ...row, start: index, end: index + 1 };
});
await writeFile(path.join(project, 'captions.json'), `${JSON.stringify({ ...source, captions: rows }, null, 2)}\n`);
const editFile = path.join(project, 'edit.json');
const edit = JSON.parse(await readFile(editFile, 'utf8'));
for (const track of edit.tracks) for (const item of track.items) {
    item.duration = 3 * edit.output.fps;
    if (item.source.kind === 'media') item.source.out = 3;
}
await writeFile(editFile, `${JSON.stringify(edit, null, 2)}\n`);
const out = path.join(project, 'exports', 'out.mp4');
const started = Date.now();
const render = spawnSync(process.execPath, [path.join(REPO, 'packages', 'render-cut', 'bin', 'render-cut.mjs'), project, '--force', '--no-verify-blank', '--out', out], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 1_800_000, killSignal: 'SIGKILL' });
const renderSeconds = Math.round((Date.now() - started) / 1000);
if (render.status !== 0) throw new Error(`render-cut exit ${render.status}: ${(render.stderr || render.stdout).slice(-2000)}`);
const renderJson = JSON.parse(await readFile(path.join(project, '.akari', 'render.json'), 'utf8'));
const measured = { phase: PHASE, renderSeconds, rasterizer: renderJson.provenance?.rasterizer?.selected ?? renderJson.provenance?.rasterizer ?? null,
    verify: renderJson.verify?.verdict ?? renderJson.verify?.status ?? null, cases: [] };
for (const [index, [name, id]] of CASES.entries()) {
    const t = index + 0.5;
    const frame = spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-ss', String(t), '-i', out, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], { maxBuffer: W * H * 2 });
    if (frame.status !== 0 || frame.stdout.length !== W * H) throw new Error(`frame extract failed: ${frame.stderr?.toString()}`);
    const png = path.join(ROOT, `${PHASE}-07-export-${index + 1}.png`);
    spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-ss', String(t), '-i', out, '-frames:v', '1', '-vf', 'scale=640:-1', png]);
    let minX = W, maxX = -1, minY = H, maxY = -1, count = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        if (frame.stdout[y * W + x] > 200) { count++; if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
    }
    const preview = reload[name]?.reloaded;
    const exported = count ? { left: round(minX / W), right: round((maxX + 1) / W), top: round(minY / H), bottom: round((maxY + 1) / H) } : null;
    const previewBox = preview ? { left: round(preview.left / fr.w), right: round(preview.right / fr.w), top: round(preview.top / fr.h), bottom: round(preview.bottom / fr.h) } : null;
    const diff = exported && previewBox ? {
        // はみ出しの字幕は左端が画面で切れるので、比べるのは右端と縦の中心。
        right: round(exported.right - previewBox.right), cy: round((exported.top + exported.bottom) / 2 - (previewBox.top + previewBox.bottom) / 2),
        cx: name === 'はみ出し' ? null : round((exported.left + exported.right) / 2 - (previewBox.left + previewBox.right) / 2)
    } : null;
    measured.cases.push({ name, id, text_style: rows[index].text_style ?? null, frameAtSeconds: t, exported, previewBox, diff, brightPixels: count, screenshot: path.basename(png) });
}
await writeFile(path.join(ROOT, `export-${PHASE}.json`), `${JSON.stringify(measured, null, 2)}\n`);
console.log(JSON.stringify(measured));
