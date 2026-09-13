// afterPack フック（resources/scripts/after-pack-app-update-yml.cjs）の実行検証。
//
// electron-builder は darwin では zip / dmg ターゲットのときしか app-update.yml を書かないため、
// `npm run package`（--dir）のローカルビルドには入らず、main の feed URL フォールバックでも
// DL 開始時の app-update.yml 読み込み（updaterCacheDirName）で ENOENT になっていた
// （オーナー実機 2026-09-13）。フックが (1) --dir のとき packager.getResourcesDir(appOutDir) 直下へ
// gen-app-update-yml.mjs とバイト等価の app-update.yml を書き、(2) electron-builder 自身が書く
// ターゲット構成（CI の zip / dmg・nsis）では正規の生成物を上書きしないことを、偽の context で固定する。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateAppUpdateYml } from '../../../scripts/release/gen-app-update-yml.mjs';

const require = createRequire(import.meta.url);
const hook = require('../resources/scripts/after-pack-app-update-yml.cjs');
const shellRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(shellRoot, '..', '..');

function resourcesDirFor(electronPlatformName, appOutDir) {
  return electronPlatformName === 'darwin'
    ? path.join(appOutDir, 'AKARI Video.app', 'Contents', 'Resources')
    : path.join(appOutDir, 'resources');
}

function fakeContext(electronPlatformName, appOutDir, targets) {
  return {
    electronPlatformName,
    appOutDir,
    targets,
    packager: {
      // MacPackager.getResourcesDir / WinPackager.getResourcesDir と同形（呼び出し規約だけ模す）
      getResourcesDir: out => resourcesDirFor(electronPlatformName, out)
    }
  };
}

async function tempOutDir(t, label) {
  const dir = await mkdtemp(path.join(tmpdir(), `akari-after-pack-${label}-`));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

test('フックは module.exports と afterPack 名前付き export の両方で同じ関数を公開する（electron-builder の resolveFunction が name → default の順で探す）', () => {
  assert.equal(typeof hook, 'function');
  assert.equal(hook.afterPack, hook);
});

test('darwin --dir: packager.getResourcesDir(appOutDir) 直下へ gen-app-update-yml.mjs とバイト等価の app-update.yml を書く', async t => {
  const appOutDir = await tempOutDir(t, 'mac-dir');

  await hook(fakeContext('darwin', appOutDir, [{ name: 'dir' }]));

  const written = await readFile(path.join(resourcesDirFor('darwin', appOutDir), 'app-update.yml'), 'utf8');
  assert.equal(written, await generateAppUpdateYml({ repoRoot }));
  assert.match(written, /^updaterCacheDirName: '@akari-videoshell-updater'$/m);
});

test('win32 --dir: resources 直下へ書く（release.yml build-win の gen-app-update-yml ステップと同じ場所・同じ内容）', async t => {
  const appOutDir = await tempOutDir(t, 'win-dir');

  await hook(fakeContext('win32', appOutDir, [{ name: 'dir' }]));

  assert.equal(
    await readFile(path.join(resourcesDirFor('win32', appOutDir), 'app-update.yml'), 'utf8'),
    await generateAppUpdateYml({ repoRoot })
  );
});

test('darwin zip/dmg（CI の --mac zip dmg）: electron-builder 自身が書くので、先に置かれた正規の app-update.yml を上書きしない', async t => {
  const appOutDir = await tempOutDir(t, 'mac-zip');
  const resources = resourcesDirFor('darwin', appOutDir);
  await mkdir(resources, { recursive: true });
  const official = 'owner: AkariLabs\nrepo: akari-video\nprovider: github\nupdaterCacheDirName: \'@akari-videoshell-updater\'\npublisherName:\n  - Official\n';
  await writeFile(path.join(resources, 'app-update.yml'), official, 'utf8');

  await hook(fakeContext('darwin', appOutDir, [{ name: 'zip' }, { name: 'dmg' }]));

  assert.equal(await readFile(path.join(resources, 'app-update.yml'), 'utf8'), official);
});

test('win32 nsis: electron-builder 自身が書く構成では何も書かない（Windows 署名有効化時の publisherName を落とさない）', async t => {
  const appOutDir = await tempOutDir(t, 'win-nsis');

  await hook(fakeContext('win32', appOutDir, [{ name: 'nsis' }]));

  await assert.rejects(stat(path.join(resourcesDirFor('win32', appOutDir), 'app-update.yml')), { code: 'ENOENT' });
});

test('gate は app-builder-lib PublishManager.onAfterPack と同じ定義（darwin: zip/dmg・win32: nsis / nsis-* / electronUpdaterAware な appx）', () => {
  const writes = hook.electronBuilderWritesAppUpdateYml;
  assert.equal(writes('darwin', [{ name: 'dir' }]), false);
  assert.equal(writes('darwin', [{ name: 'zip' }]), true);
  assert.equal(writes('darwin', [{ name: 'dmg' }]), true);
  assert.equal(writes('darwin', undefined), false);
  assert.equal(writes('win32', [{ name: 'dir' }]), false);
  assert.equal(writes('win32', [{ name: 'nsis' }]), true);
  assert.equal(writes('win32', [{ name: 'nsis-web' }]), true);
  assert.equal(writes('win32', [{ name: 'appx', options: { electronUpdaterAware: true } }]), true);
  assert.equal(writes('win32', [{ name: 'appx', options: {} }]), false);
  assert.equal(writes('win32', [{ name: 'portable' }]), false);

  assert.equal(hook.shouldWriteAppUpdateYml('darwin', [{ name: 'dir' }]), true);
  assert.equal(hook.shouldWriteAppUpdateYml('darwin', [{ name: 'dir' }, { name: 'zip' }]), false);
  assert.equal(hook.shouldWriteAppUpdateYml('win32', [{ name: 'dir' }]), true);
  assert.equal(hook.shouldWriteAppUpdateYml('linux', [{ name: 'dir' }]), false);
});

test('linux: 何も書かない（electron-updater を同梱する配布物が無い）', async t => {
  const appOutDir = await tempOutDir(t, 'linux');

  await hook(fakeContext('linux', appOutDir, [{ name: 'dir' }]));

  await assert.rejects(stat(path.join(appOutDir, 'resources', 'app-update.yml')), { code: 'ENOENT' });
});
