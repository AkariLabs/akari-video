// 連続書き出しの実測: fixture の各プロジェクトを、edit.json を戻さずに engine の列（例 gpu,osr,gpu）の順で書き出し、
// 各回の 0.75 秒 / 2.25 秒のフレームを measure-frame で測る（赤 = 話した言葉・緑 = 置いた文字）。
// 書き出し前後の sources[]・stderr の skipped 警告・edit-lint の終了コードを記録する。
// 使い方: node export-seq.mjs <fixture dir> <phase> <engine 列> [--only=p-plain] [--osr-timeout=300]
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REPO = path.resolve(ROOT, '..', '..', '..', '..');
const [FIXTURE, PHASE, seqArg = 'gpu,gpu'] = process.argv.slice(2);
const OSR_TIMEOUT = Number(process.argv.find(v => v.startsWith('--osr-timeout='))?.slice(14) ?? 300);
const only = process.argv.find(v => v.startsWith('--only='))?.slice(7).split(',');
const seq = seqArg.split(',');
const RESULTS = path.join(ROOT, `results-${PHASE}.json`);
const out = { phase: PHASE, sequence: seq, runs: [] };
const { resolveOsrLauncher } = await import(path.join(REPO, 'packages/osr-export/src/index.mjs'));
const LAUNCHER = seq.includes('osr') ? await resolveOsrLauncher() : null;
const clean = s => String(s).replaceAll(REPO, '<repo>').replaceAll(FIXTURE, '<fixture>').replace(/\/(Users|private|tmp|var|Applications|opt)\/[^\s"']+/g, '<machine-path>');
for (const name of readdirSync(FIXTURE).sort()) {
  if (only && !only.includes(name)) continue;
  const project = path.join(FIXTURE, name);
  seq.forEach((engine, i) => {
    const n = i + 1;
    const run = { project: name, n, engine, samples: [] };
    out.runs.push(run);
    const lint = spawnSync('node', [path.join(REPO, 'packages/edit-lint/bin/edit-lint.mjs'), path.join(project, 'edit.json')], { encoding: 'utf8' });
    run.lintExit = lint.status;
    run.sourcesBeforeRender = JSON.parse(readFileSync(path.join(project, 'edit.json'), 'utf8')).sources.map(s => s.path);
    const mp4 = path.join(project, 'exports', `${PHASE}-${n}-${engine}.mp4`);
    const started = Date.now();
    const r = spawnSync('node', [path.join(REPO, 'packages/render-cut/bin/render-cut.mjs'), project, '--engine', engine, '--out', mp4, '--force'],
      { encoding: 'utf8', timeout: (engine === 'osr' ? OSR_TIMEOUT : 600) * 1000, cwd: project, env: process.env });
    run.renderExit = r.status; run.renderSec = Math.round((Date.now() - started) / 1000);
    writeFileSync(path.join(project, 'exports', `${PHASE}-${n}-${engine}.log`), `${r.stdout ?? ''}\n----- stderr -----\n${r.stderr ?? ''}`);
    run.skippedWarnings = clean((r.stderr ?? '').split('\n').filter(l => /skipped/.test(l)).join('\n'));
    run.sourcesAfterRender = JSON.parse(readFileSync(path.join(project, 'edit.json'), 'utf8')).sources.map(s => s.path);
    if (engine === 'osr') run.launcher = { tier: LAUNCHER.tier, reason: LAUNCHER.reason };
    if (r.status !== 0 || !existsSync(mp4)) { run.error = clean((r.error?.message ?? '') + (r.stderr ?? '').slice(-800)); console.log(name, n, engine, 'FAILED', run.error.slice(0, 400)); return; }
    for (const t of ['0.75', '2.25']) {
      const png = path.join(ROOT, `${PHASE}-${name}-${n}-${engine}-${t}.png`);
      run.samples.push(JSON.parse(execFileSync('node', [path.join(ROOT, 'scripts/measure-frame.mjs'), mp4, t, png]).toString()));
    }
    console.log(name, n, engine, `${run.renderSec}s`, `sources ${run.sourcesBeforeRender.length}`, run.skippedWarnings ? 'SKIPPED-WARN' : '',
      JSON.stringify(run.samples.map(s => ({ t: s.t, spoken: s.spoken && [s.spoken.cx, s.spoken.cy, s.spoken.width], placed: s.placed && [s.placed.cx, s.placed.cy, s.placed.width] }))));
  });
}
writeFileSync(RESULTS, JSON.stringify(out, null, 2) + '\n');
