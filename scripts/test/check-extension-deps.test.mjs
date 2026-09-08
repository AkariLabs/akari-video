import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  extractExtensionImports,
  parseBuildExtOrder,
  findOrderViolations,
  findMissingFileDeps
} from '../ci/check-extension-deps.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const checker = path.join(repoRoot, 'scripts/ci/check-extension-deps.mjs');
const shellPackage = path.join(repoRoot, 'apps/shell/package.json');
const expectedOrder = [
  'akari-theme', 'akari-project', 'akari-preview', 'akari-annotations',
  'akari-shell-strip', 'akari-surfaces', 'akari-partner', 'akari-tabs', 'akari-transcript'
];
const edges = [{ from: 'akari-transcript', to: 'akari-theme' }];
const run = (args = [], cwd = repoRoot) => spawnSync(process.execPath, [checker, ...args], { cwd, encoding: 'utf8' });
const temporaryDirectory = t => {
  const directory = mkdtempSync(path.join(tmpdir(), 'check-extension-deps-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
};

test('通常 import・import type・動的 import・require を抽出し、重複をまとめて行番号を残す', () => {
  const source = [
    "import { theme } from 'akari-theme/lib/theme';",
    'import type { Project } from "akari-project/lib/protocol";',
    "const preview = import('akari-preview/lib/preview');",
    "const annotations = require('akari-annotations/lib/annotations');",
    "export { theme } from 'akari-theme/lib/theme';"
  ].join('\n');
  assert.deepEqual(extractExtensionImports(source, { extensionNames: expectedOrder, selfName: 'akari-transcript' }), [
    { name: 'akari-theme', lines: [1, 5] },
    { name: 'akari-project', lines: [2] },
    { name: 'akari-preview', lines: [3] },
    { name: 'akari-annotations', lines: [4] }
  ]);
});

test('相対パス・scope・非拡張・自己参照・コメント・文字列を除外する', () => {
  const source = [
    "import x from '../akari-theme/lib/x';",
    "import x from '@scope/akari-theme';",
    "import x from 'akari-video/lib/x';",
    "import x from 'akari-transcript/lib/x';",
    "// import x from 'akari-theme/lib/x';",
    "/* require('akari-theme/lib/x'); */",
    'const text = "from \'akari-theme/lib/x\'";',
    'const template = `require("akari-theme/lib/x")`;',
    "object.require('akari-theme/lib/x');"
  ].join('\n');
  assert.deepEqual(extractExtensionImports(source, { extensionNames: expectedOrder, selfName: 'akari-transcript' }), []);
});

test('複数行・CRLF・コメントを挟んだ import でも根拠行を保持する', () => {
  assert.deepEqual(extractExtensionImports("/* comment */\r\nimport( /* comment */\r\n'akari-theme/lib/theme'\r\n);", {
    extensionNames: new Set(expectedOrder), selfName: 'akari-transcript'
  }), [{ name: 'akari-theme', lines: [2] }]);
});

test('順序が正しければ違反なし、逆順なら違反 1 件', () => {
  assert.deepEqual(findOrderViolations(['akari-theme', 'akari-transcript'], edges), []);
  assert.deepEqual(findOrderViolations(['akari-transcript', 'akari-theme'], edges), edges);
});

test('依存元・依存先・両方のトークン欠落を検出する', () => {
  for (const order of [['akari-theme'], ['akari-transcript'], []]) {
    assert.deepEqual(findOrderViolations(order, edges), edges);
  }
});

test('dependencies に file: 宣言が必要で、欠落と非 file: を検出する', () => {
  assert.deepEqual(findMissingFileDeps({ 'akari-theme': 'file:../akari-theme' }, edges), []);
  for (const dependencies of [undefined, {}, { 'akari-theme': '^1.0.0' }, { 'akari-theme': 'workspace:*' }, { 'akari-theme': null }]) {
    assert.deepEqual(findMissingFileDeps(dependencies, edges), edges);
  }
});

test('実物の build:ext から 9 拡張を依存順に取り出す', () => {
  const shell = JSON.parse(readFileSync(shellPackage, 'utf8'));
  assert.deepEqual(parseBuildExtOrder(shell.scripts['build:ext']), expectedOrder);
});

test('tsc -b 以外のコマンドを除外し、引用されたパスを扱う', () => {
  assert.deepEqual(parseBuildExtOrder('npm run prepare && tsc -b "extensions/akari-theme" ./extensions/akari-transcript/ --pretty && echo extensions/akari-project'), [
    'akari-theme', 'akari-transcript'
  ]);
  assert.deepEqual(parseBuildExtOrder('echo extensions/akari-theme'), []);
  assert.deepEqual(parseBuildExtOrder(undefined), []);
});

test('実物のリポを検査すると exit 0、要約は 1 行', () => {
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  assert.match(result.stdout, /^\[extension-deps\] OK: 9 extensions, \d+ files, \d+ imports\n$/);
});

test('theme を末尾に戻すと exit 1、shell-package の差し替えでも既定 extensions-dir は不変', t => {
  const directory = temporaryDirectory(t);
  const shell = JSON.parse(readFileSync(shellPackage, 'utf8'));
  shell.scripts['build:ext'] = `tsc -b ${[...expectedOrder.slice(1), expectedOrder[0]].map(name => `extensions/${name}`).join(' ')}`;
  const fixture = path.join(directory, 'package.json');
  writeFileSync(fixture, JSON.stringify(shell));
  const result = run(['--shell-package', fixture], directory);
  assert.equal(result.status, 1, result.stdout);
  assert.match(result.stderr, /akari-transcript\/src\/.+:\d+: akari-transcript → akari-theme: build:ext/);
  assert.match(result.stderr, /akari-annotations\/src\/.+:\d+: akari-annotations → akari-theme: build:ext/);
});

test('extensions-dir の差し替えで全対象拡張子を走査し、宣言と順序の違反を全件列挙する', t => {
  const directory = temporaryDirectory(t);
  const extensionsDir = path.join(directory, 'extensions');
  for (const name of ['akari-theme', 'akari-transcript']) {
    const extensionDir = path.join(extensionsDir, name);
    mkdirSync(path.join(extensionDir, 'src/nested'), { recursive: true });
    writeFileSync(path.join(extensionDir, 'package.json'), JSON.stringify({ name, dependencies: {} }));
  }
  for (const suffix of ['ts', 'tsx', 'mjs', 'js', 'cjs', 'txt']) {
    writeFileSync(path.join(extensionsDir, 'akari-transcript/src/nested', `example.${suffix}`), "// 根拠は次の行\nimport x from 'akari-theme/lib/x';\n");
  }
  const fixture = path.join(directory, 'package.json');
  writeFileSync(fixture, JSON.stringify({ scripts: { 'build:ext': 'tsc -b extensions/akari-transcript' } }));
  const result = run(['--extensions-dir', extensionsDir, '--shell-package', fixture]);
  assert.equal(result.status, 1);
  const lines = result.stderr.trim().split('\n');
  assert.equal(lines.length, 10, result.stderr);
  for (const suffix of ['ts', 'tsx', 'mjs', 'js', 'cjs']) {
    const evidence = lines.filter(line => line.includes(`example.${suffix}:2:`));
    assert.equal(evidence.length, 2);
    assert.ok(evidence.some(line => line.includes('dependencies に file:')));
    assert.ok(evidence.some(line => line.includes('build:ext')));
  }
});
