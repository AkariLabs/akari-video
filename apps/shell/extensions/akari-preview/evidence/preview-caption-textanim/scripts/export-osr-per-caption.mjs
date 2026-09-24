#!/usr/bin/env node
// 書き出し（render-cut --engine osr）を字幕 1 本ずつの小さなプロジェクトで行う（ラッパー作成の検証スクリプト）。
// 使い方: node export-osr-per-caption.mjs <before|after> [--repo=<変更前の checkout>] [fixture dir]
// 理由: OSR は全字幕のオーバーレイを 1 枚の文書に並べ、各字幕の <style> の `.akari-caption__plate{animation:…}` が
// 文書全体に効くため、最後の字幕の宣言が全字幕の板を上書きする（fixture の c-0012 = 動き無しが最後にあると、全字幕の動きが消える）。
// 字幕ごとの正しい宣言（buildCaptionAnimation）の見た目を得るため、字幕 1 本だけを含むプロジェクト
// （カット = その字幕の source 区間 [4i, 4i+3] → 出力 0〜3 秒）で書き出し、出力 0.3 / 1.5 / 2.7 秒のフレームを取る。
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, rm, realpath, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROWS, STEP, CUE_SECONDS, FPS } from './gen-fixture.mjs';
import { PHASES } from './captures.mjs';

const PHASE = process.argv[2];
if (!['before', 'after'].includes(PHASE)) throw new Error('phase must be before|after');
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SELF_REPO = path.resolve(ROOT, '..', '..', '..', '..', '..', '..');
const REPO = path.resolve(process.argv.find(v => v.startsWith('--repo='))?.slice(7) ?? SELF_REPO);
const TMP = path.join(os.tmpdir(), 'preview-caption-textanim-l1');
const FIXTURE_SRC = path.resolve(process.argv.slice(3).find(v => !v.startsWith('--')) ?? path.join(TMP, 'fixture'));
const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const RAW = path.join(TMP, `raw-${PHASE}`);
await mkdir(RAW, { recursive: true });
const tail = s => String(s ?? '').replaceAll(REPO, '<worktree>').replaceAll(SELF_REPO, '<worktree>').replace(/\/(Users|private|var|tmp)\/[^\s)'"]+/g, '<machine-path>').slice(-2000);
const root = JSON.parse(await readFile(path.join(FIXTURE_SRC, 'project', 'captions.json'), 'utf8'));
const summary = { phase: PHASE, engine: 'osr', mode: 'per-caption', status: 'running', captions: [] };
const RESULT = path.join(ROOT, `export-${PHASE}-osr-per-caption.json`);
for (const [index, [id]] of ROWS.entries()) {
    const work = path.join(TMP, `export-${PHASE}-osr-${id}`);
    await rm(work, { recursive: true, force: true });
    await cp(FIXTURE_SRC, work, { recursive: true });
    const project = await realpath(path.join(work, 'project'));
    const caption = root.captions.find(c => c.id === id);
    const emphasis = (root.emphasis_words ?? []).filter(e => e.t_start >= caption.start && e.t_end <= caption.end);
    await writeFile(path.join(project, 'captions.json'), `${JSON.stringify({ ...(emphasis.length ? { emphasis_words: emphasis } : {}), captions: [caption] }, null, 2)}\n`);
    const edit = JSON.parse(await readFile(path.join(project, 'edit.json'), 'utf8'));
    const frames = CUE_SECONDS * FPS;
    edit.tracks[0].items[0] = { ...edit.tracks[0].items[0], at: 0, duration: frames, source: { ...edit.tracks[0].items[0].source, in: index * STEP, out: index * STEP + CUE_SECONDS } };
    edit.tracks[1].items[0] = { ...edit.tracks[1].items[0], at: 0, duration: frames };
    await writeFile(path.join(project, 'edit.json'), `${JSON.stringify(edit, null, 2)}\n`);
    const outFile = path.join(project, 'exports', 'out.mp4');
    const started = Date.now();
    const render = spawnSync(process.execPath, [path.join(REPO, 'packages', 'render-cut', 'bin', 'render-cut.mjs'), project, '--force', '--no-verify-blank', '--engine', 'osr', '--out', outFile],
        { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 1_800_000, killSignal: 'SIGKILL' });
    const entry = { id, renderSeconds: Math.round((Date.now() - started) / 1000), exit: render.status };
    if (render.status !== 0) { entry.stderr = tail(render.stderr || render.stdout); summary.captions.push(entry); continue; }
    const renderJson = JSON.parse(await readFile(path.join(project, '.akari', 'render.json'), 'utf8'));
    entry.selectedEngine = renderJson.provenance?.engine ?? renderJson.engine ?? null;
    entry.warnings = (renderJson.warnings ?? []).map(w => tail(typeof w === 'string' ? w : JSON.stringify(w))).slice(0, 10);
    entry.frames = [];
    for (const [phase, offset] of PHASES) {
        const name = `${id}-${phase}`;
        const raw = path.join(RAW, `export-osr-${name}.png`);
        const x = spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-i', outFile, '-ss', String(offset), '-frames:v', '1', raw]);
        if (x.status !== 0) throw new Error(`frame extract failed: ${x.stderr}`);
        const rgb = spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-i', raw, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 64 * 1024 * 1024 });
        entry.frames.push({ name, t: offset, sha256: createHash('sha256').update(rgb.stdout).digest('hex').slice(0, 16) });
    }
    summary.captions.push(entry);
    await writeFile(RESULT, `${JSON.stringify(summary, null, 2)}\n`);
    console.log(JSON.stringify({ id, renderSeconds: entry.renderSeconds, exit: entry.exit }));
}
summary.status = summary.captions.every(c => c.exit === 0) ? 'done' : 'partial';
await writeFile(RESULT, `${JSON.stringify(summary, null, 2)}\n`);
