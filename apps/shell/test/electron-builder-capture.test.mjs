// issue #74: デスクトップ版（Windows / macOS とも）に `akari capture` の実行体
// packages/akari-tools/bin/capture.mjs が同梱されておらず、ランチャーが
// 「実行スクリプトが見つかりません」で止まっていた。extraResources の akari-tools filter が
// bin を 1 本ずつ列挙する方式のため、capture.mjs の追加（2026-08）が漏れたまま v0.1.63 まで出た。
// ここでは (a) ランチャーが参照する相対パスがそのまま filter に含まれること、(b) その import 閉包が
// 同梱される場所だけを参照すること（相対 import。bare 指定子は scripts/release/check-packaged-imports.mjs
// が cli-node-modules と突き合わせる）を npm test の時点で固定する。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { CAPTURE_SCRIPT_RELATIVE } from '../../../packages/akari-launcher/src/repo-assets.mjs';
import { collectImportSpecifiers, packagedRoots, resolvePackagedSpecifier } from './helpers/packaged-imports.mjs';

const shellRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const captureRelative = CAPTURE_SCRIPT_RELATIVE.split(path.sep).join('/');
const captureInsidePackage = captureRelative.replace(/^packages\/akari-tools\//, '');
const capturePackagedPath = path.posix.join('resources', captureRelative);

async function readShellPackageJson() {
  return JSON.parse(await readFile(path.join(shellRoot, 'package.json'), 'utf8'));
}

test('extraResources はランチャーが参照する akari capture の実行体を同梱する', async () => {
  const pkg = await readShellPackageJson();
  const toolsResource = pkg.build.extraResources.find(
    (resource) => resource.from === '../../packages/akari-tools' && resource.to === 'packages/akari-tools',
  );
  assert.ok(toolsResource, 'packages/akari-tools の extraResources 宣言が無い');
  assert.equal(captureInsidePackage, 'bin/capture.mjs');
  assert.ok(
    toolsResource.filter?.includes(captureInsidePackage),
    `${captureInsidePackage} が packages/akari-tools の filter に含まれていない（akari capture が配布版で動かない）`,
  );
  const sourcePath = path.resolve(shellRoot, toolsResource.from, captureInsidePackage);
  assert.ok((await stat(sourcePath)).isFile(), `同梱元ファイルが存在しない: ${sourcePath}`);
});

test('akari capture の相対 import 閉包は同梱される場所だけを参照する', async () => {
  const pkg = await readShellPackageJson();
  const roots = packagedRoots(pkg.build.extraResources);
  const problems = [];
  const visited = new Set();
  const queue = [{ sourcePath: path.resolve(shellRoot, '../..', captureRelative), packagedPath: capturePackagedPath }];
  let entrySpecifierCount = 0;

  while (queue.length > 0) {
    const current = queue.pop();
    if (visited.has(current.packagedPath)) continue;
    visited.add(current.packagedPath);
    const specifiers = collectImportSpecifiers(await readFile(current.sourcePath, 'utf8'));
    if (current.packagedPath === capturePackagedPath) entrySpecifierCount = specifiers.length;
    for (const specifier of specifiers) {
      // bare 指定子（npm 依存）は resources/packages/node_modules の staging が要るため
      // scripts/release/check-packaged-imports.mjs に任せ、ここでは同梱元の相対参照だけを辿る。
      if (!specifier.startsWith('.') && !specifier.startsWith('node:')) continue;
      const result = resolvePackagedSpecifier(specifier, { fromPackagedPath: current.packagedPath, roots, shellRoot });
      if (!result.ok) {
        problems.push(`${current.packagedPath}: ${result.specifier} — ${result.reason}`);
        continue;
      }
      if (!result.builtin) queue.push({ sourcePath: result.sourcePath, packagedPath: result.packagedPath });
    }
  }

  assert.ok(entrySpecifierCount > 0, 'capture.mjs に import 宣言が見つからない');
  assert.ok(visited.size > 5, `import 閉包が浅すぎる（辿れたファイル ${visited.size} 件）`);
  assert.deepEqual(problems, [], `同梱されない場所を参照する import がある:\n${problems.join('\n')}`);
});
