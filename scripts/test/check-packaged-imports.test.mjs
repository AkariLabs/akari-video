import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { assembleResources, defaultEntries, scanLauncherSubcommands, scanPackageResolverCalls } from '../release/check-packaged-imports.mjs';
import { WORLD_CLI_RELATIVE, WORLD_VALIDATOR_RELATIVE } from '../../packages/akari-launcher/src/repo-assets.mjs';
import { VALIDATOR } from '../../packages/akari-tools/bin/world.mjs';

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

function shellPackageWithoutWorld(t) {
  const directory = temporaryDirectory(t);
  const shellPackage = JSON.parse(readFileSync(SHELL_PACKAGE, 'utf8'));
  const toolsResource = shellPackage.build.extraResources.find((entry) => entry.to === 'packages/akari-tools');
  assert.ok(toolsResource?.filter?.includes('bin/world.mjs'), 'world fixture entry');
  toolsResource.filter = toolsResource.filter.filter((entry) => entry !== 'bin/world.mjs');
  const fixturePath = join(directory, 'package.json');
  writeFileSync(fixturePath, `${JSON.stringify(shellPackage, null, 2)}\n`);
  return fixturePath;
}

function shellPackageWithoutWorldValidator(t) {
  const directory = temporaryDirectory(t);
  const shellPackage = JSON.parse(readFileSync(SHELL_PACKAGE, 'utf8'));
  const schemasResource = shellPackage.build.extraResources.find((entry) => entry.to === 'packages/schemas');
  assert.ok(schemasResource?.filter?.includes('bin/validate-world-map.mjs'), 'world validator fixture entry');
  schemasResource.filter = schemasResource.filter.filter((entry) => entry !== 'bin/validate-world-map.mjs');
  const fixturePath = join(directory, 'package.json');
  writeFileSync(fixturePath, `${JSON.stringify(shellPackage, null, 2)}\n`);
  return fixturePath;
}

function shellPackageWithKnownInternal(t) {
  const directory = temporaryDirectory(t);
  const shellPackage = JSON.parse(readFileSync(SHELL_PACKAGE, 'utf8'));
  const toolsResource = shellPackage.build.extraResources.find((entry) => entry.to === 'packages/akari-tools');
  assert.ok(toolsResource?.filter, 'akari-tools fixture entry');
  toolsResource.filter.push('bin/beatmap.mjs');
  const fixturePath = join(directory, 'package.json');
  writeFileSync(fixturePath, `${JSON.stringify(shellPackage, null, 2)}\n`);
  return fixturePath;
}

test('generate のサブコマンドを packaged import の入口に含める', (t) => {
  const directory = temporaryDirectory(t);
  const resourcesRoot = join(directory, 'Resources');
  mkdirSync(resourcesRoot, { recursive: true });
  const shellPackage = JSON.parse(readFileSync(SHELL_PACKAGE, 'utf8'));
  assembleResources(shellPackage, { resourcesRoot });

  const entries = defaultEntries(resourcesRoot);
  for (const command of ['still.mjs', 'video.mjs', 'resume.mjs']) {
    assert.ok(entries.includes(join(resourcesRoot, 'packages', 'generate', 'src', 'cli', command)));
  }
});

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

test('launcher サブコマンド実行体は実 Resources または vendor に揃っている', (t) => {
  const directory = temporaryDirectory(t);
  const resourcesRoot = join(directory, 'Resources');
  mkdirSync(resourcesRoot, { recursive: true });
  const shellPackage = JSON.parse(readFileSync(SHELL_PACKAGE, 'utf8'));
  assembleResources(shellPackage, { resourcesRoot });

  const result = scanLauncherSubcommands({ repoRoot: REPO_ROOT, resourcesRoot });
  assert.deepEqual(result.missing, []);
  assert.ok(result.present.some((item) => item.command === 'akari world' && item.relative === WORLD_CLI_RELATIVE));
  assert.ok(result.present.some((item) => item.command === 'akari world check' && item.relative === WORLD_VALIDATOR_RELATIVE));
});

test('launcher サブコマンド実在検査は world.mjs の同梱漏れを棄却する', (t) => {
  const result = runGuard(shellPackageWithoutWorld(t));
  assert.equal(result.status, 1, result.stdout);
  assert.match(result.stderr, /LAUNCHER SUBCOMMAND MISSING/u);
  assert.match(result.stderr, /packages\/akari-tools\/bin\/world\.mjs/u);
});

test('launcher サブコマンド実在検査は world check validator の同梱漏れを棄却する', (t) => {
  const result = runGuard(shellPackageWithoutWorldValidator(t));
  assert.equal(result.status, 1, result.stdout);
  assert.match(result.stderr, /LAUNCHER SUBCOMMAND MISSING/u);
  assert.match(result.stderr, /akari world check/u);
  assert.match(result.stderr, /packages\/schemas\/bin\/validate-world-map\.mjs/u);
});

test('KNOWN_UNPACKAGED の実行体が同梱されたら陳腐化として gate を失敗させる', (t) => {
  const result = runGuard(shellPackageWithKnownInternal(t));
  assert.equal(result.status, 1, result.stdout);
  assert.match(result.stderr, /KNOWN_UNPACKAGED STALE/u);
  assert.match(result.stderr, /同梱されたので KNOWN_UNPACKAGED から外してください/u);
});

test('world check の validator 実パスは launcher の相対パス正本と一致する', () => {
  assert.equal(VALIDATOR, join(REPO_ROOT, WORLD_VALIDATOR_RELATIVE));
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
