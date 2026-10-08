// パッケージ済み .app へ写す packages/（lib/packages/ 配下）の参照不変条件テスト。
//
// 発端は v0.1.39 の実機報告: project-scaffold が issue #48 の対応で
// ../../akari-launcher/src/history-policy.mjs を import したが、写す対象の
// 決め打ちリストには無く、配布版だけ「新しい動画の作成に失敗しました
// （Cannot find module …history-policy.mjs）」になった。
//
// v1.2.0-beta.1〜beta.3 の配布版では「新しい動画の作成に失敗しました
// （Cannot find module './edit-store'）」が再発した。project-scaffold が
// ../../edit-store/lib/index.js を import するようになったが、写す側もこの
// テストも ESM の import … from だけを辿り、CommonJS の require("./edit-store")
// の先を見なかったので index.js 1 本だけが入った。リポ内では上方探索が本物の
// packages/ に当たるため開発中は露見しない。
// 辿る規則を cross-package-closure.mjs に寄せ、写し・パッケージ時の検査・
// このテストで共有する。npm test の時点で閉包と共有状態を確かめる。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tracePackageClosure } from '../resources/scripts/cross-package-closure.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const packagesRoot = path.join(repoRoot, 'packages');
const BUNDLED_PACKAGES = ['project-scaffold', 'creator-root'];

async function listModuleFiles(directory) {
  const found = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const candidate = path.join(directory, entry.name);
    if (entry.isDirectory()) found.push(...await listModuleFiles(candidate));
    else if (entry.isFile() && /\.(?:mjs|js|cjs)$/.test(entry.name)) found.push(candidate);
  }
  return found;
}

async function sourceClosure() {
  const roots = (await Promise.all(BUNDLED_PACKAGES.map(name =>
    listModuleFiles(path.join(packagesRoot, name, 'src'))))).flat();
  const kind = candidate => stat(candidate).then(entry => entry, () => null);
  return tracePackageClosure({
    roots,
    packagesRoot,
    readFile: file => readFile(file, 'utf8'),
    isFile: async file => (await kind(file))?.isFile() ?? false,
    isDirectory: async file => (await kind(file))?.isDirectory() ?? false
  });
}

test('project-scaffold から CJS の edit-store.js まで届く', async () => {
  const { files } = await sourceClosure();
  const expected = path.join(packagesRoot, 'edit-store', 'lib', 'edit-store.js');
  assert.ok(files.includes(expected), `届くはずの ${expected} がありません。到達先: ${JSON.stringify(files)}`);
});

test('発端の history-policy.mjs に届く', async () => {
  const { files } = await sourceClosure();
  const expected = path.join(packagesRoot, 'akari-launcher', 'src', 'history-policy.mjs');
  assert.ok(files.includes(expected), `届くはずの ${expected} がありません。到達先: ${JSON.stringify(files)}`);
});

test('届く参照はすべて実在し、packages/ の外へ出ない', async () => {
  const { unresolved } = await sourceClosure();
  assert.deepEqual(unresolved, [], `解決できない参照: ${JSON.stringify(unresolved)}`);
});

test('写しと asar 検査は共通の閉包関数を呼ぶ', async () => {
  const scripts = path.join(repoRoot, 'apps', 'shell', 'resources', 'scripts');
  const [copySource, verifySource] = await Promise.all([
    readFile(path.join(scripts, 'copy-native-helpers.mjs'), 'utf8'),
    readFile(path.join(scripts, 'verify-asar-contents.mjs'), 'utf8')
  ]);
  assert.match(copySource, /from\s+['"]\.\/cross-package-closure\.mjs['"]/,
    '写しが共通の閉包検査器を読み込んでいません');
  assert.match(copySource, /\btracePackageClosure\s*\(/,
    '写しが共通の tracePackageClosure を呼んでいません');
  assert.match(verifySource, /from\s+['"]\.\/cross-package-closure\.mjs['"]/,
    'asar 検査が共通の閉包検査器を読み込んでいません');
  assert.match(verifySource, /\btraceAsarPackageClosure\s*\(/,
    'asar 検査が共通の traceAsarPackageClosure を呼んでいません');
});
