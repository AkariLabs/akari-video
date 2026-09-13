// afterPack フック（resources/scripts/after-pack-app-update-yml.cjs）の実行検証。
//
// electron-builder は darwin では zip / dmg ターゲットのときしか app-update.yml を書かないため、
// `npm run package`（--dir）のローカルビルドには入らず、main の feed URL フォールバックでも
// DL 開始時の app-update.yml 読み込み（updaterCacheDirName）で ENOENT になっていた
// （オーナー実機 2026-09-13）。フックが packager.getResourcesDir(appOutDir) 直下へ
// gen-app-update-yml.mjs とバイト等価の app-update.yml を書くことを、偽の context で固定する。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateAppUpdateYml } from '../../../scripts/release/gen-app-update-yml.mjs';

const require = createRequire(import.meta.url);
const hook = require('../resources/scripts/after-pack-app-update-yml.cjs');
const shellRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(shellRoot, '..', '..');

function fakeContext(electronPlatformName, appOutDir) {
  return {
    electronPlatformName,
    appOutDir,
    packager: {
      // MacPackager.getResourcesDir / WinPackager.getResourcesDir と同形（呼び出し規約だけ模す）
      getResourcesDir: out => (electronPlatformName === 'darwin'
        ? path.join(out, 'AKARI Video.app', 'Contents', 'Resources')
        : path.join(out, 'resources'))
    }
  };
}

test('フックは module.exports と afterPack 名前付き export の両方で同じ関数を公開する（electron-builder の resolveFunction が name → default の順で探す）', () => {
  assert.equal(typeof hook, 'function');
  assert.equal(hook.afterPack, hook);
});

test('darwin: packager.getResourcesDir(appOutDir) 直下へ gen-app-update-yml.mjs とバイト等価の app-update.yml を書く', async t => {
  const appOutDir = await mkdtemp(path.join(tmpdir(), 'akari-after-pack-mac-'));
  t.after(() => rm(appOutDir, { recursive: true, force: true }));

  await hook(fakeContext('darwin', appOutDir));

  const written = await readFile(path.join(appOutDir, 'AKARI Video.app', 'Contents', 'Resources', 'app-update.yml'), 'utf8');
  assert.equal(written, await generateAppUpdateYml({ repoRoot }));
  assert.match(written, /^updaterCacheDirName: '@akari-videoshell-updater'$/m);
});

test('win32: resources 直下へ書く（release.yml build-win の gen-app-update-yml ステップと同じ場所・同じ内容）', async t => {
  const appOutDir = await mkdtemp(path.join(tmpdir(), 'akari-after-pack-win-'));
  t.after(() => rm(appOutDir, { recursive: true, force: true }));

  await hook(fakeContext('win32', appOutDir));

  assert.equal(
    await readFile(path.join(appOutDir, 'resources', 'app-update.yml'), 'utf8'),
    await generateAppUpdateYml({ repoRoot })
  );
});

test('linux: 何も書かない（electron-updater を同梱する配布物が無い）', async t => {
  const appOutDir = await mkdtemp(path.join(tmpdir(), 'akari-after-pack-linux-'));
  t.after(() => rm(appOutDir, { recursive: true, force: true }));

  await hook(fakeContext('linux', appOutDir));

  await assert.rejects(stat(path.join(appOutDir, 'resources', 'app-update.yml')), { code: 'ENOENT' });
  assert.equal(hook.shouldWriteAppUpdateYml('linux'), false);
  assert.equal(hook.shouldWriteAppUpdateYml('darwin'), true);
  assert.equal(hook.shouldWriteAppUpdateYml('win32'), true);
});
