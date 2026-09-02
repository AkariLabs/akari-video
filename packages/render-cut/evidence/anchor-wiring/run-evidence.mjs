import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { cp, mkdir, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { lintProject } from '../../../edit-lint/src/edit-lint.mjs';
import { loadAndBuildGpuPage } from '../../../gpu-export/src/page-builder.mjs';
import { refreshItemAnchors, toAnchorCaptions } from '../../../edit-store/lib/index.js';
import { AkariAnnotationsServiceImpl } from '../../../../apps/shell/extensions/akari-annotations/lib/node/akari-annotations-service.js';

const evidenceRoot = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(evidenceRoot, '../../../..');
const fixtureRoot = join(evidenceRoot, 'fixture');
const runsRoot = join(evidenceRoot, 'runs');
const resultsPath = join(evidenceRoot, 'results.json');
const renderCli = join(repositoryRoot, 'packages/render-cut/bin/render-cut.mjs');

await rm(runsRoot, { recursive: true, force: true });
await mkdir(runsRoot, { recursive: true });

const staleProject = await createProject('stale');
const staleEditText = await readFile(join(staleProject, 'edit.json'), 'utf8');
const captionsRoot = JSON.parse(await readFile(join(staleProject, 'captions.json'), 'utf8'));
const anchorCaptions = toAnchorCaptions(captionsRoot);

const staleLint = await lintProject(staleProject);
const staleFindings = staleLint.findings.filter(finding => finding.check === 'v2.item-anchor-stale');
assert.equal(staleFindings.length, 1);

const planOnly = run(process.execPath, [renderCli, staleProject, '--plan-only', '--engine', 'gpu']);
assert.match(planOnly.stdout, /PLAN:/u);
const wiredPlan = await loadAndBuildGpuPage({ projectRoot: staleProject, duration: 4 });
const wiredTiming = overlayTiming(wiredPlan, 'anchored-box');

const refreshedProject = await createProject('refreshed');
const refreshed = refreshItemAnchors(JSON.parse(staleEditText), anchorCaptions);
assert.equal(refreshed.changes.length, 1);
await writeFile(join(refreshedProject, 'edit.json'), json(refreshed.edit));
const refreshedPlan = await loadAndBuildGpuPage({ projectRoot: refreshedProject, duration: 4 });
const refreshedTiming = overlayTiming(refreshedPlan, 'anchored-box');

const cachedProject = await createProject('cached');
await unlink(join(cachedProject, 'captions.json'));
const cachedPlan = await loadAndBuildGpuPage({ projectRoot: cachedProject, duration: 4 });
const cachedTiming = overlayTiming(cachedPlan, 'anchored-box');

assert.deepEqual(wiredTiming, refreshedTiming);
assert.notDeepEqual(wiredTiming, cachedTiming);
assert.deepEqual(wiredTiming, { start: 2, duration: 1 });
assert.deepEqual(cachedTiming, { start: 1.5, duration: 1 });

const wiredMd5 = await renderTimingMd5(staleProject, 'wired', wiredTiming);
const refreshedMd5 = await renderTimingMd5(refreshedProject, 'refreshed', refreshedTiming);
const cachedMd5 = await renderTimingMd5(cachedProject, 'cached', cachedTiming);
assert.equal(wiredMd5.text, refreshedMd5.text);
assert.notEqual(wiredMd5.text, cachedMd5.text);

const writebackProject = await createProject('writeback');
const shiftedCaptions = structuredClone(captionsRoot);
shiftedCaptions[0].start += 0.5;
shiftedCaptions[0].end += 0.5;
await writeFile(join(writebackProject, 'captions.json'), json(shiftedCaptions));
const writeback = refreshItemAnchors(JSON.parse(staleEditText), toAnchorCaptions(shiftedCaptions));
await writeFile(join(writebackProject, 'edit.json'), json(writeback.edit));
const writebackAt = findItem(writeback.edit, 'anchored-box').at;
assert.equal(writebackAt, 75);
const writebackLint = await lintProject(writebackProject);
assert.equal(writebackLint.findings.filter(finding => finding.check === 'v2.item-anchor-stale').length, 0);

const outputDomainProject = await createProject('output-domain');
const outputDomainEdit = JSON.parse(staleEditText);
findItem(outputDomainEdit, 'anchored-box').at = 150;
findItem(outputDomainEdit, 'anchored-box').duration = 30;
await writeFile(join(outputDomainProject, 'edit.json'), json(outputDomainEdit));
await writeFile(join(outputDomainProject, 'captions.json'), json([{
  ...captionsRoot[0], start: 5, end: 6, time_domain: 'output',
}]));
const annotations = new AkariAnnotationsServiceImpl();
await annotations.applyCutRanges({
  editUri: pathToFileURL(join(outputDomainProject, 'edit.json')).toString(),
  projectRootUri: pathToFileURL(outputDomainProject).toString(),
  ranges: [{ in: 1, out: 2, kind: 'silence' }],
  label: 'anchor wiring evidence',
});
const outputDomainAt = findItem(
  JSON.parse(await readFile(join(outputDomainProject, 'edit.json'), 'utf8')),
  'anchored-box',
).at;
assert.equal(outputDomainAt, 150);

const results = {
  version: 1,
  all_pass: true,
  fixture: 'fixture',
  checks: {
    plan_only_exit: planOnly.status,
    stale_lint_findings: staleFindings.length,
    wired_timing: wiredTiming,
    refreshed_timing: refreshedTiming,
    cached_timing_without_captions: cachedTiming,
    wired_matches_refreshed_framemd5: wiredMd5.text === refreshedMd5.text,
    wired_differs_from_cached_framemd5: wiredMd5.text !== cachedMd5.text,
    writeback_at_frames: writebackAt,
    writeback_stale_findings: 0,
    output_domain_at_after_cut_frames: outputDomainAt,
  },
  framemd5: {
    wired_sha256: wiredMd5.sha256,
    refreshed_sha256: refreshedMd5.sha256,
    cached_sha256: cachedMd5.sha256,
  },
  artifacts: {
    stale_edit: 'fixture/edit.stale.json',
    captions: 'fixture/captions.json',
    overlay: 'fixture/overlays/box.html',
    runtime_directory: 'runs (ignored)',
  },
};
await writeFile(resultsPath, json(results));
process.stdout.write(json(results));

async function createProject(name) {
  const root = join(runsRoot, name);
  await cp(fixtureRoot, root, { recursive: true });
  await mkdir(join(root, 'assets'), { recursive: true });
  await cp(join(root, 'edit.stale.json'), join(root, 'edit.json'));
  run('ffmpeg', [
    '-y', '-f', 'lavfi', '-i', 'color=c=0x17324d:s=320x180:r=30:d=4',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', join(root, 'assets/source.mp4'),
  ]);
  return root;
}

async function renderTimingMd5(projectRoot, name, timing) {
  const path = join(runsRoot, `${name}.framemd5`);
  run('ffmpeg', [
    '-y', '-i', join(projectRoot, 'assets/source.mp4'),
    '-vf', `drawbox=x=112:y=66:w=96:h=48:color=0xff5a5f:t=fill:enable=between(t\\,${timing.start}\\,${timing.start + timing.duration})`,
    '-f', 'framemd5', path,
  ]);
  const text = await readFile(path, 'utf8');
  return { text, sha256: createHash('sha256').update(text).digest('hex') };
}

function overlayTiming(plan, id) {
  const overlay = plan.edit.overlays.find(candidate => candidate.id === id);
  if (!overlay) throw new Error(`overlay not found: ${id}`);
  return { start: overlay.start, duration: overlay.duration };
}

function findItem(edit, id) {
  const visit = items => {
    for (const item of items ?? []) {
      if (item.id === id) return item;
      const nested = visit(item.items);
      if (nested) return nested;
    }
    return undefined;
  };
  for (const track of edit.tracks ?? []) {
    const found = visit(track.items);
    if (found) return found;
  }
  throw new Error(`item not found: ${id}`);
}

function run(command, args) {
  const executed = spawnSync(command, args, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    env: process.env,
  });
  if (executed.status !== 0) {
    throw new Error(`${command} failed (${executed.status})\n${executed.stdout}\n${executed.stderr}`);
  }
  return executed;
}

function json(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}
