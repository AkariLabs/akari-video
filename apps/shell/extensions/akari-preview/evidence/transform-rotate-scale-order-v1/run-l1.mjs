#!/usr/bin/env node
// Re-run the P3b-1 fixtures with the new R·S bounds and preserve each surface's outcome.
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const here = fileURLToPath(new URL('.', import.meta.url));
const results = new URL('./results/', import.meta.url);
const fixtures = ['scale-x', 'scale-y', 'rotated', 'group-leaf', 'uniform-rotated', 'keyframes', 'legacy', 'legacy-keyframes'];
const quick = process.argv.includes('--quick');
const electron = process.env.AKARI_L1_ELECTRON;
const runs = [];
async function run(script, args = []) {
  const child = spawn(process.execPath, [fileURLToPath(new URL(script, import.meta.url)), ...args], { cwd: here, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', value => { output += value; });
  child.stderr.on('data', value => { output += value; });
  const exit = await new Promise(resolve => child.on('close', resolve));
  runs.push({ script, args, exit, output: output.slice(-2000) });
}
await mkdir(results, { recursive: true });
await run('./runtime-dom.mjs');
if (!quick) {
  await run('./run-shell.mjs');
  for (const fixture of fixtures) for (const surface of ['web', 'gpu', 'osr']) {
    await run('./run.mjs', ['--case', fixture, '--surface', surface, ...(electron && surface !== 'web' ? ['--electron', electron] : [])]);
  }
  await run('./merge-results.mjs');
}
const read = async relative => JSON.parse(await readFile(new URL(relative, results), 'utf8').catch(() => '{}'));
const dom = await read('runtime-dom/results.json');
const shell = await read('shell-results.json');
const report = await read('results.json');
const summary = { recordedAt: new Date().toISOString(), quick, runs, browserDom: {
  pass: dom.pass === true, measurements: dom.measurements?.length ?? 0,
  cornerChecks: dom.cornerChecks?.length ?? 0, maxAngleErrorDeg: Math.max(0, ...(dom.cornerChecks ?? []).map(value => value.angleErrorDeg)),
  pixelChecks: dom.pixelChecks?.length ?? 0, pixelPass: dom.pixelChecks?.every(value => value.pass) === true },
  shell: { pass: shell.pass === true, cases: shell.cases?.map(value => ({ fixture: value.fixture, pass: value.pass, error: value.error?.split('\n')[0] })) ?? [] },
  surfaces: report.surfaces?.map(value => ({ fixture: value.fixture, surface: value.surface, status: value.status,
    error: value.error?.split('\n')[0] })) ?? [], fullParityPass: report.pass === true };
await writeFile(new URL('summary.json', results), JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify({ browserDom: summary.browserDom, shell: summary.shell.pass, fullParityPass: summary.fullParityPass }));
if (!summary.browserDom.pass || (!quick && (!summary.shell.pass || !summary.fullParityPass))) process.exitCode = 1;
