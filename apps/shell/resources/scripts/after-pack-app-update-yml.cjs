'use strict';
// electron-builder の afterPack フック: パッケージ直後・署名前に Resources へ app-update.yml を書く。
//
// electron-builder（app-builder-lib PublishManager.onAfterPack）は darwin では targets に
// zip / dmg が含まれるときだけ app-update.yml を書くため、`npm run package`（= `electron-builder --dir`、
// オーナーのローカルビルド harness/scripts/owner-build.sh もこれ）で作った .app には入らない。
// main プロセスの feed URL フォールバック（shell-update-applier.ts）は checkForUpdates までは
// 通すが、electron-updater は DL 開始時に app-update.yml（updaterCacheDirName）をもう一度読むので
// ENOENT で更新が止まる（オーナー実機 2026-09-13・0.1.63 ローカルビルド → 0.1.64）。
//
// 本フックは scripts/release/gen-app-update-yml.mjs（release.yml build-win と同じ生成器・
// electron-builder 生成物とバイト等価）で書く。zip / dmg ターゲットのときは後段の
// PublishManager が同じ内容で上書きするだけなので CI の生成物は不変。afterPack は
// doSignAfterPack より前に走るため、書いたファイルは署名の封印に含まれる。
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');
const GENERATOR_PATH = path.join(repoRoot, 'scripts', 'release', 'gen-app-update-yml.mjs');
const APP_UPDATE_YML = 'app-update.yml';

/** electron-updater を同梱する platform だけ対象（linux 配布物は無い）。 */
function shouldWriteAppUpdateYml(electronPlatformName) {
  return electronPlatformName === 'darwin' || electronPlatformName === 'win32';
}

async function afterPack(context) {
  if (!shouldWriteAppUpdateYml(context.electronPlatformName)) {
    return;
  }
  const { writeAppUpdateYml } = await import(pathToFileURL(GENERATOR_PATH).href);
  const resourcesDir = context.packager.getResourcesDir(context.appOutDir);
  await writeAppUpdateYml(path.join(resourcesDir, APP_UPDATE_YML), { repoRoot });
}

module.exports = afterPack;
module.exports.afterPack = afterPack;
module.exports.shouldWriteAppUpdateYml = shouldWriteAppUpdateYml;
