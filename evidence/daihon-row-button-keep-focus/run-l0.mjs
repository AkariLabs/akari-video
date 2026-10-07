#!/usr/bin/env node
// Run each transcript test file in its own process with an isolated home.
import { spawn } from 'node:child_process';
import { mkdir, readdir, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

if (await realpath(process.argv[1]) !== await realpath(fileURLToPath(import.meta.url))) process.exit(0);

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const root = path.resolve(process.env.AKARI_TEST_ROOT ?? repo);
const scratch = process.env.AKARI_TASK_TMP;
const evidence = process.env.AKARI_L0_EVIDENCE_DIR;
const label = process.env.AKARI_L0_LABEL ?? 'head';
if (!scratch || !evidence || !/^[a-z0-9-]+$/.test(label)) throw new Error('Set AKARI_TASK_TMP, AKARI_L0_EVIDENCE_DIR, and a safe AKARI_L0_LABEL');
const testDir = path.join(root, 'apps/shell/extensions/akari-transcript/test');
const commonDir = path.join(root, 'apps/shell/extensions/akari-transcript/src/common');
const files = [
  ...(await readdir(testDir)).filter(name => name.endsWith('.test.mjs')).map(name => path.join(testDir, name)),
  ...(await readdir(commonDir)).filter(name => name.endsWith('.test.mjs')).map(name => path.join(commonDir, name))
];
const isolated = path.join(scratch, 'isolate', label);
for (const dir of [isolated, path.join(isolated, 'temp'), path.join(isolated, 'akari'), evidence]) await mkdir(dir, { recursive: true });
const env = { ...process.env, HOME: isolated, USERPROFILE: isolated,
  TEMP: path.join(isolated, 'temp'), TMP: path.join(isolated, 'temp'),
  AKARI_HOME: path.join(isolated, 'akari'), THEIA_CONFIG_DIR: path.join(isolated, 'theia') };
delete env.AKARI_TEST_DAIHON_SOURCE;

function run(file) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, ['--test', '--test-reporter=tap', file], { cwd: root, env, windowsHide: true });
    let output = '';
    for (const stream of [child.stdout, child.stderr]) stream.on('data', data => { output += data; });
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, 300000);
    child.on('error', error => { output += `\n${error.stack}\n`; });
    child.on('close', code => {
      clearTimeout(timer);
      const names = [...output.matchAll(/^\s*not ok \d+ - (.+)$/gm)].map(match => match[1]);
      resolve({ file: path.relative(root, file).replaceAll('\\', '/'), code, timedOut,
        failures: names.length ? names : code === 0 ? [] : ['<process failed>'], output });
    });
  });
}

const results = new Array(files.length);
let next = 0;
await Promise.all(Array.from({ length: 4 }, async () => {
  while (next < files.length) {
    const index = next++;
    results[index] = await run(files[index]);
    console.error(`${label} ${index + 1}/${files.length} ${results[index].code === 0 ? 'PASS' : 'FAIL'} ${results[index].file}`);
  }
}));
const failures = results.flatMap(item => item.failures.map(name => `${item.file}: ${name}`));
const summary = { label, fileCount: files.length, passedFiles: results.filter(item => item.code === 0).length,
  failedFiles: results.filter(item => item.code !== 0).length, failures, results };
await writeFile(path.join(evidence, `${label}-l0.json`), `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify({ label, fileCount: summary.fileCount, failedFiles: summary.failedFiles, failures }));
if (failures.length) process.exitCode = 1;
