import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const shellRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const validateAssetRelativePath = 'bin/validate-asset.mjs';
const validateAssetPackagedPath = 'resources/packages/schemas/bin/validate-asset.mjs';

async function readShellPackageJson() {
  return JSON.parse(await readFile(path.join(shellRoot, 'package.json'), 'utf8'));
}

import {
  checkPackagedImports,
  collectImportSpecifiers,
  packagedRoots,
  resolvePackagedSpecifier,
} from './helpers/packaged-imports.mjs';

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
  assert.equal(packagedPath, validateAssetPackagedPath);

  const sourcePath = path.resolve(shellRoot, schemasResource.from, validateAssetRelativePath);
  assert.ok((await stat(sourcePath)).isFile(), `同梱元ファイルが存在しない: ${sourcePath}`);
});

// 守りたい性質: パッケージ版 Resources で ERR_MODULE_NOT_FOUND を出さないこと。
// つまり validate-asset の非 node: import は、すべて extraResources が同梱する場所へ解決する。
// （node: 組み込みだけに限る必要はない。overlay-runtime のように同梱されている隣の packages は参照してよい）
test('validate-asset の import は同梱される場所だけを参照する', async () => {
  const pkg = await readShellPackageJson();
  const roots = packagedRoots(pkg.build.extraResources);

  const problems = [];
  const visited = new Set();
  const queue = [{
    sourcePath: path.resolve(shellRoot, '../../packages/schemas', validateAssetRelativePath),
    packagedPath: validateAssetPackagedPath,
  }];
  let entrySpecifierCount = 0;

  while (queue.length > 0) {
    const current = queue.pop();
    if (visited.has(current.packagedPath)) continue;
    visited.add(current.packagedPath);

    const specifiers = collectImportSpecifiers(await readFile(current.sourcePath, 'utf8'));
    if (current.packagedPath === validateAssetPackagedPath) entrySpecifierCount = specifiers.length;

    for (const specifier of specifiers) {
      const result = resolvePackagedSpecifier(specifier, {
        fromPackagedPath: current.packagedPath,
        roots,
        shellRoot,
      });
      if (!result.ok) {
        problems.push(`${current.packagedPath}: ${result.specifier} — ${result.reason}`);
        continue;
      }
      // 同梱された先の import も同じ規則で辿る（同梱漏れは推移的に効くため）。
      if (!result.builtin) queue.push({ sourcePath: result.sourcePath, packagedPath: result.packagedPath });
    }
  }

  assert.ok(entrySpecifierCount > 0, 'validate-asset に import 宣言が見つからない');
  assert.deepEqual(problems, [], `同梱されない場所を参照する import がある:\n${problems.join('\n')}`);
});

// 退行検知が弱くなっていないことの確認（偽陰性側）: 同梱されない指定子は必ず落ちる。
test('同梱されない場所を指す import は検出される', async () => {
  const pkg = await readShellPackageJson();
  const options = {
    fromPackagedPath: validateAssetPackagedPath,
    roots: packagedRoots(pkg.build.extraResources),
    shellRoot,
  };

  assert.deepEqual(
    checkPackagedImports(['node:fs', '../../overlay-runtime/runtimes.mjs'], options).map((problem) => problem.specifier),
    [],
    '現行の import は同梱後に解決できるはずが、落ちている',
  );

  const rejected = checkPackagedImports([
    '../../edit-store/src/foo.mjs', // extraResources は edit-store の lib/ しか同梱しない
    './does-not-exist.mjs',
    'esbuild', // bare 指定子は同梱後の置き場を特定できない
  ], options);
  assert.deepEqual(
    rejected.map((problem) => problem.specifier),
    ['../../edit-store/src/foo.mjs', './does-not-exist.mjs', 'esbuild'],
  );
});

// filter の照合そのものの検査（合成 roots）: 実在しても filter 外なら同梱されないので落ちる。
test('同梱元に実在しても filter 外のファイルは同梱されない扱いになる', () => {
  const base = { fromPackagedPath: validateAssetPackagedPath, shellRoot };
  const rootsWithoutSrc = packagedRoots([
    { from: '../../packages/overlay-runtime', to: 'packages/overlay-runtime', filter: ['runtimes.mjs'] },
  ]);
  const rootsWithSrc = packagedRoots([
    { from: '../../packages/overlay-runtime', to: 'packages/overlay-runtime', filter: ['runtimes.mjs', 'src/**/*'] },
  ]);
  const sourcePath = path.resolve(shellRoot, '../../packages/overlay-runtime/src/parts.mjs');
  assert.ok(existsSync(sourcePath), `前提が崩れている（同梱元が無い）: ${sourcePath}`);

  assert.equal(
    resolvePackagedSpecifier('../../overlay-runtime/src/parts.mjs', { ...base, roots: rootsWithoutSrc }).ok,
    false,
    'filter に無いファイルが同梱扱いになっている',
  );
  assert.equal(
    resolvePackagedSpecifier('../../overlay-runtime/src/parts.mjs', { ...base, roots: rootsWithSrc }).ok,
    true,
    'src/**/* のグロブ照合が効いていない',
  );
});
