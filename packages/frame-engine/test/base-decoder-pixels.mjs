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
const fixtureDir = resolve(process.env.AKARI_STALL_FIXTURE_DIR
  ?? resolve(tmpdir(), 'akari-base-decoder-stall'));
const evidenceDir = resolve(packageDir, 'evidence/base-decoder-stall');
mkdirSync(fixtureDir, { recursive: true });
mkdirSync(evidenceDir, { recursive: true });

function makeFixture(name, args) {
  const file = resolve(fixtureDir, name);
  if (!existsSync(file) || statSync(file).size < 10_000) {
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args, file],
      { stdio: 'inherit', timeout: 240_000 });
  }
  return file;
}
const colorOptions = ['-vf', 'setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=limited',
  '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28',
  '-g', '300', '-keyint_min', '300', '-sc_threshold', '0', '-bf', '2',
  '-x264-params', 'colorprim=bt709:transfer=bt709:colormatrix=bt709:range=tv',
  '-pix_fmt', 'yuv420p', '-color_primaries', 'bt709', '-color_trc', 'bt709',
  '-colorspace', 'bt709', '-color_range', 'tv', '-movflags', '+faststart'];
const testsrc = makeFixture('pixel-testsrc2-bt709.mp4', [
  '-f', 'lavfi', '-i', 'testsrc2=s=1920x1080:r=30:d=20', ...colorOptions,
]);
const bars = makeFixture('pixel-smptehdbars-bt709.mp4', [
  '-f', 'lavfi', '-i', 'smptehdbars=s=1920x1080:r=30:d=20', ...colorOptions,
]);
const rotateSource = makeFixture('pixel-rotate-source-bt709.mp4', [
  '-f', 'lavfi', '-i', 'testsrc2=s=320x180:r=30:d=2', ...colorOptions,
]);
const rotate = resolve(fixtureDir, 'pixel-rotate-90-bt709.mp4');
if (!existsSync(rotate)) {
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y',
    '-display_rotation', '90', '-i', rotateSource,
    '-map', '0:v:0', '-an', '-c', 'copy', '-movflags', '+faststart', rotate],
  { stdio: 'inherit', timeout: 60_000 });
}
for (const fixture of [testsrc, bars, rotate]) {
  const probe = JSON.parse(execFileSync('ffprobe', [
    '-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=color_range,color_space,color_transfer,color_primaries,has_b_frames',
    '-of', 'json', fixture,
  ], { encoding: 'utf8' }));
  const stream = probe.streams?.[0];
  assert.equal(stream?.color_range, 'tv');
  assert.equal(stream?.color_space, 'bt709');
  assert.equal(stream?.color_transfer, 'bt709');
  assert.equal(stream?.color_primaries, 'bt709');
  assert.ok(stream?.has_b_frames > 0);
}
const real = process.env.AKARI_BASE_INK_MP4
  ?? (process.platform === 'win32' ? resolve(fixtureDir, 'real-base-ink.mp4') : null);
assert.ok(real && existsSync(real), 'AKARI_BASE_INK_MP4 copy is required');
const sources = { testsrc, bars, rotate, real };
const scenarios = [
  { key: 'testsrc', frames: [236, 505], width: 1920, height: 1080 },
  { key: 'bars', frames: [236, 505], width: 1920, height: 1080 },
  { key: 'rotate', frames: [10, 30], width: 180, height: 320 },
  { key: 'real', frames: [236, 505, 788], width: 1920, height: 1080 },
].filter(scenario => !process.env.AKARI_PIXEL_KEYS
  || process.env.AKARI_PIXEL_KEYS.split(',').includes(scenario.key));
const bundle = await build({
  entryPoints: [resolve(testDir, 'base-decoder-pixels-renderer.js')],
  bundle: true, format: 'iife', platform: 'browser', target: 'chrome122', write: false,
});
const bundlePath = resolve(fixtureDir, 'base-decoder-pixels.js');
const configPath = resolve(fixtureDir, 'base-decoder-pixels.config.json');
const resultPath = resolve(fixtureDir, 'base-decoder-pixels.result.json');
writeFileSync(bundlePath, bundle.outputFiles[0].text);
writeFileSync(configPath, JSON.stringify({
  bundle: bundlePath, result: resultPath, sources, scenarios,
  userData: resolve(fixtureDir, 'electron-pixels-userdata'),
}));
rmSync(resultPath, { force: true });
const environment = { ...process.env, AKARI_PIXEL_CONFIG: configPath };
delete environment.ELECTRON_RUN_AS_NODE;
const execution = spawnSync(createRequire(import.meta.url)('electron'),
  [resolve(testDir, 'base-decoder-pixels-main.cjs')], {
    cwd: packageDir, env: environment, encoding: 'utf8', timeout: 450_000,
    maxBuffer: 16 * 1024 * 1024,
  });
if (execution.error) process.stderr.write(`${execution.error}\n`);
if (!existsSync(resultPath)) {
  process.stderr.write((execution.stderr ?? '').slice(-3000));
  throw new Error('Electron did not write pixel test results');
}
const result = JSON.parse(readFileSync(resultPath, 'utf8'));
const fixture = Object.fromEntries(Object.entries(sources).map(([key, file]) => {
  const probe = JSON.parse(execFileSync('ffprobe', [
    '-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height,coded_width,coded_height,color_range,color_space,color_transfer,color_primaries,has_b_frames',
    '-of', 'json', file,
  ], { encoding: 'utf8' }));
  return [key, { bytes: statSync(file).size, ...probe.streams?.[0] }];
}));
writeFileSync(resolve(evidenceDir, 'pixel-parity.json'), `${JSON.stringify({ fixture, ...result }, null, 2)}\n`);
assert.equal(result.error, null, result.error);
assert.equal(execution.status, 0, `Electron exited ${execution.status}`);
assert.deepEqual(result.oddVisibleRect,
  { width: 3, height: 3, yBytes: 9, uBytes: 4, vBytes: 4 });
assert.equal(result.legacyCodedPadding.codedHeight, 1088);
assert.equal(result.legacyCodedPadding.visibleHeight, 1080);
assert.ok(result.legacyCodedPadding.max.some(value => value > 2));
for (const row of result.rows) {
  process.stdout.write(`${row.key} frame=${row.frame} ${row.path}: max=${row.max.join('/')}, mean=${row.mean.map(x => x.toFixed(3)).join('/')}\n`);
  assert.equal(row.acceleration, 'prefer-hardware');
  assert.ok(row.max.every(value => value <= 2), `${row.key} ${row.path}: pixel difference exceeds 2`);
  assert.equal(row.metadataMatch, true, `${row.key}: frame metadata differs`);
  assert.equal(row.nativeCallerFramesBefore, 3, `${row.key}: native frame side was not exercised`);
  assert.equal(row.nativeCallerFramesAfter, 3, `${row.key}: detached frame side was not exercised`);
  if (row.key === 'rotate') assert.equal(row.rotationDeg, 90, 'rotation metadata was lost');
  else assert.equal(row.native.codedHeight, 1088, `${row.key}: expected 1088 coded rows`);
}
assert.equal(result.rows.length, scenarios.reduce((total, scenario) => total + scenario.frames.length * 2, 0));
