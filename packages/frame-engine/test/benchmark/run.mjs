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

function hasCurrentGoldenResult() {
  if (!existsSync(goldenResultsPath)) return false;
  try {
    const golden = JSON.parse(readFileSync(goldenResultsPath, 'utf8'));
    return golden.pass === true && golden.semantic?.pass === true && golden.parity?.length === 28;
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
  timeout: 900_000,
  env: environment,
  maxBuffer: 64 * 1024 * 1024
});
process.stdout.write(run.stdout ?? '');
process.stderr.write(run.stderr ?? '');
if (run.error) throw run.error;
if (!existsSync(resultsPath)) {
  throw new Error(`benchmark produced no results (status=${run.status}, signal=${run.signal ?? 'none'})`);
}
const results = JSON.parse(readFileSync(resultsPath, 'utf8'));
assert.equal(results.pass, true);
assert.equal(results.frameCount, 390);
assert.equal(results.encoders.webCodecs.sink.frames, 390);
assert.equal(results.outputs.webCodecs.durationOk, true);
assert.equal(results.outputs.rawFfmpeg.durationOk, true);
assert.equal(typeof results.ratio.v2ToRenderCut, 'number');
assert.ok(results.profile.stages.tick.count > 0);
assert.ok(results.profile.stages.copyTo.count > 0);
assert.ok(results.profile.stages.planeCompact.count > 0);
assert.ok(results.profile.stages.shaderGpu.count > 0);
assert.ok(results.profile.stages.pboWait.count > 0);
assert.ok(results.profile.stages.rowFlip.count > 0);
assert.ok(results.ipc.invoke.p50Ms > 0);
assert.ok(results.ipc.messagePort.p50Ms > 0);
assert.equal(results.ipc.sharedBuffer.available, true);
assert.ok(results.ipc.sharedBuffer.p50Ms > 0);
assert.ok(results.encoders.webCodecs.totalMs > 0);
assert.ok(results.encoders.ffmpegPipe.totalMs > 0);
assert.ok(results.psnr.averageDb > 20);
execFileSync(process.execPath, [resolve(directory, 'write-report.mjs')], {
  cwd: packageDirectory,
  stdio: 'inherit'
});
process.stdout.write(`cuts benchmark PASS: v2/render-cut=${results.ratio.v2ToRenderCut.toFixed(3)}\n`);
