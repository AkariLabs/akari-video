import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const shellRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const electronEntryPath = path.join(shellRoot, 'electron-entry.js');
const { selectEntry } = require(electronEntryPath);
const osrRelative = 'packages/osr-export/src/electron-main.mjs';
const gpuRelative = 'packages/gpu-export/src/electron-main.mjs';

function select(argv, existing = []) {
  return selectEntry(argv, {
    resourcesPath: '/bundle/resources',
    devRoot: '/repo',
    exists: candidate => existing.includes(candidate),
  });
}

test('selectEntry は --render が無い通常起動を Theia へ渡す', () => {
  assert.deepEqual(select(['electron', 'apps/shell']), { mode: 'theia' });
});

test('selectEntry は既定 OSR ランタイムで resourcesPath 側を優先する', () => {
  const bundled = path.join('/bundle/resources', osrRelative);
  const dev = path.join('/repo', osrRelative);
  assert.deepEqual(select(['electron', '--render'], [dev, bundled]), {
    mode: 'headless', runtime: bundled, relative: osrRelative,
  });
});

test('selectEntry は resourcesPath 側が無ければ devRoot 側へフォールバックする', () => {
  const dev = path.join('/repo', osrRelative);
  assert.deepEqual(select(['electron', '--render'], [dev]), {
    mode: 'headless', runtime: dev, relative: osrRelative,
  });
});

test('selectEntry は許可済み GPU ランタイムを選択する', () => {
  const bundled = path.join('/bundle/resources', gpuRelative);
  assert.deepEqual(select(['electron', '--render', '--akari-main', gpuRelative], [bundled]), {
    mode: 'headless', runtime: bundled, relative: gpuRelative,
  });
});

test('selectEntry は許可外の --akari-main を code 2 で拒否する', () => {
  assert.deepEqual(select(['electron', '--render', '--akari-main', 'packages/bogus/main.mjs']), {
    mode: 'error',
    code: 2,
    message: 'akari-entry: unsupported --akari-main: packages/bogus/main.mjs',
  });
});

test('selectEntry はランタイムが両候補に無ければ code 2 にする', () => {
  assert.deepEqual(select(['electron', '--render']), {
    mode: 'error',
    code: 2,
    message: `akari-entry: runtime not bundled: ${osrRelative}`,
  });
});

test('selectEntry は --render=<path> 形式もヘッドレスとして検出する', () => {
  const bundled = path.join('/bundle/resources', osrRelative);
  assert.equal(select(['electron', '--render=/project'], [bundled]).mode, 'headless');
});

test('selectEntry は --render の前方一致に見える別オプションを通常起動として扱う', () => {
  assert.deepEqual(select(['electron', '--renderer-process-limit=4']), { mode: 'theia' });
});

test('entry ガードは Electron の browser メインプロセスも自己起動対象にする', () => {
  const source = readFileSync(electronEntryPath, 'utf8');
  assert.match(
    source,
    /Boolean\(process\.versions\.electron\)\s*&&\s*process\.type === 'browser'/
  );
  assert.match(source, /require\.main === module\s*\|\|\s*isElectronMain/);
});

test('Node から require された entry は run の副作用を起こさない', () => {
  const result = spawnSync(
    process.execPath,
    ['-e', `require(${JSON.stringify(electronEntryPath)}); process.stdout.write('loaded')`],
    { encoding: 'utf8' }
  );
  assert.equal(result.status, 0);
  assert.equal(result.stdout, 'loaded');
  assert.equal(result.stderr, '');
});

test('shell package.json と拡張除去状態が専用エントリ構成に一致する', () => {
  const manifest = JSON.parse(readFileSync(path.join(shellRoot, 'package.json'), 'utf8'));
  assert.equal(manifest.main, 'electron-entry.js');
  assert.ok(manifest.build.files.includes('electron-entry.js'));
  assert.ok(!Object.hasOwn(manifest.dependencies, 'akari-osr-export'));
  assert.ok(!manifest.scripts['build:ext'].includes('extensions/akari-osr-export'));
  assert.equal(existsSync(path.join(shellRoot, 'extensions', 'akari-osr-export')), false);
});
