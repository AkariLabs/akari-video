import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { checkNpmDistribution } from '../release/check-no-gpl-redistribution.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const GUARD = join(REPO_ROOT, 'scripts/release/check-no-gpl-redistribution.mjs');

function runGuard(args = []) {
  return spawnSync(process.execPath, [GUARD, ...args], { cwd: REPO_ROOT, encoding: 'utf8' });
}

function temporaryDirectory(t) {
  const directory = mkdtempSync(join(tmpdir(), 'akari-no-gpl-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test('実リポジトリは再配布ガードを通過する', () => {
  const result = runGuard();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /OK（restricted 1 件 \/ 違反 0）/u);
});

test('メタ: shell extraResources へ RVM 実装を足すと CLI が落ち、理由を出す', (t) => {
  const directory = temporaryDirectory(t);
  const shellPackage = JSON.parse(readFileSync(join(REPO_ROOT, 'apps/shell/package.json'), 'utf8'));
  shellPackage.build.extraResources.push({
    from: '../../packages/matte-rvm',
    to: 'packages/matte-rvm',
    filter: ['package.json', 'bin/**/*', 'src/**/*'],
  });
  const shellPath = join(directory, 'package.json');
  writeFileSync(shellPath, `${JSON.stringify(shellPackage, null, 2)}\n`);

  const result = runGuard(['--shell-package', shellPath]);
  assert.notEqual(result.status, 0, result.stdout);
  assert.match(result.stderr, /FORBIDDEN:.*packages\/matte-rvm.*GPL-3\.0/u);
});

test('メタ: vendor の ONNX を追跡対象へ足すと CLI が落ち、理由を出す', (t) => {
  const directory = temporaryDirectory(t);
  const tracked = execFileSync('git', ['-C', REPO_ROOT, 'ls-files'], { encoding: 'utf8' });
  const trackedPath = join(directory, 'tracked-files.txt');
  writeFileSync(trackedPath, `${tracked.trimEnd()}\npackages/matte-rvm/vendor/rvm_mobilenetv3_fp32.onnx\n`);

  const result = runGuard(['--tracked-files', trackedPath]);
  assert.notEqual(result.status, 0, result.stdout);
  assert.match(result.stderr, /FORBIDDEN:.*vendor\/rvm_mobilenetv3_fp32\.onnx/u);
});

test('メタ: prepack VENDOR_SOURCES へ RVM src を足すと CLI が落ちる', (t) => {
  const directory = temporaryDirectory(t);
  const source = readFileSync(join(REPO_ROOT, 'packages/akari-launcher/scripts/prepack.mjs'), 'utf8');
  const modified = source.replace('const VENDOR_SOURCES = [', "const VENDOR_SOURCES = [\n  'packages/matte-rvm/src',");
  assert.notEqual(modified, source);
  const prepackPath = join(directory, 'prepack.mjs');
  writeFileSync(prepackPath, modified);

  const result = runGuard(['--prepack', prepackPath]);
  assert.notEqual(result.status, 0, result.stdout);
  assert.match(result.stderr, /FORBIDDEN:.*packages\/matte-rvm\/src.*GPL-3\.0/u);
});

test('package.json#files が RVM を配布対象にすると純粋検査が落とす', () => {
  const violations = checkNpmDistribution({
    prepackSource: 'const VENDOR_SOURCES = [];',
    packageManifests: [{ path: 'package.json', manifest: { files: ['packages/matte-rvm/src/**/*'] } }],
    capabilitySources: [],
  });
  assert.equal(violations.length, 1);
  assert.match(violations[0].path, /matte-rvm\/src/u);
});

test('capability source の自作 metadata だけは allowlist が許可する', () => {
  const violations = checkNpmDistribution({
    prepackSource: 'const VENDOR_SOURCES = [];',
    packageManifests: [],
    capabilitySources: ['packages/matte-rvm/package.json', 'packages/matte-rvm/README.md'],
  });
  assert.deepEqual(violations, []);
});

test('fail-closed: restricted path が存在しない repo root では CLI が落ちる', (t) => {
  const directory = temporaryDirectory(t);
  const result = runGuard(['--repo-root', directory]);
  assert.notEqual(result.status, 0, result.stdout);
  assert.match(result.stderr, /fail-closed.*restricted path does not exist/u);
});
