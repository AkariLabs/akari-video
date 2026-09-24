#!/usr/bin/env node
// 書き出し（render-cut）側の L1（ラッパー作成の検証スクリプト）。
// 使い方: node export.mjs <before|after> --engine=gpu|osr [--repo=<変更前の checkout>] [fixture dir]
// fixture を一時ディレクトリへ写して render-cut で MP4 へ書き出し、captures.mjs の各時刻のフレームを
// 解析用の等倍 PNG（一時ディレクトリ）に落とす。フレームの SHA-256 も記録する（before / after で書き出しが不変かを見る）。
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, rm, realpath, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CAPTURES } from './captures.mjs';

const PHASE = process.argv[2];
if (!['before', 'after'].includes(PHASE)) throw new Error('phase must be before|after');
const ENGINE = process.argv.find(v => v.startsWith('--engine='))?.slice(9);
if (!['gpu', 'osr'].includes(ENGINE)) throw new Error('--engine=gpu|osr is required');
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
// --repo= で別の checkout（変更前の基点を展開したもの）の render-cut を使える。
const REPO = path.resolve(process.argv.find(v => v.startsWith('--repo='))?.slice(7) ?? path.resolve(ROOT, '..', '..', '..', '..', '..', '..'));
const SELF_REPO = path.resolve(ROOT, '..', '..', '..', '..', '..', '..');
const TMP = path.join(os.tmpdir(), 'preview-caption-textanim-l1');
// GPU は GPU が受け付ける版の fixture（gen-fixture.mjs --gpu）で書き出す。
const FIXTURE_SRC = path.resolve(process.argv.slice(3).find(v => !v.startsWith('--')) ?? path.join(TMP, ENGINE === 'gpu' ? 'fixture-gpu' : 'fixture'));
const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const RAW = path.join(TMP, `raw-${PHASE}`);
await mkdir(RAW, { recursive: true });
const work = path.join(TMP, `export-${PHASE}-${ENGINE}`);
await rm(work, { recursive: true, force: true });
await cp(FIXTURE_SRC, work, { recursive: true });
const project = await realpath(path.join(work, 'project'));
const outFile = path.join(project, 'exports', 'out.mp4');
const started = Date.now();
const render = spawnSync(process.execPath, [path.join(REPO, 'packages', 'render-cut', 'bin', 'render-cut.mjs'), project, '--force', '--no-verify-blank', '--engine', ENGINE, '--out', outFile],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 3_600_000, killSignal: 'SIGKILL' });
const renderSeconds = Math.round((Date.now() - started) / 1000);
const tail = s => String(s ?? '').replaceAll(REPO, '<worktree>').replaceAll(SELF_REPO, '<worktree>').replace(/\/(Users|private|var|tmp)\/[^\s)'"]+/g, '<machine-path>').slice(-3000);
const RESULT = path.join(ROOT, `export-${PHASE}-${ENGINE}.json`);
if (render.status !== 0) {
    await writeFile(RESULT, `${JSON.stringify({ phase: PHASE, engine: ENGINE, status: 'error', exit: render.status, stderr: tail(render.stderr), stdout: tail(render.stdout) }, null, 2)}\n`);
    console.log(JSON.stringify({ engine: ENGINE, status: 'error', exit: render.status }));
    process.exit(0);
}
const renderJson = JSON.parse(await readFile(path.join(project, '.akari', 'render.json'), 'utf8'));
const frames = [];
for (const capture of CAPTURES) {
    const raw = path.join(RAW, `export-${ENGINE}-${capture.name}.png`);
    // -ss を -i の後ろに置き、厳密にその時刻のフレーム（t × 30 番目）を取る。
    const x = spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-i', outFile, '-ss', String(capture.t), '-frames:v', '1', raw]);
    if (x.status !== 0) throw new Error(`frame extract failed: ${x.stderr}`);
    const rgb = spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-i', raw, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 64 * 1024 * 1024 });
    frames.push({ name: capture.name, t: capture.t, sha256: createHash('sha256').update(rgb.stdout).digest('hex').slice(0, 16) });
}
const summary = {
    phase: PHASE, engine: ENGINE, status: 'done', renderSeconds,
    selectedEngine: renderJson.provenance?.engine ?? renderJson.engine ?? null,
    rasterizer: renderJson.provenance?.rasterizer?.selected ?? renderJson.provenance?.rasterizer ?? null,
    warnings: (renderJson.warnings ?? []).map(w => tail(typeof w === 'string' ? w : JSON.stringify(w))).slice(0, 40),
    frames
};
await writeFile(RESULT, `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify({ engine: ENGINE, renderSeconds, frames: frames.length, selectedEngine: summary.selectedEngine }));
