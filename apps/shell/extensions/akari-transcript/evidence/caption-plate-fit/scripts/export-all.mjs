// 書き出しの実測: 各 fixture を edit-lint → render-cut（engine ごと）→ 0.5 秒 / 1.5 秒のフレームを measure-frame で測る。
// 使い方: node export-all.mjs <fixture dir> <before|after> [gpu,osr] [--osr-timeout=240]
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REPO = path.resolve(ROOT, '..', '..', '..', '..', '..', '..');
const [FIXTURE, PHASE, enginesArg = 'gpu'] = process.argv.slice(2);
const OSR_TIMEOUT = Number(process.argv.find(v => v.startsWith('--osr-timeout='))?.slice(14) ?? 240);
const engines = enginesArg.split(',');
const only = process.argv.find(v => v.startsWith('--only='))?.slice(7).split(',');
const RESULTS = path.join(ROOT, `results-export-${PHASE}.json`);
const out = existsSync(RESULTS) ? JSON.parse(readFileSync(RESULTS, 'utf8')) : { phase: PHASE, runs: [] };
const clean = s => String(s).replaceAll(REPO, '<worktree>').replaceAll(FIXTURE, '<fixture>').replace(/\/(Users|private|tmp|var)\/[^\s"']+/g, '<machine-path>');
for (const name of readdirSync(FIXTURE).sort()) {
  if (only && !only.includes(name)) continue;
  const project = path.join(FIXTURE, name);
  const background = JSON.parse(readFileSync(path.join(project, 'captions.json'), 'utf8')).default_text_style.background;
  const lint = spawnSync('node', [path.join(REPO, 'packages/edit-lint/bin/edit-lint.mjs'), path.join(project, 'edit.json')], { encoding: 'utf8' });
  for (const engine of engines) {
    const run = { project: name, engine, background, lintExit: lint.status, samples: [] };
    out.runs = out.runs.filter(r => !(r.project === name && r.engine === engine));
    out.runs.push(run);
    const mp4 = path.join(project, 'exports', `${engine}.mp4`);
    const started = Date.now();
    const r = spawnSync('node', [path.join(REPO, 'packages/render-cut/bin/render-cut.mjs'), project, '--engine', engine, '--out', mp4, '--force'],
      { encoding: 'utf8', timeout: (engine === 'osr' ? OSR_TIMEOUT : 600) * 1000, cwd: project });
    run.renderExit = r.status; run.renderSec = Math.round((Date.now() - started) / 1000);
    if (r.status !== 0 || !existsSync(mp4)) { run.error = clean((r.error?.message ?? '') + (r.stderr ?? '').slice(-600)); console.log(name, engine, 'FAILED', run.error.slice(0, 300)); continue; }
    for (const t of ['0.5', '1.5']) run.samples.push(JSON.parse(execFileSync('node', [path.join(ROOT, 'scripts/measure-frame.mjs'), mp4, t]).toString()));
    run.samples.forEach(s => { s.file = `${name}/exports/${engine}.mp4`; });
    console.log(name, engine, run.samples.map(s => `${s.t}s w=${s.plateWidthPx} h=${s.plateHeightRows}`).join(' | '));
    writeFileSync(RESULTS, JSON.stringify(out, null, 2) + '\n');
  }
}
writeFileSync(RESULTS, JSON.stringify(out, null, 2) + '\n');
