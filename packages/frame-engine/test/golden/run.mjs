import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const goldenDirectory = dirname(fileURLToPath(import.meta.url));
const packageDirectory = resolve(goldenDirectory, '../..');
const repository = resolve(packageDirectory, '../..');
const generated = resolve(goldenDirectory, '.generated');
const resultsPath = resolve(generated, 'results.json');

execFileSync(process.execPath, [resolve(goldenDirectory, 'generate-fixture.mjs')], {
  cwd: packageDirectory,
  stdio: 'inherit'
});

execFileSync(resolve(repository, 'node_modules/esbuild/bin/esbuild'), [
  resolve(goldenDirectory, 'renderer.ts'),
  '--bundle', '--format=iife', '--platform=browser', '--target=chrome122',
  `--outfile=${resolve(generated, 'renderer.js')}`
], { cwd: packageDirectory, stdio: 'inherit' });

const directElectron = resolve(repository, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
const electron = existsSync(directElectron)
  ? directElectron
  : resolve(repository, 'node_modules/.bin/electron');
const electronEnvironment = { ...process.env };
delete electronEnvironment.ELECTRON_RUN_AS_NODE;
if (existsSync(resultsPath)) unlinkSync(resultsPath);
const execution = spawnSync(electron, ['--no-sandbox', resolve(goldenDirectory, 'main.cjs')], {
  cwd: packageDirectory,
  encoding: 'utf8',
  timeout: 330_000,
  env: electronEnvironment,
  maxBuffer: 16 * 1024 * 1024
});
process.stdout.write(execution.stdout ?? '');
process.stderr.write(execution.stderr ?? '');
if (execution.error) process.stderr.write(`Electron launch error: ${execution.error.message}\n`);

if (!existsSync(resultsPath)) {
  process.stdout.write('Electron GUI launch unavailable; running the same bundle in headless Chromium.\n');
  execFileSync(process.execPath, [resolve(goldenDirectory, 'chromium-run.mjs')], {
    cwd: packageDirectory,
    stdio: 'inherit'
  });
}

const results = JSON.parse(readFileSync(resultsPath, 'utf8'));
assert.equal(results.pass, true);
assert.equal(results.parity.every(sample => sample.pass), true);
assert.equal(results.negative.injectedPixelMutation, true);
assert.equal(results.negative.comparatorPassed, false);
assert.equal(results.negative.differingPixels, 1);
assert.equal(results.encoded.distinctExtractedHashes, 3);
assert.equal(results.semantic.pass, true);
assert.equal(results.layerParity.every(sample => sample.pass), true);
assert.equal(results.layerNegative.injectedPixelMutation, true);
assert.equal(results.layerNegative.comparatorPassed, false);
assert.equal(results.layerNegative.differingPixels, 1);
assert.equal(results.layerSemantic.pass, true);
assert.equal(results.layerStats.imageUploads, 1);
assert.equal(results.layerStats.disposeRecreateDifferingPixels, 0);
assert.equal(results.layerStats.glErrors, 0);
assert.equal(results.matteParity.length >= 3, true);
assert.equal(results.matteParity.every(sample => sample.pass), true);
assert.equal(results.matteNegative.injectedPixelMutation, true);
assert.equal(results.matteNegative.comparatorPassed, false);
assert.equal(results.matteNegative.differingPixels, 1);
assert.equal(results.matteSemantic.pass, true);
assert.ok(results.matteSemantic.withoutMaskDifferingPixels > 0);
assert.deepEqual(results.matteSync, {
  frames: 300,
  mismatches: 0,
  maxDeltaUs: 0,
  maxFrameLag: 0,
  laggedFrames: 0,
});
assert.equal(results.matteStats.vp9Decodes, 0);
assert.ok(results.matteStats.h264Decodes > 0);
assert.equal(results.matteStats.glErrors, 0);
assert.ok(Math.abs(results.encoded.durationSeconds - results.fixture.durationSeconds) <= 1 / 30);

process.stdout.write(`golden PASS: ${results.parity.length} base + ${results.layerParity.length} layer + ${results.matteParity.length} matte parity frames, matte sync=${results.matteSync.frames - results.matteSync.mismatches}/${results.matteSync.frames}, negative differingPixels=${results.negative.differingPixels}, encoded distinct hashes=${results.encoded.distinctExtractedHashes}\n`);
