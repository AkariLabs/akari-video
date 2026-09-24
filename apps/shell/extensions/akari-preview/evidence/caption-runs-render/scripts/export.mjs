#!/usr/bin/env node
// 書き出し（render-cut）側の L1（ラッパー作成の検証スクリプト）。
// 使い方: node export.mjs <before|after> --engine=gpu|osr [fixture dir]
// fixture を一時ディレクトリへ写して render-cut で MP4 へ書き出し、captures.mjs の各時刻のフレームを
// 解析用の等倍 PNG（一時ディレクトリ）と証跡用の縮小 PNG に落とす。見た目の比較は compare.mjs が行う。
import { spawnSync } from 'node:child_process';
import { cp, mkdir, readFile, rm, realpath, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CAPTURES as ALL_CAPTURES } from './captures.mjs';
const SET = process.argv.find(v => v.startsWith('--set='))?.slice(6) ?? 'main';
const CAPTURES = ALL_CAPTURES.filter(c => SET === 'animator' ? c.id === 'c-0007' : c.id !== 'c-0007');

const PHASE = process.argv[2];
if (!['before', 'after'].includes(PHASE)) throw new Error('phase must be before|after');
const ENGINE = process.argv.find(v => v.startsWith('--engine='))?.slice(9);
if (!['gpu', 'osr'].includes(ENGINE)) throw new Error('--engine=gpu|osr is required');
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REPO = path.resolve(ROOT, '..', '..', '..', '..', '..', '..');
const TMP = path.join(os.tmpdir(), 'caption-runs-render-l1');
const FIXTURE_SRC = path.resolve(process.argv.slice(3).find(v => !v.startsWith('--')) ?? path.join(TMP, SET === 'animator' ? 'fixture-animator' : PHASE === 'before' ? 'fixture' : 'fixture-runs'));
const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const RAW = path.join(TMP, `raw-${PHASE}`);
await mkdir(RAW, { recursive: true });
const work = path.join(TMP, `export-${PHASE}-${ENGINE}-${SET}`);
await rm(work, { recursive: true, force: true });
await cp(FIXTURE_SRC, work, { recursive: true });
const project = await realpath(path.join(work, 'project'));
const outFile = path.join(project, 'exports', 'out.mp4');
const started = Date.now();
const render = spawnSync(process.execPath, [path.join(REPO, 'packages', 'render-cut', 'bin', 'render-cut.mjs'), project, '--force', '--no-verify-blank', '--engine', ENGINE, '--out', outFile],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 3_600_000, killSignal: 'SIGKILL' });
const renderSeconds = Math.round((Date.now() - started) / 1000);
const tail = s => String(s ?? '').replaceAll(REPO, '<worktree>').replace(/\/(Users|private|var|tmp)\/[^\s)'"]+/g, '<machine-path>').slice(-3000);
if (render.status !== 0) {
    await writeFile(path.join(ROOT, `export-${PHASE}-${ENGINE}${SET === 'main' ? '' : `-${SET}`}.json`), `${JSON.stringify({ phase: PHASE, engine: ENGINE, status: 'error', exit: render.status, stderr: tail(render.stderr), stdout: tail(render.stdout) }, null, 2)}\n`);
    throw new Error(`render-cut exit ${render.status}: ${tail(render.stderr || render.stdout)}`);
}
const renderJson = JSON.parse(await readFile(path.join(project, '.akari', 'render.json'), 'utf8'));
const frames = [];
for (const capture of CAPTURES) {
    const raw = path.join(RAW, `export-${ENGINE}-${capture.name}.png`);
    const x = spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-ss', String(capture.t), '-i', outFile, '-frames:v', '1', raw]);
    if (x.status !== 0) throw new Error(`frame extract failed: ${x.stderr}`);
    const shot = `${PHASE}-export-${ENGINE}-${capture.name}.png`;
    spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-ss', String(capture.t), '-i', outFile, '-frames:v', '1', '-vf', 'scale=732:-1', path.join(ROOT, shot)]);
    frames.push({ ...capture, screenshot: shot });
}
const summary = {
    phase: PHASE, engine: ENGINE, status: 'done', renderSeconds,
    selectedEngine: renderJson.provenance?.engine ?? renderJson.engine ?? null,
    rasterizer: renderJson.provenance?.rasterizer?.selected ?? renderJson.provenance?.rasterizer ?? null,
    warnings: (renderJson.warnings ?? []).map(w => tail(typeof w === 'string' ? w : JSON.stringify(w))).slice(0, 40),
    frames
};
await writeFile(path.join(ROOT, `export-${PHASE}-${ENGINE}${SET === 'main' ? '' : `-${SET}`}.json`), `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify({ engine: ENGINE, renderSeconds, frames: frames.length, selectedEngine: summary.selectedEngine }));
