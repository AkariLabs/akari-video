// `akari world` は import ではなく launcher から子プロセス起動されるため、実行体・validator と
// world 実装の相対参照閉包を electron-builder の extraResources 契約へ直接突き合わせる。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { WORLD_CLI_RELATIVE, WORLD_VALIDATOR_RELATIVE } from '../../../packages/akari-launcher/src/repo-assets.mjs';
import { collectImportSpecifiers, packagedRoots, resolvePackagedSpecifier } from './helpers/packaged-imports.mjs';

const shellRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const worldRelative = WORLD_CLI_RELATIVE.split(path.sep).join('/');
const validatorRelative = WORLD_VALIDATOR_RELATIVE.split(path.sep).join('/');
const worldInsidePackage = worldRelative.replace(/^packages\/akari-tools\//, '');
const validatorInsidePackage = validatorRelative.replace(/^packages\/schemas\//, '');
const worldPackagedPath = path.posix.join('resources', worldRelative);

async function readShellPackageJson() {
  return JSON.parse(await readFile(path.join(shellRoot, 'package.json'), 'utf8'));
}

test('extraResources は akari world と world check validator を同梱する', async () => {
  const pkg = await readShellPackageJson();
  const toolsResource = pkg.build.extraResources.find(
    (resource) => resource.from === '../../packages/akari-tools' && resource.to === 'packages/akari-tools',
  );
  const schemasResource = pkg.build.extraResources.find(
    (resource) => resource.from === '../../packages/schemas' && resource.to === 'packages/schemas',
  );
  assert.equal(worldInsidePackage, 'bin/world.mjs');
  assert.equal(validatorInsidePackage, 'bin/validate-world-map.mjs');
  assert.ok(toolsResource?.filter?.includes(worldInsidePackage), `${worldInsidePackage} が同梱されない`);
  assert.ok(schemasResource?.filter?.includes(validatorInsidePackage), `${validatorInsidePackage} が同梱されない`);
  assert.ok((await stat(path.resolve(shellRoot, toolsResource.from, worldInsidePackage))).isFile());
  assert.ok((await stat(path.resolve(shellRoot, schemasResource.from, validatorInsidePackage))).isFile());
});

test('akari world の相対 import 閉包と overview HTML は同梱される場所だけを参照する', async () => {
  const pkg = await readShellPackageJson();
  const roots = packagedRoots(pkg.build.extraResources);
  const problems = [];
  const visited = new Set();
  // world.mjs の 3 入口はサブコマンド選択後の動的 import。既存 helper は静的 import
  // 閉包用なので、入口だけ明示して以降の相対 import を同じ解決器で辿る。
  const queue = [
    { sourcePath: path.resolve(shellRoot, '../..', worldRelative), packagedPath: worldPackagedPath },
    ...['build', 'preview', 'overview'].map((name) => ({
      sourcePath: path.resolve(shellRoot, '../../packages/akari-tools/src/world', `${name}.mjs`),
      packagedPath: `resources/packages/akari-tools/src/world/${name}.mjs`,
    })),
  ];

  while (queue.length > 0) {
    const current = queue.pop();
    if (visited.has(current.packagedPath)) continue;
    visited.add(current.packagedPath);
    for (const specifier of collectImportSpecifiers(await readFile(current.sourcePath, 'utf8'))) {
      if (!specifier.startsWith('.') && !specifier.startsWith('node:')) continue;
      const result = resolvePackagedSpecifier(specifier, { fromPackagedPath: current.packagedPath, roots, shellRoot });
      if (!result.ok) problems.push(`${current.packagedPath}: ${result.specifier} — ${result.reason}`);
      else if (!result.builtin) queue.push({ sourcePath: result.sourcePath, packagedPath: result.packagedPath });
    }
  }

  const overviewPath = 'resources/packages/akari-tools/src/world/overview.mjs';
  const template = resolvePackagedSpecifier('./overview-template.html', {
    fromPackagedPath: overviewPath,
    roots,
    shellRoot,
  });
  if (!template.ok) problems.push(`${overviewPath}: ${template.specifier} — ${template.reason}`);

  for (const name of ['normalize', 'invariants', 'camera', 'items', 'build', 'preview', 'overview']) {
    assert.ok(visited.has(`resources/packages/akari-tools/src/world/${name}.mjs`), `${name}.mjs を import 閉包で辿れない`);
  }
  assert.ok(template.ok, 'overview-template.html が src/**/* の同梱対象にない');
  assert.deepEqual(problems, [], `同梱されない場所を参照する import がある:\n${problems.join('\n')}`);
});
