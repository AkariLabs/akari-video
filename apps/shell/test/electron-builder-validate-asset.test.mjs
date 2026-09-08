import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, statSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// filter のグロブ照合は同梱検査の正本（scripts/release/check-packaged-imports.mjs）と同じ実装を使う。
import { globToRegExp } from '../../../scripts/release/check-packaged-imports.mjs';

const shellRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const validateAssetRelativePath = 'bin/validate-asset.mjs';
const validateAssetPackagedPath = 'resources/packages/schemas/bin/validate-asset.mjs';

async function readShellPackageJson() {
  return JSON.parse(await readFile(path.join(shellRoot, 'package.json'), 'utf8'));
}

// --- 同梱後レイアウトの検査（純関数。指定子の配列を引数で渡せる形にしてある） ---

// extraResources を「同梱後の置き場 resources/<to>/… ← 元 <from>（filter 付き）」の一覧へ。
// 同じ接頭辞が重なる（`to: "."` 等）ので、長い接頭辞から先に照合できるよう並べ替える。
export function packagedRoots(extraResources) {
  return (extraResources ?? [])
    .map((entry) => (typeof entry === 'string' ? { from: entry, to: '.' } : entry))
    .map((entry) => ({
      from: entry.from,
      filter: entry.filter ?? null,
      prefix: path.posix.join('resources', entry.to ?? '.'),
    }))
    .sort((left, right) => right.prefix.length - left.prefix.length);
}

// 指定子 1 本を「同梱後レイアウト上で解決できるか」で判定する。
// ok = node: 組み込み、または (a) 同梱元ファイルが実在し (b) その from の filter に含まれる。
export function resolvePackagedSpecifier(specifier, { fromPackagedPath, roots, shellRoot: root }) {
  if (specifier.startsWith('node:')) return { specifier, ok: true, builtin: true };
  if (!specifier.startsWith('.')) {
    return { specifier, ok: false, reason: '相対 import ではないため同梱後の置き場を特定できない' };
  }
  const packagedPath = path.posix.join(path.posix.dirname(fromPackagedPath), specifier);
  const tried = [];
  for (const candidate of roots) {
    if (packagedPath !== candidate.prefix && !packagedPath.startsWith(`${candidate.prefix}/`)) continue;
    const inside = path.posix.relative(candidate.prefix, packagedPath);
    const sourcePath = path.resolve(root, candidate.from, inside);
    const exists = existsSync(sourcePath) && statSync(sourcePath).isFile();
    const included = candidate.filter === null
      || candidate.filter.some((pattern) => globToRegExp(pattern).test(inside));
    if (exists && included) {
      return { specifier, ok: true, packagedPath, sourcePath, from: candidate.from };
    }
    tried.push(`${candidate.from} → ${inside}（同梱元: ${exists ? '実在' : '無し'} / filter: ${included ? '含む' : '含まない'}）`);
  }
  return {
    specifier,
    ok: false,
    packagedPath,
    reason: `同梱後 ${packagedPath} へ解決できない（候補: ${tried.length > 0 ? tried.join(' / ') : 'extraResources に該当する to が無い'}）`,
  };
}

// 指定子の配列を受け取り、同梱後に解決できないものだけを返す。
export function checkPackagedImports(specifiers, options) {
  return specifiers
    .map((specifier) => resolvePackagedSpecifier(specifier, options))
    .filter((result) => !result.ok);
}

const IMPORT_PATTERNS = [
  /\bimport\s+(?:(?:[^'";]+?\s+from\s+)?['"]([^'"]+)['"]|\(\s*['"]([^'"]+)['"]\s*\))/g,
  /\bexport\s+[^'";]*?\bfrom\s*['"]([^'"]+)['"]/g,
];

export function collectImportSpecifiers(source) {
  const specifiers = [];
  for (const pattern of IMPORT_PATTERNS) {
    for (const match of source.matchAll(pattern)) {
      const specifier = match[1] ?? match[2];
      if (specifier && !specifiers.includes(specifier)) specifiers.push(specifier);
    }
  }
  return specifiers;
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
