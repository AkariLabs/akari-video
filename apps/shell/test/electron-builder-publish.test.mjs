// U3（シェル自動アップデート）の electron-builder 設定に対する静的検証。
//
// 内部リポ契約 update-and-versioning §11 の受け入れ条件「electron-builder 設定は
// --dry-run 相当の静的検証（config の schema / アセット名の不変をテストで固定）」の実体。
// 実際に electron-builder を走らせる L1 相当の検証はコストが高いため、ここでは
// package.json の build 設定だけを読み、(1) publish（GitHub provider）が正しく
// 設定されていること (2) mac/nsis の artifactName が gen-latest-json.mjs の
// ARTIFACT_FILES（読み取り専用・境界外編集禁止）が期待する固定名を実際に生成すること
// (3) release.yml のシェルビルドステップが --publish never を明示していること
// （意図しない実 publish 試行の防止）を機械的に固定する。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ARTIFACT_FILES } from '../../../scripts/release/gen-latest-json.mjs';

const shellRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(shellRoot, '..', '..');

async function readShellPackageJson() {
  return JSON.parse(await readFile(path.join(shellRoot, 'package.json'), 'utf8'));
}

async function readFallbackFeedOptions() {
  const source = await readFile(
    path.join(shellRoot, 'extensions/akari-surfaces/src/common/shell-update-applier.ts'),
    'utf8'
  );
  const block = source.match(/FALLBACK_FEED_OPTIONS\s*=\s*\{(?<body>[\s\S]*?)\}\s*as const;/)?.groups?.body;
  assert.ok(block, 'FALLBACK_FEED_OPTIONS 定数が見つからない');
  const field = (name) => block.match(new RegExp(`${name}:\\s*'([^']+)'`))?.[1];
  return { provider: field('provider'), owner: field('owner'), repo: field('repo') };
}

/** electron-builder のテンプレート置換を模した最小実装（`${ext}` のみこのテストで使う）。 */
function substituteArtifactName(template, ext) {
  return template.replace('${ext}', ext);
}

test('build.publish は GitHub provider（AkariLabs/akari-video）を指す（electron-updater が app-update.yml から読む契約）', async () => {
  const pkg = await readShellPackageJson();
  assert.deepEqual(pkg.build.publish, { provider: 'github', owner: 'AkariLabs', repo: 'akari-video' });
});

test('main の feed URL フォールバック定数は build.publish と一致する（drift ガード）', async () => {
  const pkg = await readShellPackageJson();
  assert.deepEqual(await readFallbackFeedOptions(), pkg.build.publish);
});

test('mac.artifactName は gen-latest-json.mjs の ARTIFACT_FILES.shellMac と一致する固定名を生成する（U3: リネーム後処理を無くす設計）', async () => {
  const pkg = await readShellPackageJson();
  assert.equal(substituteArtifactName(pkg.build.mac.artifactName, 'zip'), ARTIFACT_FILES.shellMac);
});

test('mac.artifactName は dmg 拡張子でも shell-mac.dmg を生成する（zip と dmg が衝突しない）', async () => {
  const pkg = await readShellPackageJson();
  assert.equal(substituteArtifactName(pkg.build.mac.artifactName, 'dmg'), 'shell-mac.dmg');
});

test('nsis.artifactName は gen-latest-json.mjs の ARTIFACT_FILES.shellWinSetup と一致する固定名を生成する', async () => {
  const pkg = await readShellPackageJson();
  assert.equal(substituteArtifactName(pkg.build.nsis.artifactName, 'exe'), ARTIFACT_FILES.shellWinSetup);
});

test('electron-updater は dependencies に含まれる（main プロセスへバンドルされる実行時依存）', async () => {
  const pkg = await readShellPackageJson();
  assert.ok(pkg.dependencies['electron-updater'], 'electron-updater が dependencies に無い');
});

test('release.yml の ARTIFACT_MAC / ARTIFACT_WIN / ARTIFACT_WIN_SETUP は gen-latest-json.mjs の ARTIFACT_FILES と一致する（アセット名不変の固定）', async () => {
  const releaseYml = await readFile(path.join(repoRoot, '.github/workflows/release.yml'), 'utf8');
  assert.match(releaseYml, new RegExp(`ARTIFACT_MAC:\\s*${ARTIFACT_FILES.shellMac}\\s*$`, 'm'));
  assert.match(releaseYml, new RegExp(`ARTIFACT_WIN:\\s*${ARTIFACT_FILES.shellWin}\\s*$`, 'm'));
  assert.match(releaseYml, new RegExp(`ARTIFACT_WIN_SETUP:\\s*${ARTIFACT_FILES.shellWinSetup}\\s*$`, 'm'));
});

test('release.yml のシェルビルドステップは --publish never を明示している（CI からの意図しない実 publish 試行を防ぐ）', async () => {
  const releaseYml = await readFile(path.join(repoRoot, '.github/workflows/release.yml'), 'utf8');
  assert.match(releaseYml, /electron-builder --mac zip dmg --publish never/);
  assert.match(releaseYml, /electron-builder --win nsis --pd electron-builder-out\/win-unpacked --publish never/);
});

test('release.yml の build-win は package 後・Zip win-unpacked 前に app-update.yml を生成する', async () => {
  const releaseYml = await readFile(path.join(repoRoot, '.github/workflows/release.yml'), 'utf8');
  const buildWinStart = releaseYml.indexOf('\n  build-win:');
  assert.notEqual(buildWinStart, -1, 'build-win ジョブが見つからない');
  const buildWinHeadingEnd = buildWinStart + '\n  build-win:'.length;
  const nextJob = releaseYml.slice(buildWinHeadingEnd).match(/^  [a-z][a-z0-9-]*:\s*$/m);
  const buildWinEnd = nextJob
    ? buildWinHeadingEnd + nextJob.index
    : releaseYml.length;
  const buildWin = releaseYml.slice(buildWinStart, buildWinEnd);
  const packageStep = buildWin.indexOf('run: npm run package');
  const generateStep = buildWin.indexOf(
    'run: node scripts/release/gen-app-update-yml.mjs apps/shell/electron-builder-out/win-unpacked/resources/app-update.yml'
  );
  const zipStep = buildWin.indexOf('- name: Zip win-unpacked');

  assert.notEqual(packageStep, -1, 'build-win 内に package ステップが無い');
  assert.notEqual(generateStep, -1, 'build-win 内に gen-app-update-yml 呼び出しが無い');
  assert.notEqual(zipStep, -1, 'build-win 内に Zip win-unpacked ステップが無い');
  assert.ok(packageStep < generateStep, 'gen-app-update-yml は package より後でなければならない');
  assert.ok(generateStep < zipStep, 'gen-app-update-yml は Zip win-unpacked より前でなければならない');
});

test('release.yml は electron-updater メタデータ（latest-mac.yml / latest.yml）の存在確認を必須アセットとして課している', async () => {
  const releaseYml = await readFile(path.join(repoRoot, '.github/workflows/release.yml'), 'utf8');
  assert.match(releaseYml, /latest-mac\.yml が見つかりません/);
  assert.match(releaseYml, /latest\.yml が見つかりません/);
});
