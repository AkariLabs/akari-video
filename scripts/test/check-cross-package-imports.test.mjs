import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const checker = path.join(root, 'scripts/ci/check-cross-package-imports.mjs');
const run = args => spawnSync(process.execPath, [checker, ...args], { cwd: root, encoding: 'utf8' });

test('current distributed packages have no package-name imports', () => {
  const result = run([]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^\[cross-package-imports\] OK: \d+ packages, \d+ files\n$/);
});

test('imports in shell resources and vendor sources fail, including nested source directories', t => {
  const fixture = mkdtempSync(path.join(tmpdir(), 'cross-package-imports-'));
  t.after(() => rmSync(fixture, { recursive: true, force: true }));
  const put = (relative, value) => {
    const file = path.join(fixture, relative);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, value);
  };
  put('apps/shell/package.json', JSON.stringify({ build: { extraResources: [
    { from: '../../packages/packed', to: 'packages/packed' }
  ] } }));
  put('packages/akari-launcher/src/vendor-sources.mjs', "export const VENDOR_SOURCES = ['packages/vendor/src/entry.mjs'];\n");
  put('packages/packed/src/nested/static.mjs', [
    "// import ignored from '@akari-video/comment';",
    "const example = \"require('@akari-video/string')\";",
    "import { value } from '@akari-video/static';",
    "export { value } from '@akari-video/reexport';"
  ].join('\n'));
  put('packages/packed/bin/dynamic.js', "await import('@akari-video/dynamic');\n");
  put('packages/vendor/lib/common.cjs', "require('@akari-video/common');\nmodule.require('@akari-video/module');\n");
  put('packages/vendor/src/entry.mjs', "import '@akari-video/side-effect';\n");
  put('packages/vendor/src/ignored.txt', "require('@akari-video/text');\n");

  const result = run(['--root', fixture]);
  assert.equal(result.status, 1, result.stdout);
  for (const name of ['static', 'reexport', 'dynamic', 'common', 'module', 'side-effect']) {
    assert.match(result.stderr, new RegExp(`@akari-video/${name}`));
  }
  assert.doesNotMatch(result.stderr, /@akari-video\/(?:comment|string|text)/);
});

test('top-level await in a package module reached from shell backend fails', t => {
  const fixture = mkdtempSync(path.join(tmpdir(), 'cross-package-await-'));
  t.after(() => rmSync(fixture, { recursive: true, force: true }));
  const put = (relative, value) => {
    const file = path.join(fixture, relative);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, value);
  };
  put('apps/shell/package.json', JSON.stringify({ build: { extraResources: [] } }));
  put('packages/akari-launcher/src/vendor-sources.mjs', 'export const VENDOR_SOURCES = [];\n');
  put('apps/shell/extensions/example/src/node/service.ts',
    "import { value } from '../common/bridge.ts';\n");
  put('apps/shell/extensions/example/src/common/bridge.ts',
    "export { value } from '@akari-video/reached';\n");
  put('packages/reached/package.json', JSON.stringify({
    name: '@akari-video/reached', exports: { '.': './src/entry.mjs' }
  }));
  put('packages/reached/src/entry.mjs', [
    '// await Promise.resolve(0);',
    'const text = "await Promise.resolve(0)";',
    'const template = `await Promise.resolve(0)`;',
    'async function insideFunction() { await Promise.resolve(0); }',
    'const insideArrow = async () => await Promise.resolve(0);',
    "export { value } from './nested.mjs';"
  ].join('\n'));
  put('packages/reached/src/nested.mjs', 'export const value = 1;\n');
  put('packages/unreached/src/other.mjs', 'await Promise.resolve(2);\n');

  const green = run(['--root', fixture]);
  assert.equal(green.status, 0, green.stderr);

  put('packages/reached/src/nested.mjs', 'export const value = await Promise.resolve(1);\n');
  const result = run(['--root', fixture]);
  assert.equal(result.status, 1, result.stdout);
  assert.match(result.stderr, /packages\/reached\/src\/nested\.mjs:1: top-level await/);
  assert.doesNotMatch(result.stderr, /packages\/unreached/);

  put('packages/reached/src/nested.mjs', 'for await (const value of []) {}\n');
  const loop = run(['--root', fixture]);
  assert.equal(loop.status, 1, loop.stdout);
  assert.match(loop.stderr, /packages\/reached\/src\/nested\.mjs:1: top-level await/);
});
