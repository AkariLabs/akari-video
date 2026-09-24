#!/usr/bin/env node
// Probe the checked-in baseline caption projection with a timing-only cut.
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const evidence = dirname(fileURLToPath(import.meta.url));
const repo = resolve(evidence, '../..');
const baselineRevision = 'b76f12758e857f7f0b688c01d8bbc6799b9c799c';
const scratch = await mkdtemp('/tmp/libcanvas-c0a-baseline-');
try {
  const archive = spawnSync('git', ['archive', baselineRevision, 'packages'], {
    cwd: repo, maxBuffer: 128 * 1024 * 1024
  });
  if (archive.status !== 0) throw new Error('baseline archive failed');
  const unpack = spawnSync('tar', ['-x', '-C', scratch], { input: archive.stdout });
  if (unpack.status !== 0) throw new Error('baseline extraction failed');
  await symlink(join(repo, 'assets'), join(scratch, 'assets'));
  await symlink(join(repo, 'node_modules'), join(scratch, 'node_modules'));
  const require = createRequire(join(scratch, 'packages/edit-store/lib/index.js'));
  const { readInternalEdit, collectExcludedCaptionIds } = require(join(scratch, 'packages/edit-store/lib/index.js'));
  const { captionItemOverlays } = await import(pathToFileURL(join(scratch, 'packages/render-cut/src/internal-render.mjs')));
  const { readRenderEdit } = await import(pathToFileURL(join(scratch, 'packages/render-cut/src/internal-render.mjs')));
  const { evaluateGpuEligibility } = await import(pathToFileURL(join(scratch, 'packages/gpu-export/src/eligibility.mjs')));
  const projectRoot = join(evidence, 'fixture');
  const internal = readInternalEdit(await readFile(join(projectRoot, 'edit.json'), 'utf8'));
  const overlays = captionItemOverlays(internal, projectRoot, {
    cuts: [{ in: 0, out: 4, at: 0, src: '__timing_only__' }],
    output: { width: 640, height: 360 },
    onWarning: () => {}
  }).filter(overlay => overlay.id === 'caption-line');
  const result = {
    baselineRevision,
    captionItemCount: overlays.length,
    projection: overlays.map(overlay => ({
      start: overlay.start, duration: overlay.duration,
      transform: overlay.transform,
      opacity: overlay.opacity ?? null
    }))
  };
  const directRoot = join(repo, 'packages/render-cut/test/fixtures/caption-item-render');
  const direct = readRenderEdit(await readFile(join(directRoot, 'edit.json'), 'utf8'),
    join(directRoot, '.akari/render-tmp'), { projectRoot: directRoot });
  result.directCaptionGpuEligibility = evaluateGpuEligibility({ edit: direct.edit }).entries
    .filter(entry => entry.id === 'c2-out');
  const directControlRoot = join(evidence, 'fixture-caption-direct');
  const directInternal = readInternalEdit(await readFile(join(directControlRoot, 'edit.json'), 'utf8'));
  const directExcluded = collectExcludedCaptionIds(directInternal);
  const directOverlays = captionItemOverlays(directInternal, directControlRoot, {
    cuts: [{ in: 0, out: 4, at: 0, src: '__timing_only__' }],
    output: { width: 640, height: 360 }, onWarning: () => {}
  }).filter(overlay => overlay.id === 'caption-line');
  result.directComposedControl = {
    previewCaptionRows: [{ id: 'c-0001' }].filter(row => !directExcluded.has(row.id)).length,
    exportCaptionRecords: directOverlays.length,
    exportProjection: directOverlays.map(overlay => ({ start: overlay.start,
      duration: overlay.duration, transform: overlay.transform,
      opacity: overlay.opacity ?? null }))
  };
  await writeFile(join(evidence, 'before-caption-projection.json'), JSON.stringify(result, null, 2) + '\n');
} finally {
  await rm(scratch, { recursive: true, force: true });
}
