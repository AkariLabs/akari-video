#!/usr/bin/env node
// 書き出し（render-cut --engine gpu|osr）を字幕 1 本ずつの小さなプロジェクトで行う（ラッパー作成の検証スクリプト）。
// 使い方: node export.mjs <before|after> --engine=gpu|osr [--only=c-0012,...] [fixture dir]
// 字幕 1 本だけを含むプロジェクト（カット = その字幕の source 区間 [4i, 4i+3] → 出力 0〜3 秒）で書き出し、
// 出力 0.3 / 1.5 / 2.7 秒（in / loop / out の途中）のフレームを解析用 PNG（一時ディレクトリ）へ落とす。
// OSR を 1 本ずつにする理由: OSR は全字幕を 1 文書に並べ、各字幕の <style> の板の animation が文書全体に効く
// （最後の字幕の宣言が全字幕を上書きする・既存の別問題）。GPU も同じ枠組みで書き出してそろえる。
// 全フレームの復号後の md5（ffmpeg framemd5）も記録する（動きの無い字幕の before / after 画素一致の確認用）。
import { spawnSync } from 'node:child_process';
import { cp, mkdir, readFile, rm, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROWS, STEP, CUE_SECONDS, FPS, TMP, PHASES } from './fixture.mjs';

const PHASE = process.argv[2];
if (!['before', 'after'].includes(PHASE)) throw new Error('phase must be before|after');
const ENGINE = process.argv.find(v => v.startsWith('--engine='))?.slice(9);
if (!['gpu', 'osr'].includes(ENGINE)) throw new Error('--engine=gpu|osr is required');
const ONLY = process.argv.find(v => v.startsWith('--only='))?.slice(7).split(',');
const EVIDENCE = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REPO = path.resolve(EVIDENCE, '..', '..', '..', '..');
const FIXTURE_SRC = path.resolve(process.argv.slice(3).find(v => !v.startsWith('--')) ?? path.join(TMP, 'fixture'));
const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const RAW = path.join(TMP, `raw-${PHASE}`);
await mkdir(RAW, { recursive: true });
const tail = s => String(s ?? '').replaceAll(REPO, '<repo>').replace(/\/(Users|private|var|tmp)\/[^\s)'"]+/g, '<machine-path>').slice(-2000);
const root = JSON.parse(await readFile(path.join(FIXTURE_SRC, 'project', 'captions.json'), 'utf8'));
const RESULT = path.join(EVIDENCE, `export-${PHASE}-${ENGINE}.json`);
let summary = { phase: PHASE, engine: ENGINE, mode: 'per-caption', status: 'running', captions: [] };
if (ONLY) { try { summary = JSON.parse(await readFile(RESULT, 'utf8')); } catch { /* 新規 */ } }
const env = { ...process.env, AKARI_HOME: path.join(TMP, 'akari-home-gpu-caption-motion-css-parity') };
for (const [index, [id]] of ROWS.entries()) {
    if (ONLY && !ONLY.includes(id)) continue;
    const work = path.join(TMP, `export-${PHASE}-${ENGINE}-${id}`);
    await rm(work, { recursive: true, force: true });
    await cp(FIXTURE_SRC, work, { recursive: true });
    const project = await realpath(path.join(work, 'project'));
    const caption = root.captions.find(c => c.id === id);
    await writeFile(path.join(project, 'captions.json'), `${JSON.stringify({ captions: [caption] }, null, 2)}\n`);
    const edit = JSON.parse(await readFile(path.join(project, 'edit.json'), 'utf8'));
    const frames = CUE_SECONDS * FPS;
    edit.tracks[0].items[0] = { ...edit.tracks[0].items[0], at: 0, duration: frames, source: { ...edit.tracks[0].items[0].source, in: index * STEP, out: index * STEP + CUE_SECONDS } };
    edit.tracks[1].items[0] = { ...edit.tracks[1].items[0], at: 0, duration: frames };
    await writeFile(path.join(project, 'edit.json'), `${JSON.stringify(edit, null, 2)}\n`);
    const outFile = path.join(project, 'exports', 'out.mp4');
    const started = Date.now();
    const render = spawnSync(process.execPath, [path.join(REPO, 'packages', 'render-cut', 'bin', 'render-cut.mjs'), project, '--force', '--no-verify-blank', '--engine', ENGINE, '--out', outFile],
        { encoding: 'utf8', env, maxBuffer: 64 * 1024 * 1024, timeout: 1_800_000, killSignal: 'SIGKILL' });
    const entry = { id, anim: ROWS[index][2], loop: ROWS[index][3], renderSeconds: Math.round((Date.now() - started) / 1000), exit: render.status };
    summary.captions = summary.captions.filter(c => c.id !== id);
    if (render.status !== 0) { entry.stderr = tail(render.stderr || render.stdout); summary.captions.push(entry); await writeFile(RESULT, `${JSON.stringify(summary, null, 2)}\n`); console.log(JSON.stringify({ id, exit: entry.exit })); continue; }
    const renderJson = JSON.parse(await readFile(path.join(project, '.akari', 'render.json'), 'utf8'));
    entry.selectedEngine = renderJson.provenance?.engine ?? renderJson.engine ?? null;
    entry.warnings = (renderJson.warnings ?? []).map(w => tail(typeof w === 'string' ? w : JSON.stringify(w))).slice(0, 10);
    entry.frames = [];
    for (const [phase, offset] of PHASES) {
        const raw = path.join(RAW, `${ENGINE}-${id}-${phase}.png`);
        // -ss を -i の後ろに置き、厳密にその時刻のフレーム（t × 30 番目）を取る。
        const x = spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-i', outFile, '-ss', String(offset), '-frames:v', '1', raw]);
        if (x.status !== 0) throw new Error(`frame extract failed: ${x.stderr}`);
        entry.frames.push({ phase, t: offset });
    }
    const md5 = spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-i', outFile, '-map', '0:v:0', '-f', 'framemd5', '-'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    entry.frameMd5 = md5.stdout.split('\n').filter(l => l && !l.startsWith('#')).map(l => l.split(',').at(-1).trim());
    summary.captions.push(entry);
    await writeFile(RESULT, `${JSON.stringify(summary, null, 2)}\n`);
    console.log(JSON.stringify({ id, renderSeconds: entry.renderSeconds, exit: entry.exit, engine: entry.selectedEngine, frames: entry.frameMd5.length }));
}
summary.captions.sort((a, b) => a.id.localeCompare(b.id));
summary.status = summary.captions.length === ROWS.length && summary.captions.every(c => c.exit === 0) ? 'done' : 'partial';
await writeFile(RESULT, `${JSON.stringify(summary, null, 2)}\n`);
