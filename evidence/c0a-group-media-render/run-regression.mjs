#!/usr/bin/env node
// Runs two earlier top-level-only fixtures against the pinned base and this worktree.
// Hold the heavy slot while running this script.
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const evidence = dirname(fileURLToPath(import.meta.url));
const repo = resolve(evidence, '../..');
const baselineRevision = 'b76f12758e857f7f0b688c01d8bbc6799b9c799c';
const scratch = await mkdtemp('/tmp/libcanvas-c0a-regression-');
const baseline = join(scratch, 'baseline');
const output = join(evidence, 'regression');
const ffmpeg = process.env.AKARI_FFMPEG || 'ffmpeg';
const fixtures = [
  { name: 'engine-parity', relative: 'packages/render-cut/evidence/fieldreport-export-engine-parity/fixture', fps: 30, width: 320, height: 180, duration: 3 },
  { name: 'flat-overlay', relative: 'packages/render-cut/evidence/fieldreport-export-engine-parity/fixture-flat', fps: 30, width: 320, height: 180, duration: 3 }
];
const result = { baselineRevision, fixtures: {} };
const clean = text => String(text).replaceAll(repo, '<repo>')
  .replaceAll(`/private${scratch}`, '<scratch>').replaceAll(scratch, '<scratch>')
  .replace(/\/Users\/[^\s"']+/g, '<local>');
const run = (cmd, args, options = {}) => {
  const p = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, AKARI_HOME: join(scratch, 'akari-home') }, ...options });
  return { code: p.status, ...(p.status === 0 ? {} : { error: clean(p.stderr ?? p.error?.message ?? '').slice(-1600) }) };
};
const rgb = path => spawnSync(ffmpeg, ['-hide_banner','-loglevel','error','-i',path,
  '-f','rawvideo','-pix_fmt','rgb24','-'], { maxBuffer: 320 * 180 * 4 }).stdout;
const compare = (a, b) => {
  const x = rgb(a), y = rgb(b);
  if (!x || !y || x.length !== y.length) return { error: 'decode or size mismatch' };
  let max = 0, sum = 0;
  for (let i = 0; i < x.length; i++) { const delta = Math.abs(x[i] - y[i]); max = Math.max(max, delta); sum += delta; }
  return { max, mean: sum / x.length };
};

try {
  await mkdir(baseline, { recursive: true });
  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });
  const archive = spawnSync('git', ['archive', baselineRevision, 'packages', 'skills'], { cwd: repo, maxBuffer: 128 * 1024 * 1024 });
  if (archive.status !== 0) throw new Error('baseline archive failed');
  const unpack = spawnSync('tar', ['-x', '-C', baseline], { input: archive.stdout });
  if (unpack.status !== 0) throw new Error('baseline extraction failed');
  await symlink(join(repo, 'node_modules'), join(baseline, 'node_modules'));
  await symlink(join(repo, 'assets'), join(baseline, 'assets'));
  for (const fixture of fixtures) {
    const project = join(repo, fixture.relative);
    const receipts = {};
    for (const engine of ['gpu', 'osr']) {
      for (const [phase, root] of [['head', baseline], ['worktree', repo]]) {
        const mp4 = join(scratch, `${fixture.name}-${engine}-${phase}.mp4`);
        const cli = join(root, 'packages', `${engine}-export`, 'bin', `akari-${engine}-export.mjs`);
        const invocation = run(process.execPath, [cli, project, '--out', mp4, '--duration', String(fixture.duration),
          '--frames', String(fixture.fps * fixture.duration), '--fps', String(fixture.fps),
          '--width', String(fixture.width), '--height', String(fixture.height), '--soft']);
        receipts[`${engine}-${phase}`] = invocation;
        if (invocation.code !== 0) continue;
        const png = join(output, `${fixture.name}-${engine}-${phase}.png`);
        receipts[`${engine}-${phase}-frame`] = run(ffmpeg, ['-hide_banner','-loglevel','error','-y',
          '-ss', String(fixture.duration / 2), '-i', mp4, '-frames:v','1',png]);
      }
      if (receipts[`${engine}-head-frame`]?.code === 0 && receipts[`${engine}-worktree-frame`]?.code === 0) {
        receipts[`${engine}-difference`] = compare(join(output, `${fixture.name}-${engine}-head.png`),
          join(output, `${fixture.name}-${engine}-worktree.png`));
      }
    }
    result.fixtures[fixture.name] = receipts;
  }
} catch (error) { result.error = clean(error?.stack ?? error); }
finally {
  await writeFile(join(evidence, 'regression.json'), JSON.stringify(result, null, 2) + '\n');
  await rm(scratch, { recursive: true, force: true });
}
if (result.error) process.exitCode = 1;
