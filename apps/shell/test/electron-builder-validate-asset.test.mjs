import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const shellRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const validateAssetRelativePath = 'bin/validate-asset.mjs';

async function readShellPackageJson() {
  return JSON.parse(await readFile(path.join(shellRoot, 'package.json'), 'utf8'));
}

test('extraResources は validate-asset を resources/packages/schemas/bin に同梱する', async () => {
  const pkg = await readShellPackageJson();
  const schemasResource = pkg.build.extraResources.find(
    (resource) => resource.from === '../../packages/schemas' && resource.to === 'packages/schemas',
  );

  assert.ok(schemasResource, 'packages/schemas の extraResources 宣言が無い');
  assert.ok(
    schemasResource.filter?.includes(validateAssetRelativePath),
    `${validateAssetRelativePath} が packages/schemas の filter に含まれていない`,
  );

  const packagedPath = path.posix.join('resources', schemasResource.to, validateAssetRelativePath);
  assert.equal(packagedPath, 'resources/packages/schemas/bin/validate-asset.mjs');

  const sourcePath = path.resolve(shellRoot, schemasResource.from, validateAssetRelativePath);
  assert.ok((await stat(sourcePath)).isFile(), `同梱元ファイルが存在しない: ${sourcePath}`);
});

test('validate-asset の import は node: 組み込みモジュールだけを参照する', async () => {
  const sourcePath = path.resolve(shellRoot, '../../packages/schemas', validateAssetRelativePath);
  const source = await readFile(sourcePath, 'utf8');
  const importSpecifiers = [
    ...source.matchAll(/\bimport\s+(?:(?:[^'";]+?\s+from\s+)?['"]([^'"]+)['"]|\(\s*['"]([^'"]+)['"]\s*\))/g),
  ].map((match) => match[1] ?? match[2]);

  assert.ok(importSpecifiers.length > 0, 'validate-asset に import 宣言が見つからない');
  assert.deepEqual(
    importSpecifiers.filter((specifier) => !specifier.startsWith('node:')),
    [],
    'validate-asset に node: 組み込み以外の import がある',
  );
});
