'use strict';
// electron-builder の afterPack フック: パッケージ直後・署名前に Resources へ app-update.yml を書く。
//
// electron-builder（app-builder-lib PublishManager.onAfterPack）は darwin では targets に
// zip / dmg が含まれるとき、win32 では nsis 系 / electronUpdaterAware な appx のときだけ
// app-update.yml を書くため、`npm run package`（= `electron-builder --dir`、オーナーのローカルビルド
// harness/scripts/owner-build.sh もこれ）で作った .app には入らない。
// main プロセスの feed URL フォールバック（shell-update-applier.ts）は checkForUpdates までは
// 通すが、electron-updater は DL 開始時に app-update.yml（updaterCacheDirName）をもう一度読むので
// ENOENT で更新が止まる（オーナー実機 2026-09-13・0.1.63 ローカルビルド → 0.1.64）。
//
// 本フックは electron-builder 自身が書かないターゲット構成（--dir 等）のときだけ、
// scripts/release/gen-app-update-yml.mjs（release.yml build-win と同じ生成器・electron-builder
// 生成物とバイト等価）で書く。electron-builder が書く構成（CI の `--mac zip dmg` 等）では
// 何もしない — app-builder-lib の AsyncEventEmitter は "system" リスナー（PublishManager）を
// 先に、"user" リスナー（本フック）を後に走らせるので、無条件に書くと正規の生成物
// （将来 Windows 署名を有効にしたときの publisherName 等）を上書きしてしまう（Codex レビュー指摘）。
// afterPack は doSignAfterPack より前に走るため、書いたファイルは署名の封印に含まれる。
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');
const GENERATOR_PATH = path.join(repoRoot, 'scripts', 'release', 'gen-app-update-yml.mjs');
const APP_UPDATE_YML = 'app-update.yml';

/** app-builder-lib PublishManager.isSuitableWindowsTarget と同じ定義。 */
function isSuitableWindowsTarget(target) {
  if (target.name === 'appx' && target.options != null && target.options.electronUpdaterAware) {
    return true;
  }
  return target.name === 'nsis' || target.name.startsWith('nsis-');
}

/**
 * electron-builder 自身が app-update.yml を書く構成か（PublishManager.onAfterPack の gate と同じ）。
 * true なら本フックは何もしない（正規の生成物を上書きしない）。
 */
function electronBuilderWritesAppUpdateYml(electronPlatformName, targets) {
  const list = Array.isArray(targets) ? targets : [];
  if (electronPlatformName === 'darwin') {
    return list.some(it => it.name === 'dmg' || it.name === 'zip');
  }
  if (electronPlatformName === 'win32') {
    return list.some(isSuitableWindowsTarget);
  }
  return false;
}

/** electron-updater を同梱する platform（darwin / win32）で、かつ electron-builder が書かない構成のときだけ書く。 */
function shouldWriteAppUpdateYml(electronPlatformName, targets) {
  if (electronPlatformName !== 'darwin' && electronPlatformName !== 'win32') {
    return false;
  }
  return !electronBuilderWritesAppUpdateYml(electronPlatformName, targets);
}

async function afterPack(context) {
  if (!shouldWriteAppUpdateYml(context.electronPlatformName, context.targets)) {
    return;
  }
  const { writeAppUpdateYml } = await import(pathToFileURL(GENERATOR_PATH).href);
  const resourcesDir = context.packager.getResourcesDir(context.appOutDir);
  await writeAppUpdateYml(path.join(resourcesDir, APP_UPDATE_YML), { repoRoot });
}

module.exports = afterPack;
module.exports.afterPack = afterPack;
module.exports.shouldWriteAppUpdateYml = shouldWriteAppUpdateYml;
module.exports.electronBuilderWritesAppUpdateYml = electronBuilderWritesAppUpdateYml;
