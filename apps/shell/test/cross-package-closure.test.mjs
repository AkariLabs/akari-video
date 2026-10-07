// 配布する参照の閉包について、ESM・CJS と Node のファイル解決規則を固定する。
// 辿り損ねるとリポ内では動いても、配布物には必要なファイルが入らない。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { tracePackageClosure } from '../resources/scripts/cross-package-closure.mjs';

async function fixture(files, root = 'entry/src/index.mjs') {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'akari-closure-test-'));
  const packagesRoot = path.join(directory, 'packages');
  for (const [name, contents] of Object.entries(files)) {
    const file = path.join(packagesRoot, name);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, contents);
  }
  const kind = candidate => stat(candidate).then(entry => entry, () => null);
  return {
    packagesRoot,
    async trace() {
      return tracePackageClosure({
        roots: [path.join(packagesRoot, root)],
        packagesRoot,
        readFile: file => readFile(file, 'utf8'),
        isFile: async file => (await kind(file))?.isFile() ?? false,
        isDirectory: async file => (await kind(file))?.isDirectory() ?? false
      });
    },
    close: () => rm(directory, { recursive: true, force: true })
  };
}

test('ESM から CJS の連鎖を最後まで辿る', async () => {
  const f = await fixture({
    'entry/src/index.mjs': "import value from '../../store/index.js';",
    'store/index.js': 'require("./a");',
    'store/a.js': 'require("./b");',
    'store/b.js': 'module.exports = 1;'
  });
  try {
    const result = await f.trace();
    assert.deepEqual(result.unresolved, []);
    assert.ok(result.files.includes(path.join(f.packagesRoot, 'store/b.js')));
  } finally { await f.close(); }
});

test('空白のない import と export from も辿る', async () => {
  const f = await fixture({
    'entry/src/index.mjs': "import{a}from'../../store/x.mjs';export*from\"../../store/y.mjs\";import\"../../store/z.mjs\";",
    'store/x.mjs': 'export const a = 1;',
    'store/y.mjs': 'export const b = 2;',
    'store/z.mjs': 'export const c = 3;'
  });
  try {
    const result = await f.trace();
    assert.deepEqual(result.unresolved, []);
    assert.ok(result.files.includes(path.join(f.packagesRoot, 'store/x.mjs')));
    assert.ok(result.files.includes(path.join(f.packagesRoot, 'store/y.mjs')));
    assert.ok(result.files.includes(path.join(f.packagesRoot, 'store/z.mjs')));
  } finally { await f.close(); }
});

test('補間のないテンプレートリテラルの require と import を辿る', async () => {
  const f = await fixture({
    'entry/src/index.mjs': "import '../../store/index.js';",
    'store/index.js': 'require(`./x`); import(`./y.mjs`); require(`./${name}`);',
    'store/x.js': 'module.exports = 1;',
    'store/y.mjs': 'export default 2;'
  });
  try {
    const result = await f.trace();
    assert.deepEqual(result.unresolved, []);
    assert.ok(result.files.includes(path.join(f.packagesRoot, 'store/x.js')));
    assert.ok(result.files.includes(path.join(f.packagesRoot, 'store/y.mjs')));
  } finally { await f.close(); }
});

test('ディレクトリの index.js と拡張子なしの JSON を解決する', async () => {
  const f = await fixture({
    'entry/src/index.mjs': "import '../../store/index.js';",
    'store/index.js': "require('./dir'); require('./data');",
    'store/dir/index.js': 'module.exports = 1;',
    'store/data.json': '{}'
  });
  try {
    const result = await f.trace();
    assert.deepEqual(result.unresolved, []);
    assert.ok(result.files.includes(path.join(f.packagesRoot, 'store/dir/index.js')));
    assert.ok(result.files.includes(path.join(f.packagesRoot, 'store/data.json')));
  } finally { await f.close(); }
});

test('動的 import を辿り、循環で止まる', async () => {
  const f = await fixture({
    'entry/src/index.mjs': "import('../../store/x.mjs');",
    'store/x.mjs': "import './a.mjs';",
    'store/a.mjs': "import './x.mjs';"
  });
  try {
    const result = await f.trace();
    assert.equal(result.files.length, 3);
    assert.deepEqual(result.unresolved, []);
  } finally { await f.close(); }
});

test('コメントと文字列の require も欠落を報告し、変数参照は対象外', async () => {
  const f = await fixture({
    'entry/src/index.mjs': "import '../../store/index.js';",
    'store/index.js': "// require('./comment')\nconst text = \"require('./string')\"; require(name);"
  });
  try {
    const { unresolved } = await f.trace();
    assert.deepEqual(unresolved.map(item => item.specifier).sort(), ['./comment', './string']);
  } finally { await f.close(); }
});

test('node 組み込みを無視し、裸の指定子・欠落・packages 外への参照を報告する', async () => {
  const f = await fixture({
    'entry/src/index.mjs': "import fs from 'node:fs'; import path from 'path'; import '../../store/index.js';",
    'store/index.js': "require('node:crypto'); require('os'); require('third-party'); require('./missing'); require('../../outside.js');"
  });
  try {
    const { unresolved } = await f.trace();
    assert.deepEqual(unresolved.map(item => item.reason).sort(), ['bare', 'missing', 'outside']);
  } finally { await f.close(); }
});

test('package.json の main が必要なディレクトリは止める', async () => {
  const f = await fixture({
    'entry/src/index.mjs': "import '../../store/index.js';",
    'store/index.js': "require('./dir');",
    'store/dir/package.json': '{"main":"other.js"}',
    'store/dir/other.js': 'module.exports = 1;'
  });
  try {
    const { unresolved } = await f.trace();
    assert.deepEqual(unresolved.map(item => item.reason), ['package-main']);
  } finally { await f.close(); }
});
