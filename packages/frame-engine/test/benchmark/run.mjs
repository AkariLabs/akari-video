import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url));
const packageDirectory = resolve(directory, '../..');
const repository = resolve(packageDirectory, '../..');
const generated = resolve(directory, '.generated');
const resultsPath = resolve(generated, 'benchmark-results.json');
const goldenResultsPath = resolve(packageDirectory, 'test/golden/.generated/results.json');
const repeatCount = Number(process.env.BENCH_REPEAT ?? '3');
const requestedUploadPath = process.env.FRAME_ENGINE_UPLOAD_PATH === 'copyTo' ? 'copyTo' : 'direct';
if (!Number.isInteger(repeatCount) || repeatCount < 1) {
  throw new Error(`BENCH_REPEAT must be a positive integer, got ${process.env.BENCH_REPEAT}`);
}

function hasCurrentGoldenResult() {
  if (!existsSync(goldenResultsPath)) return false;
  try {
    const golden = JSON.parse(readFileSync(goldenResultsPath, 'utf8'));
    return golden.pass === true
      && golden.semantic?.pass === true
      && golden.parity?.length === 28
      && golden.uploadPath?.requested === requestedUploadPath;
  } catch {
    return false;
  }
}

if (!hasCurrentGoldenResult()) {
  execFileSync(process.execPath, [resolve(packageDirectory, 'test/golden/run.mjs')], {
    cwd: packageDirectory,
    stdio: 'inherit'
  });
}

execFileSync(process.execPath, [resolve(directory, 'generate-fixture.mjs')], {
  cwd: packageDirectory, stdio: 'inherit'
});
execFileSync(resolve(repository, 'node_modules/esbuild/bin/esbuild'), [
  resolve(directory, 'renderer.ts'), '--bundle', '--format=iife', '--platform=browser',
  '--target=chrome122', `--outfile=${resolve(generated, 'renderer.js')}`
], { cwd: packageDirectory, stdio: 'inherit' });
if (existsSync(resultsPath)) unlinkSync(resultsPath);
const directElectron = resolve(repository, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
const electron = existsSync(directElectron) ? directElectron : resolve(repository, 'node_modules/.bin/electron');
const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;
const run = spawnSync(electron, ['--no-sandbox', resolve(directory, 'main.cjs')], {
  cwd: packageDirectory,
  encoding: 'utf8',
  timeout: 4_200_000,
  env: environment,
  maxBuffer: 64 * 1024 * 1024
});
process.stdout.write(run.stdout ?? '');
process.stderr.write(run.stderr ?? '');
if (!existsSync(resultsPath)) {
  throw new Error(`benchmark produced no results (status=${run.status}, signal=${run.signal ?? 'none'}, error=${run.error?.message ?? 'none'})`);
}
const results = JSON.parse(readFileSync(resultsPath, 'utf8'));
execFileSync(process.execPath, [resolve(directory, 'write-report.mjs')], {
  cwd: packageDirectory,
  stdio: 'inherit'
});
assert.equal(results.pass, true);
assert.deepEqual(results.uploadPath, {
  requested: requestedUploadPath,
  effective: requestedUploadPath,
});
assert.deepEqual(results.skippedPhases, []);
assert.equal(results.frameCount, 390);
assert.equal(results.ratio.runs, repeatCount);
assert.equal(results.ratio.samples.length, repeatCount);
const sortedRatioSamples = [...results.ratio.samples].sort((left, right) => left - right);
const ratioMiddle = Math.floor(sortedRatioSamples.length / 2);
const expectedRatioMedian = sortedRatioSamples.length % 2 === 0
  ? (sortedRatioSamples[ratioMiddle - 1] + sortedRatioSamples[ratioMiddle]) / 2
  : sortedRatioSamples[ratioMiddle];
assert.equal(results.ratio.v2ToRenderCut, results.ratio.median);
assert.equal(results.ratio.median, expectedRatioMedian);
const sortedSteadySamples = [...results.ratio.samples.slice(1)].sort((left, right) => left - right);
const steadyMiddle = Math.floor(sortedSteadySamples.length / 2);
const expectedSteadyMedian = sortedSteadySamples.length === 0
  ? null
  : sortedSteadySamples.length % 2 === 0
    ? (sortedSteadySamples[steadyMiddle - 1] + sortedSteadySamples[steadyMiddle]) / 2
    : sortedSteadySamples[steadyMiddle];
assert.deepEqual(results.ratio.steadySamples, results.ratio.samples.slice(1));
assert.equal(results.ratio.steadyMedian, expectedSteadyMedian);
assert.equal(results.ratio.minimum, Math.min(...results.ratio.samples));
assert.equal(results.ratio.maximum, Math.max(...results.ratio.samples));
assert.equal(results.phases.runs.length, repeatCount);
assert.ok(results.profile.sourceRun >= 1 && results.profile.sourceRun <= repeatCount);
for (const [index, repeatedRun] of results.phases.runs.entries()) {
  assert.equal(repeatedRun.run, index + 1);
  assert.equal(repeatedRun.exportRawFfmpeg.sink.frames, 390);
  assert.equal(repeatedRun.exportWebCodecs.sink.frames, 390);
  assert.ok(Math.abs(repeatedRun.exportRawFfmpeg.sink.durationSeconds - 13) <= 1 / 30);
  assert.ok(Math.abs(repeatedRun.exportWebCodecs.sink.durationSeconds - 13) <= 1 / 30);
  assert.ok(Math.abs(repeatedRun.runRenderCut.durationSeconds - 13) <= 1 / 30);
  assert.equal(repeatedRun.runRenderCut.sameInputBytes, true);
  assert.ok(repeatedRun.psnr.averageDb > 20);
  assert.equal(
    results.ratio.samples[index],
    repeatedRun.exportWebCodecs.totalMs / repeatedRun.runRenderCut.elapsedMs
  );
}
assert.equal(results.encoders.webCodecs.sink.frames, 390);
assert.equal(results.outputs.webCodecs.durationOk, true);
assert.equal(results.outputs.rawFfmpeg.durationOk, true);
assert.equal(typeof results.ratio.v2ToRenderCut, 'number');
assert.ok(results.profile.stages.tick.count > 0);
if (requestedUploadPath === 'copyTo') {
  assert.ok(results.profile.stages.copyTo.count > 0);
  assert.ok(results.profile.stages.planeCompact.count > 0);
} else {
  assert.equal(results.profile.stages.copyTo.count, 0);
  assert.equal(results.profile.stages.planeCompact.count, 0);
  assert.ok(results.profile.stages.upload.count > 0);
}
assert.ok(results.profile.stages.shaderGpu.count > 0);
assert.ok(results.profile.stages.pboWait.count > 0);
assert.ok(results.profile.stages.rowFlip.count > 0);
assert.equal(results.profile.stages.copy.classification, 'inclusive');
assert.equal(results.profile.stages.copyTo.classification, 'exclusive');
assert.equal(results.profile.stages.readback.classification, 'inclusive');
assert.equal(results.profile.stages.sink.classification, 'inclusive');
assert.equal(results.profile.stages.ipcTransit.classification, 'exclusive');
assert.equal(results.profile.stages.ipcTransit.derived, true);
assert.ok(Math.abs(
  results.profile.stages.ipcTransit.p50Ms
  - Math.max(0, results.profile.stages.sink.p50Ms
    - results.profile.stages.ipcWrite.p50Ms
    - results.profile.stages.ffmpegDrain.p50Ms)
) < 1e-9);
assert.equal(typeof results.profile.dominantStage.name, 'string');
assert.ok(results.profile.dominantStage.p50Ms >= 0);
assert.ok(results.profile.dominantStage.perFrameContributionMs >= 0);
assert.notEqual(results.profile.dominantStage.name, 'ffmpegClose');
assert.equal(results.profile.dominantStage.name, results.profile.exclusiveRanking[0].name);
assert.equal(results.profile.stages.ffmpegClose.classification, 'one-shot');
assert.ok(results.profile.oneShotStages.some(value => value.name === 'ffmpegClose'));
assert.ok(results.ipc.invoke.p50Ms > 0);
assert.equal(results.ipc.invoke.boundary, 'renderer-to-main');
assert.ok(results.ipc.messagePort.p50Ms > 0);
assert.equal(results.ipc.messagePort.mechanism, 'MessagePortMain structured clone without transfer list');
assert.equal(results.ipc.sharedBuffer.available, false);
assert.equal(results.ipc.sharedBuffer.reasonCode, 'PROCESS_BOUNDARY_UNSUPPORTED');
assert.equal(results.ipc.worker.arrayBufferTransfer.available, true);
assert.ok(results.ipc.worker.arrayBufferTransfer.p50Ms > 0);
assert.equal(results.ipc.worker.sharedBuffer.available, true);
assert.ok(results.ipc.worker.sharedBuffer.p50Ms > 0);
assert.ok(results.encoders.webCodecs.totalMs > 0);
assert.ok(results.encoders.ffmpegPipe.totalMs > 0);
assert.ok(results.psnr.averageDb > 20);
assert.equal(results.improvements.length, 1);
assert.ok(results.improvements[0].beforeMs > 0);
assert.ok(results.improvements[0].afterMs > 0);
assert.equal(results.improvements[0].samples.length, repeatCount);
assert.equal(typeof results.improvements[0].evidence, 'string');
assert.equal(results.layerMeasurements.scaling.length, 4);
for (const [index, value] of results.layerMeasurements.scaling.entries()) {
  if (value.skipped) continue;
  assert.equal(value.count, [0, 1, 3, 5][index]);
  assert.equal(value.frames, 30);
  for (const stage of ['decode', 'upload', 'shaderGpu', 'present']) {
    assert.ok(value.stages[stage].count > 0);
    assert.ok(value.stages[stage].p50Ms != null);
    assert.ok(value.stages[stage].p95Ms != null);
  }
}
if (!results.layerMeasurements.zeroCopy.skipped) {
  assert.ok(results.layerMeasurements.zeroCopy.copyToPlanesMs > 0);
  assert.ok(results.layerMeasurements.zeroCopy.directVideoFrameTexImageMs > 0);
}
process.stdout.write(`cuts benchmark PASS: v2/render-cut=${results.ratio.v2ToRenderCut.toFixed(3)}\n`);
