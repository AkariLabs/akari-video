import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const testDirectory = dirname(fileURLToPath(import.meta.url));
const packageDirectory = resolve(testDirectory, '..');
const repository = resolve(packageDirectory, '../..');
const generated = resolve(testDirectory, 'golden/.generated');

function integerArgument(value, name, minimum) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum) {
    throw new Error(`${name} must be an integer >= ${minimum}: ${value}`);
  }
  return parsed;
}

const options = {
  trials: 104,
  concurrency: 8,
  load: 0,
  allowFailures: false,
  resultsName: 'gop-tail-stress-results.json',
  userDataDir: null,
};
for (let index = 2; index < process.argv.length; index += 1) {
  const argument = process.argv[index];
  if (argument === '--allow-failures') {
    options.allowFailures = true;
    continue;
  }
  const value = process.argv[++index];
  if (value == null) throw new Error(`${argument} requires a value`);
  if (argument === '--trials') options.trials = integerArgument(value, argument, 2);
  else if (argument === '--concurrency') options.concurrency = integerArgument(value, argument, 2);
  else if (argument === '--load') options.load = integerArgument(value, argument, 0);
  else if (argument === '--results-name') options.resultsName = value;
  else if (argument === '--user-data-dir') options.userDataDir = resolve(value);
  else throw new Error(`unknown argument: ${argument}`);
}
if (!/^[a-z0-9][a-z0-9._-]*$/iu.test(options.resultsName)) {
  throw new Error(`--results-name must be a file name: ${options.resultsName}`);
}

const resultsPath = resolve(generated, options.resultsName);
const temporaryUserData = options.userDataDir == null;
const userDataDir = options.userDataDir ?? mkdtempSync(join(tmpdir(), 'akari-frame-engine-stress-'));
const loadProcesses = [];

try {
  execFileSync(process.execPath, [resolve(testDirectory, 'golden/generate-fixture.mjs')], {
    cwd: packageDirectory,
    stdio: 'inherit',
  });
  execFileSync(process.execPath, [resolve(testDirectory, 'b-frame-sample-table.mjs')], {
    cwd: packageDirectory,
    stdio: 'inherit',
  });
  execFileSync(resolve(repository, 'node_modules/esbuild/bin/esbuild'), [
    resolve(testDirectory, 'golden/tail-stress.ts'),
    '--bundle', '--format=iife', '--platform=browser', '--target=chrome122',
    `--outfile=${resolve(generated, 'gop-tail-stress-renderer.js')}`,
  ], { cwd: packageDirectory, stdio: 'inherit' });

  for (let index = 0; index < options.load; index += 1) {
    loadProcesses.push(spawn(process.execPath, ['-e', 'for (;;) {}'], {
      detached: false,
      stdio: 'ignore',
    }));
  }

  const directElectron = resolve(repository, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
  const electron = existsSync(directElectron) ? directElectron : resolve(repository, 'node_modules/.bin/electron');
  const environment = {
    ...process.env,
    AKARI_STRESS_RESULTS_NAME: options.resultsName,
    AKARI_STRESS_TRIALS: String(options.trials),
    AKARI_STRESS_CONCURRENCY: String(options.concurrency),
    AKARI_ELECTRON_USER_DATA_DIR: userDataDir,
  };
  delete environment.ELECTRON_RUN_AS_NODE;
  if (existsSync(resultsPath)) unlinkSync(resultsPath);
  const execution = spawnSync(
    electron,
    ['--no-sandbox', resolve(testDirectory, 'gop-tail-stress-main.cjs')],
    {
      cwd: packageDirectory,
      encoding: 'utf8',
      timeout: 960_000,
      env: environment,
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  process.stdout.write(execution.stdout ?? '');
  process.stderr.write(execution.stderr ?? '');
  if (execution.error) throw execution.error;
  if (!existsSync(resultsPath)) throw new Error('stress renderer did not write results');

  const results = JSON.parse(readFileSync(resultsPath, 'utf8'));
  const failures = Number(results.failures ?? options.trials);
  const summary = {
    pass: results.pass === true,
    trials: results.trials ?? options.trials,
    concurrency: results.concurrency ?? options.concurrency,
    failures,
    byFixture: results.byFixture ?? {},
    totals: results.totals ?? {},
    ...(failures > 0 ? { failureDetail: results.failureDetail ?? [{ error: results.error }] } : {}),
  };
  process.stdout.write(`FAILURES ${failures}/${summary.trials}\n`);
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  if (results.error || (!options.allowFailures && failures > 0)) process.exitCode = 1;
} finally {
  for (const child of loadProcesses) child.kill();
  if (temporaryUserData) rmSync(userDataDir, { recursive: true, force: true });
}
