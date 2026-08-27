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
const requestedUploadPath = process.env.FRAME_ENGINE_UPLOAD_PATH === 'copyTo' ? 'copyTo' : 'direct';

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
assert.deepEqual(results.uploadPath.requested, requestedUploadPath);
assert.deepEqual(results.uploadPath.effective, requestedUploadPath);
if (requestedUploadPath === 'direct') assert.equal(results.uploadPath.fallbackReason, null);
assert.equal(results.colorPatches.pass, true);
assert.equal(results.colorPatches.direct.pass, true);
assert.equal(results.colorPatches.copyTo.pass, true);
assert.equal(results.colorPatches.maskFidelity.pass, true);
assert.equal(results.colorPatches.direct.rows.every(row => row.timestampInWindow), true);
assert.equal(results.colorPatches.copyTo.rows.every(row => row.timestampInWindow), true);
assert.equal(results.texturedCrossPathDiff.rows.length >= 3, true);
assert.equal(results.texturedCrossPathDiff.directUploadPath, 'direct');
assert.equal(results.texturedCrossPathDiff.copyToUploadPath, 'copyTo');
assert.equal(results.frameLifetime.pass, true);
assert.equal(results.frameLifetime.frames, 1_000);
assert.equal(results.frameLifetime.openFrames, 0);
assert.equal(results.frameLifetime.decodeQueueSizeFinal, 0);
assert.equal(results.transitionParity.length, 90);
assert.equal(results.transitionParity.every(sample => sample.pass), true);
assert.equal(results.transitionNegative.injectedPixelMutation, true);
assert.equal(results.transitionNegative.differingPixels, 1);
assert.equal(results.transitionSemantics.rows.length, 30);
assert.equal(results.transitionSemantics.pass, true);
assert.deepEqual(results.transitionSemantics.mismatches, []);
assert.equal(results.transitionSemantics.rows.every(row => typeof row.expected === 'string'), true);
assert.equal(results.transitionSemantics.rows.every(row => row.expectedDetail && typeof row.expectedDetail === 'object'), true);
assert.equal(results.transitionStats.glErrors, 0);
assert.equal(results.lookParity.length, 20);
assert.equal(results.lookParity.every(sample => sample.pass), true);
assert.equal(results.lookIntensity.length, 3);
assert.equal(results.lookIntensity.every(sample => sample.pass), true);
assert.equal(results.lookIntensity.find(sample => sample.intensity === 0).baselineDifferingPixels, 0);
assert.equal(results.lookStats.glErrors, 0);
assert.equal(results.gopTail.rows.length, 9);
assert.equal(results.gopTail.rows.every(row => row.pass), true);
assert.equal(results.gopTail.rows.every(row => row.decodedFrameNumber === row.frameNumber), true);
assert.deepEqual([...new Set(results.gopTail.rows.map(row => row.category))].sort(), ['base', 'layers', 'matte']);
assert.equal(results.gopTail.rows.some(row => row.category === 'base' && row.frameNumber === 239), true);
assert.equal(results.gopTail.rows.some(row => row.category === 'layers' && row.frameNumber === 239), true);
assert.equal(results.gopTail.rows.some(row => row.category === 'matte' && row.frameNumber === 389), true);
assert.equal(results.bFrame.coverage, 'sampled');
assert.equal(results.bFrame.rows.length, 160);
assert.equal(results.bFrame.rows.every(row => row.pass), true);
assert.equal(results.bFrame.offsets.every(row => row.pass), true);
assert.equal(results.bFrame.summaries.length, 10);
assert.equal(results.bFrame.summaries.every(row => row.mismatches === 0), true);
assert.equal(results.bFrameTail.rows.length, 24);
assert.equal(results.bFrameTail.rows.every(row => row.pass), true);
assert.equal(new Set(results.bFrameTail.rows.map(row => row.variant)).size, 4);
assert.equal(results.bFrameTail.rows.filter(row => [357, 358, 359].includes(row.requestedFrame)).length, 12);
assert.equal(results.parity.every(sample => sample.pass), true);
assert.equal(results.negative.injectedPixelMutation, true);
assert.equal(results.negative.comparatorPassed, false);
assert.equal(results.negative.differingPixels, 1);
assert.equal(results.encoded.distinctExtractedHashes, 3);
assert.equal(results.semantic.pass, true);
assert.equal(results.layerParity.every(sample => sample.pass), true);
assert.equal(results.layerParity.length, 36);
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

process.stdout.write(`golden PASS: ${results.parity.length} base + ${results.layerParity.length} layer + ${results.matteParity.length} matte + ${results.transitionParity.length} transition + ${results.lookParity.length} LUT parity frames, matte sync=${results.matteSync.frames - results.matteSync.mismatches}/${results.matteSync.frames}, negative differingPixels=${results.negative.differingPixels}, encoded distinct hashes=${results.encoded.distinctExtractedHashes}\n`);
