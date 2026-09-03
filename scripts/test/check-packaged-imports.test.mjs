import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { assembleResources, scanPackageResolverCalls } from '../release/check-packaged-imports.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const GUARD = join(REPO_ROOT, 'scripts/release/check-packaged-imports.mjs');
const SHELL_PACKAGE = join(REPO_ROOT, 'apps/shell/package.json');

function temporaryDirectory(t) {
  const directory = mkdtempSync(join(tmpdir(), 'akari-packaged-imports-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function runGuard(shellPackagePath = SHELL_PACKAGE) {
  return spawnSync(process.execPath, [GUARD, '--shell-package', shellPackagePath], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });
}

function shellPackageWithout(t, packageName) {
  const directory = temporaryDirectory(t);
  const shellPackage = JSON.parse(readFileSync(SHELL_PACKAGE, 'utf8'));
  const destination = `packages/${packageName}`;
  const before = shellPackage.build.extraResources.length;
  shellPackage.build.extraResources = shellPackage.build.extraResources.filter((entry) =>
    typeof entry === 'string' || (entry.to !== destination && !entry.to?.startsWith(`${destination}/`)));
  assert.equal(shellPackage.build.extraResources.length, before - 1, `${destination} fixture entry`);
  const path = join(directory, 'package.json');
  writeFileSync(path, `${JSON.stringify(shellPackage, null, 2)}\n`);
  return path;
}

test('実 Resources は解決関数走査を通り、restricted package を除外する', (t) => {
  const directory = temporaryDirectory(t);
  const resourcesRoot = join(directory, 'Resources');
  mkdirSync(resourcesRoot, { recursive: true });
  const shellPackage = JSON.parse(readFileSync(SHELL_PACKAGE, 'utf8'));
  assembleResources(shellPackage, { resourcesRoot });

  const result = scanPackageResolverCalls({ repoRoot: REPO_ROOT, resourcesRoot });
  assert.deepEqual(result.missing, []);
  assert.ok(result.excluded.some((item) =>
    item.resolver === 'importPackage' && item.specifier === 'packages/matte-rvm/src/index.mjs'));
});

test('非リテラルの変数・テンプレート・連結は参考情報に留める', (t) => {
  const directory = temporaryDirectory(t);
  const repoRoot = join(directory, 'repo');
  const resourcesRoot = join(directory, 'Resources');
  const sourceDir = join(repoRoot, 'skills/sample/bin');
  mkdirSync(sourceDir, { recursive: true });
  mkdirSync(join(resourcesRoot, 'packages'), { recursive: true });
  writeFileSync(join(sourceDir, 'sample.mjs'), [
    'resolvePackageFile(variable);',
    'resolvePackageDir(`sample/${part}`);',
    'importPackage("sample/" + part);',
    'resolvePackageFile("needed/src/index.mjs");',
  ].join('\n'));

  const result = scanPackageResolverCalls({ repoRoot, resourcesRoot });
  assert.equal(result.dynamic.length, 3);
  assert.equal(result.missing.length, 1);
  assert.equal(result.missing[0].specifier, 'packages/needed/src/index.mjs');
});

for (const [packageName, expectedResolver, expectedSource] of [
  ['chat-bridge', 'importPackage', 'skills/setup-chat-approval/bin/doctor.mjs'],
  ['creator-root', 'importPackage', 'skills/manage-connections/bin/doctor.mjs'],
  ['media-bin', 'importPackage', 'skills/analyze-footage/bin/person-matte/person-matte.mjs'],
  ['edit-store', 'resolvePackageFile', 'skills/analyze-footage/bin/person-matte/person-cutout.mjs'],
  ['schemas', 'resolvePackageFile', 'skills/analyze-footage/bin/person-matte/person-cutout.mjs'],
]) {
  test(`解決関数走査は ${packageName} の同梱漏れを名指しする`, (t) => {
    const shellPackagePath = shellPackageWithout(t, packageName);
    const result = runGuard(shellPackagePath);
    assert.equal(result.status, 1, result.stdout);
    assert.match(result.stderr, /PACKAGE RESOLVER MISSING/u);
    assert.match(
      result.stderr,
      new RegExp(`\\(${expectedResolver}\\) packages/${packageName}/[^\\s]+\\s+<- ${expectedSource.replaceAll('.', '\\.')}`, 'u'),
    );
  });
}
