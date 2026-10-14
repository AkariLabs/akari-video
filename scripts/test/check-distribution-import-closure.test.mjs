import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const checker = path.join(root, 'scripts/ci/check-distribution-import-closure.mjs');
const run = args => spawnSync(process.execPath, [checker, ...args], { cwd: root, encoding: 'utf8' });

test('current vendor and Resources public entries have a complete relative import closure', () => {
  const result = run([]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /\[distribution-import-closure\] OK: vendor \d+ files, Resources \d+ files/u);
});

test('missing imports fail in both prepack vendor selection and shell resource filters', t => {
  const fixture = mkdtempSync(path.join(tmpdir(), 'distribution-import-closure-'));
  t.after(() => rmSync(fixture, { recursive: true, force: true }));
  const put = (relative, value) => {
    const file = path.join(fixture, relative);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, value);
  };
  put('packages/akari-launcher/src/vendor-sources.mjs',
    "export const VENDOR_SOURCES = ['packages/vendor/entry.mjs'];\n");
  put('packages/akari-launcher/bin/akari.mjs', 'export const akari = true;\n');
  put('packages/vendor/package.json', JSON.stringify({ bin: { vendor: 'entry.mjs' } }));
  put('packages/vendor/entry.mjs', "import './missing.mjs';\n");
  put('packages/vendor/missing.mjs', 'export const vendor = true;\n');
  put('packages/report/package.json', JSON.stringify({ bin: { report: 'entry.mjs' } }));
  put('packages/report/entry.mjs', "import './missing.mjs';\n");
  put('packages/report/missing.mjs', 'export const report = true;\n');
  const shell = { build: { extraResources: [{ from: '../../packages/report', to: 'packages/report',
    filter: ['package.json', 'entry.mjs'] }] } };
  put('apps/shell/package.json', JSON.stringify(shell));
  assert.equal(spawnSync('git', ['init', '-q'], { cwd: fixture }).status, 0);
  const added = spawnSync('git', ['add', '.'], { cwd: fixture, encoding: 'utf8' });
  assert.equal(added.status, 0, added.stderr);

  const red = run(['--root', fixture]);
  assert.equal(red.status, 1, red.stdout);
  assert.match(red.stderr, /vendor: .*entry\.mjs -> \.\/missing\.mjs/u);
  assert.match(red.stderr, /Resources: .*entry\.mjs -> \.\/missing\.mjs/u);

  put('packages/akari-launcher/src/vendor-sources.mjs',
    "export const VENDOR_SOURCES = ['packages/vendor/entry.mjs', 'packages/vendor/missing.mjs'];\n");
  shell.build.extraResources[0].filter.push('missing.mjs');
  put('apps/shell/package.json', JSON.stringify(shell));
  const green = run(['--root', fixture]);
  assert.equal(green.status, 0, green.stderr);
});
