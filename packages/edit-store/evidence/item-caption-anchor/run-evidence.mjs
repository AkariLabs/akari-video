import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const evidenceRoot = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(evidenceRoot, '../../../..');
const fixtureRoot = join(evidenceRoot, 'fixture');
const editPath = join(fixtureRoot, 'edit.json');
const staleEditPath = join(fixtureRoot, 'edit.stale.json');
const captionsPath = join(fixtureRoot, 'captions.json');
const outputsRoot = join(evidenceRoot, 'outputs');
const resultsPath = join(evidenceRoot, 'results.json');
const fixtureExportsRoot = join(fixtureRoot, 'exports');
const sourcePath = join(fixtureRoot, 'assets', 'source.mp4');
const lintCli = join(repositoryRoot, 'packages/edit-lint/bin/edit-lint.mjs');
const renderCli = join(repositoryRoot, 'packages/render-cut/bin/render-cut.mjs');
const osrMain = join(repositoryRoot, 'packages/osr-export/src/electron-main.mjs');
const requireFromEvidence = createRequire(import.meta.url);
const { refreshItemAnchors } = await import('../../lib/index.js');

const staleText = await readFile(staleEditPath, 'utf8');
const originalCaptionsText = await readFile(captionsPath, 'utf8');
let shimRoot;

try {
  await rm(join(fixtureRoot, '.akari'), { recursive: true, force: true });
  await rm(fixtureExportsRoot, { recursive: true, force: true });
  await rm(outputsRoot, { recursive: true, force: true });
  await rm(resultsPath, { force: true });
  await mkdir(dirname(sourcePath), { recursive: true });
  await mkdir(outputsRoot, { recursive: true });
  await writeFile(editPath, staleText, 'utf8');

  const electronExecutable = requireFromEvidence('electron');
  if (typeof electronExecutable !== 'string' || electronExecutable.length === 0) {
    throw new Error('electron package did not resolve to an executable path');
  }
  shimRoot = await mkdtemp(join(tmpdir(), 'akari-item-caption-anchor-'));
  const shimPath = join(shimRoot, 'electron-shim');
  await writeFile(
    shimPath,
    `#!/bin/sh\nexec ${shellQuote(electronExecutable)} ${shellQuote(osrMain)} "$@"\n`,
    'utf8',
  );
  await chmod(shimPath, 0o755);
  const renderEnvironment = { AKARI_OSR_ELECTRON: shimPath };

  run('ffmpeg', [
    '-y',
    '-f', 'lavfi', '-i', 'color=c=0x1754a6:s=320x180:r=30:d=5',
    '-f', 'lavfi', '-i', 'color=c=0xc73535:s=320x180:r=30:d=5',
    '-filter_complex', '[0:v][1:v]concat=n=2:v=1:a=0[v]',
    '-map', '[v]', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', sourcePath,
  ]);

  const initialLint = lint();
  const initialAnchorFindings = initialLint.findings.filter(finding => finding.check.startsWith('v2.item-anchor-'));
  assert.deepEqual(initialAnchorFindings.map(finding => finding.check), ['v2.item-anchor-stale']);

  const captions = parseCaptions(originalCaptionsText);
  const staleEdit = JSON.parse(staleText);
  const expected = {
    at: Math.round((4 + (6.2 - 5)) * 30),
    duration: Math.round(6.7 * 30) - Math.round(6.2 * 30),
  };
  const refreshed = refreshItemAnchors(staleEdit, captions);
  assert.deepEqual(refreshed.warnings, []);
  assert.equal(refreshed.changes.length, 1);
  const refreshedItem = findItem(refreshed.edit, 'word-box');
  assert.deepEqual({ at: refreshedItem.at, duration: refreshedItem.duration }, expected);
  await writeFile(editPath, `${JSON.stringify(refreshed.edit, null, 2)}\n`, 'utf8');

  const refreshedLint = lint();
  assert.equal(refreshedLint.findings.length, 0, JSON.stringify(refreshedLint.findings, null, 2));

  const anchoredFixtureOutput = join(fixtureExportsRoot, 'anchored.mp4');
  render('exports/anchored.mp4', renderEnvironment);
  const anchoredFrames = probeFrameCount(anchoredFixtureOutput);
  assert.equal(anchoredFrames, 270);
  const anchoredOutput = join(outputsRoot, 'anchored.mp4');
  await copyFile(anchoredFixtureOutput, anchoredOutput);
  const anchoredMd5 = join(outputsRoot, 'anchored.framemd5');
  run('ffmpeg', ['-y', '-i', anchoredOutput, '-f', 'framemd5', anchoredMd5]);

  const manualEdit = structuredClone(refreshed.edit);
  delete findItem(manualEdit, 'word-box').anchor;
  await writeFile(editPath, `${JSON.stringify(manualEdit, null, 2)}\n`, 'utf8');
  const manualLint = lint();
  assert.equal(manualLint.findings.length, 0, JSON.stringify(manualLint.findings, null, 2));
  const manualFixtureOutput = join(fixtureExportsRoot, 'manual.mp4');
  render('exports/manual.mp4', renderEnvironment);
  const manualFrames = probeFrameCount(manualFixtureOutput);
  assert.equal(manualFrames, 270);
  const manualOutput = join(outputsRoot, 'manual.mp4');
  await copyFile(manualFixtureOutput, manualOutput);
  const manualMd5 = join(outputsRoot, 'manual.framemd5');
  run('ffmpeg', ['-y', '-i', manualOutput, '-f', 'framemd5', manualMd5]);
  const framemd5Match = await readFile(anchoredMd5, 'utf8') === await readFile(manualMd5, 'utf8');
  assert.equal(framemd5Match, true);

  const shiftedCaptions = structuredClone(captions);
  const shifted = shiftedCaptions.find(caption => caption.id === 'c-0002');
  shifted.start += 0.5;
  shifted.end += 0.5;
  for (const word of shifted.words) {
    word.start += 0.5;
    word.end += 0.5;
  }
  const shiftedEdit = structuredClone(refreshed.edit);
  const shiftedAnchor = findItem(shiftedEdit, 'word-box').anchor;
  shiftedAnchor.range.start += 0.5;
  shiftedAnchor.range.end += 0.5;
  const shiftedResult = refreshItemAnchors(shiftedEdit, shiftedCaptions);
  const shiftedAt = findItem(shiftedResult.edit, 'word-box').at;
  assert.equal(shiftedAt - expected.at, Math.round(0.5 * 30));

  const results = {
    version: 1,
    all_pass: true,
    fixture: 'fixture',
    launcher: {
      kind: 'npm-electron-via-akari-osr-electron-shim',
      resolver_tier: 1,
      runtime: 'worktree-osr-export',
      installed_app_used: false,
      installed_app_skip_reason: 'bundled-edit-store-missing-item-anchor',
    },
    expected_cache: expected,
    checks: {
      initial_stale_warning: initialAnchorFindings.length === 1,
      refresh_expected_cache: true,
      refreshed_lint_findings: refreshedLint.findings.length,
      anchored_render_frames: anchoredFrames,
      manual_render_frames: manualFrames,
      render_cut_full_exports: 2,
      framemd5_match: framemd5Match,
      caption_shift_frames: shiftedAt - expected.at,
      expected_shift_frames: Math.round(0.5 * 30),
    },
    artifacts: {
      source: relative(evidenceRoot, sourcePath),
      anchored_mp4: relative(evidenceRoot, anchoredOutput),
      manual_mp4: relative(evidenceRoot, manualOutput),
      anchored_framemd5: relative(evidenceRoot, anchoredMd5),
      manual_framemd5: relative(evidenceRoot, manualMd5),
      anchored_sha256: await sha256(anchoredOutput),
      manual_sha256: await sha256(manualOutput),
    },
  };
  await writeFile(resultsPath, `${JSON.stringify(results, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
} finally {
  await writeFile(editPath, staleText, 'utf8');
  await writeFile(captionsPath, originalCaptionsText, 'utf8');
  await rm(join(fixtureRoot, '.akari'), { recursive: true, force: true });
  await rm(fixtureExportsRoot, { recursive: true, force: true });
  if (shimRoot) await rm(shimRoot, { recursive: true, force: true });
}

function lint() {
  const executed = run(process.execPath, [lintCli, fixtureRoot, '--json']);
  return JSON.parse(executed.stdout);
}

function render(output, environment) {
  run(process.execPath, [
    renderCli, fixtureRoot, '--out', output, '--engine', 'osr',
  ], { env: environment });
}

function probeFrameCount(path) {
  const executed = run('ffprobe', [
    '-v', 'error', '-count_frames', '-select_streams', 'v:0',
    '-show_entries', 'stream=nb_read_frames',
    '-of', 'default=noprint_wrappers=1:nokey=1', path,
  ]);
  const frames = Number(executed.stdout.trim());
  if (!Number.isInteger(frames)) throw new Error(`ffprobe returned an invalid frame count: ${executed.stdout.trim()}`);
  return frames;
}

function run(command, args, options = {}) {
  const executed = spawnSync(command, args, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    env: { ...process.env, ...(options.env ?? {}) },
  });
  if (executed.status !== 0) {
    throw new Error(`${command} failed (${executed.status})\n${executed.stdout}\n${executed.stderr}`);
  }
  return executed;
}

function parseCaptions(text) {
  return JSON.parse(text).map(caption => ({
    ...caption,
    ...(caption.time_domain === 'output' ? { timeDomain: 'output' } : {}),
  }));
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
  for (const track of edit.tracks) {
    const item = visit(track.items);
    if (item) return item;
  }
  throw new Error(`item not found: ${id}`);
}

function shellQuote(value) {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

async function sha256(path) {
  return createHash('sha256').update(await readFile(path)).digest('hex');
}
