#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CASES, PHASES, ROOT } from './fixture.mjs';

const engine = process.argv[2];
if (!['gpu', 'osr', 'owner'].includes(engine)) throw new Error('usage: node export.mjs gpu|osr|owner');
const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../../../..');
const cli = path.join(repo, 'packages/render-cut/bin/render-cut.mjs');
const ffmpeg = process.env.FFMPEG || 'ffmpeg';
const env = { ...process.env, AKARI_HOME: path.join(ROOT, 'home') };
const receipts = [];
const only = process.argv.find((value) => value.startsWith('--only='))?.slice(7).split(',');
const names = (engine === 'owner' ? ['owner'] : CASES.map(([name]) => name))
  .filter((name) => !only || only.includes(name));
await mkdir(path.join(ROOT, 'frames'), { recursive: true });

for (const name of names) {
  const project = path.join(ROOT, name);
  const output = path.join(project, 'exports', `${engine === 'owner' ? 'auto' : engine}.mp4`);
  const selected = engine === 'owner' ? 'auto' : engine;
  const row = { name, requestedEngine: selected };
  if (engine === 'owner') {
    const lint = spawnSync(process.execPath, [path.join(repo, 'packages/edit-lint/bin/edit-lint.mjs'),
      project, '--engine', 'auto', '--json'],
    { encoding: 'utf8', env, maxBuffer: 16 * 1024 * 1024, timeout: 300000 });
    row.lintExit = lint.status;
    const plan = spawnSync(process.execPath, [cli, project, '--engine', 'auto', '--plan-only'],
      { encoding: 'utf8', env, maxBuffer: 16 * 1024 * 1024, timeout: 300000 });
    row.planExit = plan.status;
    if (plan.status === 0) {
      const planned = JSON.parse(await readFile(path.join(project, '.akari', 'render.json'), 'utf8'));
      row.planSelectedEngine = planned.provenance?.engine ?? planned.plan?.engine ?? null;
    }
    row.planGpu = row.planSelectedEngine === 'gpu';
    row.planIneligibleWarning = /GPU export is ineligible/iu.test(`${plan.stdout ?? ''}\n${plan.stderr ?? ''}`);
    row.planTail = `${plan.stdout ?? ''}\n${plan.stderr ?? ''}`.split('\n').filter(Boolean).slice(-8)
      .map((line) => line.replaceAll(repo, '<repo>').replaceAll(ROOT, '<tmp>'));
  }
  const started = Date.now();
  const run = spawnSync(process.execPath,
    [cli, project, '--force', '--no-verify-blank', '--engine', selected, '--out', output],
    { encoding: 'utf8', env, maxBuffer: 64 * 1024 * 1024, timeout: 900000 });
  row.exit = run.status;
  row.seconds = Math.round((Date.now() - started) / 1000);
  if (run.status !== 0) {
    row.error = `${run.stderr ?? ''}\n${run.stdout ?? ''}`.slice(-1800)
      .replaceAll(repo, '<repo>').replaceAll(ROOT, '<tmp>');
  } else {
    const receipt = JSON.parse(await readFile(path.join(project, '.akari', 'render.json'), 'utf8'));
    row.selectedEngine = receipt.provenance?.engine ?? receipt.engine ?? null;
    row.ineligibleWarning = (receipt.warnings ?? []).some((value) =>
      /GPU export is ineligible/iu.test(typeof value === 'string' ? value : JSON.stringify(value)));
    if (engine !== 'owner') for (const [phase, frame] of PHASES) {
      const filename = `${engine}-${name}-${phase}.png`;
      const extract = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
        '-i', output, '-vf', `select=eq(n\\,${frame})`, '-frames:v', '1',
        path.join(ROOT, 'frames', filename)], { encoding: 'utf8' });
      if (extract.status !== 0) throw new Error(`frame extraction failed: ${name} ${phase}: ${extract.stderr}`);
    }
  }
  receipts.push(row);
  console.log(JSON.stringify({ name, exit: row.exit, selectedEngine: row.selectedEngine, seconds: row.seconds }));
  await writeFile(path.join(ROOT, `export-${engine}.json`), `${JSON.stringify(receipts, null, 2)}\n`);
}
