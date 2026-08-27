import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const testDirectory = dirname(fileURLToPath(import.meta.url));
const packageDirectory = resolve(testDirectory, '..');
const repository = resolve(packageDirectory, '../..');
const generated = resolve(testDirectory, 'golden/.generated');
const resultsPath = resolve(generated, 'gop-tail-seek-results.json');

execFileSync(process.execPath, [resolve(testDirectory, 'golden/generate-fixture.mjs')], {
  cwd: packageDirectory,
  stdio: 'inherit',
});
execFileSync(process.execPath, [resolve(testDirectory, 'b-frame-sample-table.mjs')], {
  cwd: packageDirectory,
  stdio: 'inherit',
});
execFileSync(resolve(repository, 'node_modules/esbuild/bin/esbuild'), [
  resolve(testDirectory, 'golden/gop-tail.ts'),
  '--bundle', '--format=iife', '--platform=browser', '--target=chrome122',
  `--outfile=${resolve(generated, 'gop-tail-seek-renderer.js')}`,
], { cwd: packageDirectory, stdio: 'inherit' });

const directElectron = resolve(repository, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
const electron = existsSync(directElectron) ? directElectron : resolve(repository, 'node_modules/.bin/electron');
const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;
if (existsSync(resultsPath)) unlinkSync(resultsPath);
const execution = spawnSync(electron, ['--no-sandbox', resolve(testDirectory, 'gop-tail-seek-main.cjs')], {
  cwd: packageDirectory,
  encoding: 'utf8',
  timeout: 330_000,
  env: environment,
  maxBuffer: 16 * 1024 * 1024,
});
process.stdout.write(execution.stdout ?? '');
process.stderr.write(execution.stderr ?? '');
if (execution.error) throw execution.error;
if (!existsSync(resultsPath)) {
  process.stdout.write('Electron GUI launch unavailable; running the same seek bundle in headless Chromium.\n');
  execFileSync(process.execPath, [resolve(testDirectory, 'gop-tail-seek-chromium.mjs')], {
    cwd: packageDirectory,
    stdio: 'inherit',
  });
}
assert.equal(existsSync(resultsPath), true, 'seek renderer did not write results');
const results = JSON.parse(readFileSync(resultsPath, 'utf8'));
assert.equal(results.pass, true, results.error);
assert.equal(results.requestCount, 94, `expected legacy and final-GOP frame coverage, got ${results.requestCount}`);
assert.equal(results.clipSession.every(row => row.decodedFrame === row.requestedFrame), true);
assert.equal(results.finalFrameNumber, 239);
assert.equal(results.clipSession.filter(row => row.requestedFrame === results.finalFrameNumber).length, 2);
assert.equal(results.clipSession.filter(row => row.requestedFrame === results.finalFrameNumber)
  .every(row => row.decodedFrame === results.finalFrameNumber), true);
assert.equal(results.bFrame.coverage, 'full');
assert.equal(results.bFrame.rows.length, 720);
assert.equal(results.bFrame.rows.every(row => row.pass), true);
assert.equal(results.bFrame.offsets.every(row => row.pass), true);
assert.equal(results.bFrame.summaries.length, 10);
assert.equal(results.bFrame.summaries.every(row => row.mismatches === 0), true);
assert.equal(results.bFrameTail.rows.length, 24);
assert.equal(results.bFrameTail.rows.every(row => row.pass), true);
assert.equal(new Set(results.bFrameTail.rows.map(row => row.variant)).size, 4);
assert.equal(results.bFrameTail.rows.filter(row => [357, 358, 359].includes(row.requestedFrame)).length, 12);
assert.deepEqual(Object.keys(results.performance.warm).sort(), ['head', 'middle', 'tail']);
assert.equal(Object.values(results.performance.warm).every(position =>
  position.samples.length >= 8 && Number.isFinite(position.p50Ms) && Number.isFinite(position.p95Ms)), true);
assert.equal(results.performance.lookahead.hits, 8);
process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
