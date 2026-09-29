import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const testDir = dirname(fileURLToPath(import.meta.url));
const packageDir = resolve(testDir, '..');
const repository = resolve(packageDir, '../..');
const fixtureDir = resolve(process.env.AKARI_STALL_FIXTURE_DIR
  ?? resolve(tmpdir(), 'akari-base-decoder-stall'));
const evidenceDir = resolve(packageDir, 'evidence/base-decoder-stall');
const low = resolve(fixtureDir, 'low20k.mp4');
const real = process.env.AKARI_BASE_INK_MP4;
const baseline = process.env.AKARI_STALL_BASELINE === '1';
// Red → green: AKARI_STALL_BASELINE=1 AKARI_STALL_BASELINE_REF=<pre-fix-commit> node test/base-decoder-stall.mjs
// Then run node test/base-decoder-stall.mjs against the current source.
const baselineRef = process.env.AKARI_STALL_BASELINE_REF?.trim();
if (baseline && !baselineRef) {
  throw new Error('AKARI_STALL_BASELINE=1 requires AKARI_STALL_BASELINE_REF=<pre-fix-commit>');
}
mkdirSync(fixtureDir, { recursive: true });
mkdirSync(evidenceDir, { recursive: true });

function probe(file) {
  return JSON.parse(execFileSync('ffprobe', [
    '-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height,r_frame_rate,has_b_frames,bit_rate,nb_frames',
    '-show_entries', 'format=duration', '-of', 'json', file,
  ], { encoding: 'utf8' }));
}

let lowValid = false;
if (existsSync(low) && statSync(low).size > 100_000) {
  try {
    const info = probe(low);
    lowValid = info.streams?.[0]?.width === 1920
      && info.streams?.[0]?.height === 1080
      && Number(info.streams?.[0]?.has_b_frames) > 0
      && Number(info.format?.duration) >= 239.9;
  } catch { /* Regenerate a partial fixture. */ }
}
if (!lowValid) {
  execFileSync('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi',
    '-i', 'color=c=0x1a1a2a:s=1920x1080:r=30:d=240', '-an',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '28',
    '-g', '300', '-keyint_min', '300', '-sc_threshold', '0', '-bf', '2',
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart', low,
  ], { stdio: 'inherit', timeout: 240_000 });
}
if (real) assert.equal(existsSync(real), true, 'AKARI_BASE_INK_MP4 does not exist');
const sources = { low, ...(real ? { real } : {}) };
const fixture = Object.fromEntries(Object.entries(sources).map(([key, file]) => {
  const info = probe(file);
  return [key, {
    bytes: statSync(file).size,
    width: info.streams?.[0]?.width,
    height: info.streams?.[0]?.height,
    fps: info.streams?.[0]?.r_frame_rate,
    frames: Number(info.streams?.[0]?.nb_frames),
    hasBFrames: info.streams?.[0]?.has_b_frames,
    bitrateBps: Number(info.streams?.[0]?.bit_rate),
    durationSeconds: Number(info.format?.duration),
  }];
}));

const originalSource = baseline
  ? execFileSync('git', ['show', `${baselineRef}:packages/frame-engine/src/decode/range-mp4-source.ts`], {
    cwd: repository, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024,
  })
  : null;
const bundle = await build({
  entryPoints: [resolve(testDir, 'base-decoder-stall-renderer.js')],
  bundle: true, format: 'iife', platform: 'browser', target: 'chrome122', write: false,
  plugins: originalSource ? [{
    name: 'baseline-range-source',
    setup(builder) {
      builder.onLoad({ filter: /range-mp4-source\.ts$/u }, args => ({
        contents: originalSource, loader: 'ts', resolveDir: dirname(args.path),
      }));
    },
  }] : [],
});
const suffix = baseline ? 'baseline' : 'current';
const bundlePath = resolve(fixtureDir, `base-decoder-stall-${suffix}.js`);
const configPath = resolve(fixtureDir, `base-decoder-stall-${suffix}.config.json`);
const resultPath = resolve(fixtureDir, `base-decoder-stall-${suffix}.result.json`);
writeFileSync(bundlePath, bundle.outputFiles[0].text);
const scenarios = baseline ? [{ key: 'low', prefetch: true, hold: 2 }] : Object.keys(sources).flatMap(key => [
  { key, prefetch: false, hold: 8 },
  { key, prefetch: true, hold: 2 },
  { key, prefetch: true, hold: 8 },
]);
writeFileSync(configPath, JSON.stringify({
  bundle: bundlePath, result: resultPath, sources, scenarios,
  userData: resolve(fixtureDir, 'electron-stall-userdata'),
}));
rmSync(resultPath, { force: true });
const environment = { ...process.env, AKARI_STALL_CONFIG: configPath };
delete environment.ELECTRON_RUN_AS_NODE;
const electron = createRequire(import.meta.url)('electron');
const execution = spawnSync(electron, [resolve(testDir, 'base-decoder-stall-main.cjs')], {
  cwd: packageDir, env: environment, encoding: 'utf8', timeout: 450_000,
  maxBuffer: 16 * 1024 * 1024,
});
process.stdout.write(execution.stdout ?? '');
if (execution.error) process.stderr.write(`${execution.error}\n`);
if (!existsSync(resultPath)) {
  process.stderr.write((execution.stderr ?? '').slice(-3000));
  throw new Error('Electron did not write stall test results');
}
const result = JSON.parse(readFileSync(resultPath, 'utf8'));
const evidence = { baseline, fixture, ...result };
writeFileSync(resolve(evidenceDir, baseline ? 'electron-baseline.json' : 'electron-run.json'),
  `${JSON.stringify(evidence, null, 2)}\n`);
assert.equal(result.error, null, result.error);
assert.equal(execution.status, 0, `Electron exited ${execution.status}`);
assert.equal(result.runs.length, scenarios.length);
for (const run of result.runs) {
  const label = `${run.scenario.key} prefetch=${run.scenario.prefetch} hold=${run.scenario.hold}`;
  assert.equal(run.acceleration, 'prefer-hardware', `${label}: hardware decoder was not selected`);
  assert.equal(run.error, null, `${label}: ${run.error}`);
  assert.equal(run.requestedCount, 270, `${label}: incomplete frame sequence`);
  assert.equal(run.rows.length, 6, `${label}: missing seek endpoints`);
  assert.ok(run.rows.every(row => row.requested === row.decoded), `${label}: incorrect pts`);
  assert.equal(run.recreateCount, 0, `${label}: decoder was recreated`);
  assert.equal(run.stats.fullBodyFallback, false, `${label}: Range fallback`);
  assert.ok(run.p50Ms < 50, `${label}: p50 decode regressed`);
}
