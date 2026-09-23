#!/usr/bin/env node
// 書き出し（render-cut）したフレームで、既定位置の置いた文字がどこに出るかを測る（ラッパー作成の検証スクリプト）。
// 使い方: node export-frame.mjs <before|after> [fixture dir]
// results-<phase>.json の「(a) 既定で置いた文字」の保存値（text / text_style / time_domain）をそのまま置いた
// 3 秒の検証用プロジェクト（fixture の映像の先頭 3 秒 + 置いた文字 1 本だけ）を一時ディレクトリに作り、render-cut で MP4 へ書き出し、置いた文字の区間の 1 フレームを
// ffmpeg で灰色の生画素に落として、明るい画素（文字）の外接矩形の中心を出す。L1 専用（単体テストでは使わない）。
import { spawnSync } from 'node:child_process';
import { cp, readFile, rm, writeFile, realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PHASE = process.argv[2];
if (!['before', 'after'].includes(PHASE)) throw new Error('phase must be before|after');
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REPO = path.resolve(ROOT, '..', '..', '..', '..', '..', '..');
const TMP = path.join(os.tmpdir(), 'placed-text-position-polish-l1');
const FIXTURE_SRC = path.resolve(process.argv[3] ?? path.join(TMP, 'fixture'));
const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const W = 1280, H = 720, T = 1.5;
const round = (v, d = 4) => Math.round(v * 10 ** d) / 10 ** d;

const results = JSON.parse(await readFile(path.join(ROOT, `results-${PHASE}.json`), 'utf8'));
const placed = results.checks.find(c => c.name.startsWith('(a) akari.caption.placeText'))?.detail;
if (!placed) throw new Error('results に (a) の保存値がありません');
const work = path.join(TMP, `export-${PHASE}`);
await rm(work, { recursive: true, force: true });
await cp(FIXTURE_SRC, work, { recursive: true });
const project = await realpath(path.join(work, 'position'));
const captionsFile = path.join(project, 'captions.json');
// 高負荷の機械では 32 秒の書き出しが終わらないことがあるので、先頭 3 秒・置いた文字 1 本だけにする。
const root = { default_text_style: { zone: 'bottom' }, captions: [{ id: placed.id, start: 0, end: 3, text: placed.saved.text,
    time_domain: placed.saved.time_domain, sourceRef: null, edited: true, speaker: null, text_style: placed.saved.text_style }] };
await writeFile(captionsFile, `${JSON.stringify(root, null, 2)}\n`);
const editFile = path.join(project, 'edit.json');
const edit = JSON.parse(await readFile(editFile, 'utf8'));
for (const track of edit.tracks) for (const item of track.items) {
    item.duration = 3 * edit.output.fps;
    if (item.source.kind === 'media') item.source.out = 3;
}
await writeFile(editFile, `${JSON.stringify(edit, null, 2)}\n`);
const out = path.join(project, 'exports', 'out.mp4');  // render-cut は案件内の出力先しか受けない
const started = Date.now();
const render = spawnSync(process.execPath, [path.join(REPO, 'packages', 'render-cut', 'bin', 'render-cut.mjs'), project, '--force', '--no-verify-blank', '--out', out], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 900_000, killSignal: 'SIGKILL' });
const renderSeconds = Math.round((Date.now() - started) / 1000);
if (render.status !== 0) throw new Error(`render-cut exit ${render.status}: ${(render.stderr || render.stdout).slice(-2000)}`);
const renderJson = JSON.parse(await readFile(path.join(project, '.akari', 'render.json'), 'utf8'));
const frame = spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-ss', String(T), '-i', out, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], { maxBuffer: W * H * 2 });
if (frame.status !== 0 || frame.stdout.length !== W * H) throw new Error(`frame extract failed: ${frame.stderr?.toString()}`);
const png = path.join(ROOT, `${PHASE}-07-export-frame.png`);
spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-ss', String(T), '-i', out, '-frames:v', '1', png]);
// 文字（白）だけを拾う。
let minX = W, maxX = -1, minY = H, maxY = -1, count = 0;
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (frame.stdout[y * W + x] > 200) { count++; if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
}
if (count === 0) throw new Error('置いた文字の画素が見つかりません');
const measured = {
    phase: PHASE, renderSeconds, rasterizer: renderJson.provenance?.rasterizer?.selected ?? renderJson.provenance?.rasterizer ?? null,
    verify: renderJson.verify?.verdict ?? renderJson.verify?.status ?? null, frameAtSeconds: T, row: { text: placed.saved.text, text_style: placed.saved.text_style },
    textBox: { left: round(minX / W), right: round(maxX / W), top: round(minY / H), bottom: round(maxY / H) },
    center: { x: round((minX + maxX) / 2 / W), y: round((minY + maxY) / 2 / H) }, brightPixels: count, screenshot: path.basename(png)
};
await writeFile(path.join(ROOT, `export-${PHASE}.json`), `${JSON.stringify(measured, null, 2)}\n`);
console.log(JSON.stringify(measured));
