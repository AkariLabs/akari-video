#!/usr/bin/env node
// 書き出し（render-cut）側の L1（ラッパー作成の検証スクリプト）。
// 使い方: node export.mjs <before|after> --engine=gpu|osr [fixture dir]
// l1.mjs が残した captions.json（「大きく」を 5 回押した後）で fixture を書き出し、scenarios.mjs の各時刻のフレームを
// 一時ディレクトリへ等倍 PNG で落とす。launcher_tier（worktree の Electron で描いたか）を記録する。比較は compare.mjs。
import { spawnSync } from 'node:child_process';
import { cp, mkdir, readFile, rm, realpath, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SCENARIOS } from './scenarios.mjs';

const PHASE = process.argv[2];
if (!['before', 'after'].includes(PHASE)) throw new Error('phase must be before|after');
const ENGINE = process.argv.find(v => v.startsWith('--engine='))?.slice(9);
if (!['gpu', 'osr'].includes(ENGINE)) throw new Error('--engine=gpu|osr is required');
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REPO = path.resolve(ROOT, '..', '..', '..', '..', '..', '..');
const TMP = path.join(os.tmpdir(), 'caption-run-size-l1');
const FIXTURE_SRC = path.resolve(process.argv.slice(3).find(v => !v.startsWith('--')) ?? path.join(TMP, 'fixture'));
const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const FRAMES = path.join(TMP, `frames-${PHASE}`);
await mkdir(FRAMES, { recursive: true });
const work = path.join(TMP, `export-${PHASE}-${ENGINE}`);
await rm(work, { recursive: true, force: true });
await cp(FIXTURE_SRC, work, { recursive: true });
const project = await realpath(path.join(work, 'project'));
await writeFile(path.join(project, 'captions.json'), await readFile(path.join(TMP, `captions-${PHASE}.json`), 'utf8'));
const outFile = path.join(project, 'exports', 'out.mp4');
const started = Date.now();
// AKARI_EXPORT_ALLOW_DESKTOP=0: インストール済みアプリ（tier 1）ではなく worktree の Electron（tier 2）で描く
const render = spawnSync(process.execPath, [path.join(REPO, 'packages', 'render-cut', 'bin', 'render-cut.mjs'), project, '--force', '--no-verify-blank', '--engine', ENGINE, '--out', outFile],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 3_600_000, killSignal: 'SIGKILL', env: { ...process.env, AKARI_EXPORT_ALLOW_DESKTOP: '0' } });
const renderSeconds = Math.round((Date.now() - started) / 1000);
const tail = s => String(s ?? '').replaceAll(REPO, '<worktree>').replace(/\/(Users|private|var|tmp)\/[^\s)'"]+/g, '<machine-path>').slice(-3000);
const summaryFile = path.join(ROOT, `export-${PHASE}-${ENGINE}.json`);
if (render.status !== 0) {
    await writeFile(summaryFile, `${JSON.stringify({ phase: PHASE, engine: ENGINE, status: 'error', exit: render.status, stderr: tail(render.stderr), stdout: tail(render.stdout) }, null, 2)}\n`);
    throw new Error(`render-cut exit ${render.status}: ${tail(render.stderr || render.stdout)}`);
}
const renderJson = JSON.parse(await readFile(path.join(project, '.akari', 'render.json'), 'utf8'));
for (const sc of SCENARIOS) {
    const x = spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-ss', String(sc.t), '-i', outFile, '-frames:v', '1', path.join(FRAMES, `${ENGINE}-${sc.key}.png`)]);
    if (x.status !== 0) throw new Error(`frame extract failed: ${x.stderr}`);
}
const tiers = {};
const walk = (value, trail) => {
    if (!value || typeof value !== 'object') return;
    for (const [k, v] of Object.entries(value)) {
        if (k === 'launcher_tier') tiers[trail.concat(k).join('.')] = v;
        else walk(v, trail.concat(k));
    }
};
walk(renderJson.provenance ?? {}, ['provenance']);
const summary = {
    phase: PHASE, engine: ENGINE, status: 'done', renderSeconds,
    selectedEngine: renderJson.provenance?.engine ?? renderJson.engine ?? null,
    launcherTiers: tiers,
    verify: renderJson.verify?.verdict ?? renderJson.verify?.status ?? null,
    warnings: (renderJson.warnings ?? []).map(w => tail(typeof w === 'string' ? w : JSON.stringify(w))).slice(0, 20),
    frames: SCENARIOS.map(sc => ({ key: sc.key, t: sc.t }))
};
await writeFile(summaryFile, `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify({ engine: ENGINE, renderSeconds, selectedEngine: summary.selectedEngine, launcherTiers: tiers }));
