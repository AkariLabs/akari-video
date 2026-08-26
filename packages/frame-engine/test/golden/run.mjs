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
  timeout: 210_000,
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
for (const [stage, summary] of Object.entries(results.metrics)) {
  assert.ok(summary.count > 0, `${stage} has no samples`);
  assert.equal(typeof summary.p50Ms, 'number');
  assert.equal(typeof summary.p95Ms, 'number');
}

process.stdout.write(`golden PASS: ${results.parity.length} parity frames, negative differingPixels=${results.negative.differingPixels}, encoded distinct hashes=${results.encoded.distinctExtractedHashes}\n`);
