#!/usr/bin/env node
// apps/shell/scripts/resign-electron.mjs
//
// @theia/ffmpeg（theia build 内部の prepareElectron()）は node_modules/electron/dist/
// Electron.app 内の libffmpeg.dylib を非プロプライエタリ版へ差し替える。署名済みバンドルの
// 中身を書き換えるためコード署名が壊れ、Apple Silicon では署名不正の .app が起動時に
// 無言で kill される（"Electron main: loading modules..." の直後に exit 0。実測ログは
// 内部リポ planning/notes-2026-08-17-mac-fresh-install-bug-reports.md #03）。
// `npm rebuild electron` 後に theia build を再実行した場合も同じ壊れ方が再発する。
//
// この開発ビルド専用（node_modules/electron/dist）のアドホック再署名は無害・冪等なので、
// build 完了直後（postbuild）と install 完了直後（postinstall）の両方から呼ぶ。
// electron-builder の正規パッケージング署名（npm run package / prepackage）は別経路で
// 完全に独立しており、本スクリプトは一切触れない。

import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TAG = '[resign-electron]';
const shellRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const electronAppPath = path.join(shellRoot, 'node_modules', 'electron', 'dist', 'Electron.app');

if (process.platform !== 'darwin') {
  console.log(`${TAG} platform=${process.platform}: darwin 専用のステップのため no-op`);
  process.exit(0);
}

if (!existsSync(electronAppPath)) {
  console.log(
    `${TAG} ${path.relative(shellRoot, electronAppPath)} が見つかりません` +
    '（electron devDependency 未インストールの可能性）— スキップ'
  );
  process.exit(0);
}

const result = spawnSync('codesign', ['--force', '--deep', '--sign', '-', electronAppPath], {
  stdio: 'inherit'
});

if (result.error) {
  console.error(`${TAG} FAILED — codesign コマンドを起動できませんでした: ${result.error.message}`);
  console.error(`${TAG} Xcode Command Line Tools（xcode-select --install）が入っているか確認してください`);
  process.exit(1);
}

if (result.status !== 0) {
  console.error(`${TAG} FAILED — codesign がステータス ${result.status} で終了しました`);
  console.error(
    `${TAG} 手動での回避策: codesign --force --deep --sign - ` +
    `${path.relative(process.cwd(), electronAppPath)}`
  );
  process.exit(result.status ?? 1);
}

console.log(
  `${TAG} OK — ${path.relative(shellRoot, electronAppPath)} をアドホック再署名しました` +
  '（@theia/ffmpeg の libffmpeg 差し替えで壊れた署名の自己修復 / 開発ビルド専用）'
);
