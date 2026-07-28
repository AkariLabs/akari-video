import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const shellRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const target = path.join(shellRoot, 'lib', 'backend', 'main.js');

// @theia/bundle-plugin（pin 1.73.1 の esbuild-plugin.js）は @vscode/ripgrep モジュールを
//   require("path").join(__dirname, `./native/rg${process.platform === "win32" ? ".exe" : ""}`)
// という素の結合シムへ差し替える（バンドル時に rg 実体は lib/backend/native/ へコピー）。
// パッケージ版では lib/ が app.asar 内に入るため、素結合のままだと rgPath が asar 内を
// 指し、child_process.spawn が失敗する（Electron は require の asar → asar.unpacked
// リダイレクトはするが spawn はしない。win 実機 ENOENT = issue #5 / mac 実測 ENOTDIR）。
// 元の @vscode/ripgrep が持つ asar → asar.unpacked 置換をここで生成物へ復元する。
//
// ビルド設定側（esbuild.mjs / gen-esbuild.*.mjs）で対処しないのは、それらが theia build の
// 再生成する gitignore 済みファイルで、変更を追跡できないため。prepackage で生成物
// lib/backend/main.js に決定的なパッチを当てる（package フローは必ず prepackage を通る）。
//
// 縮退条件の明示（fail-loud）: シムのパターンが見つからず、かつパッチ済み痕跡も無い場合は
// exit 1 で package を止める。bundle-plugin の更新で emit 形が変われば黙って素通りせず
// ここで検知される（その際は下の SHIM_PATTERN を追随させること）。

const PATCHED_MARKER = 'app.asar.unpacked$1';
// minify の有無（空白・引用符の揺れ）を許容する。テンプレートリテラル部分は
// bundle-plugin が emit する固定文字列。
const SHIM_PATTERN = /require\((["'])path\1\)\s*\.\s*join\(\s*__dirname\s*,\s*`\.\/native\/rg\$\{process\.platform\s*===\s*(["'])win32\2\s*\?\s*(["'])\.exe\3\s*:\s*(["'])\4\}`\s*\)/g;

const source = await readFile(target, 'utf8');

if (source.includes(PATCHED_MARKER)) {
  console.log(`[patch-ripgrep-asar-path] 既にパッチ済み: ${path.relative(shellRoot, target)}`);
  process.exit(0);
}

const matches = source.match(SHIM_PATTERN);
if (!matches || matches.length === 0) {
  console.error(
    '[patch-ripgrep-asar-path] FAILED — rgPath シムが lib/backend/main.js に見つかりません。\n' +
    '@theia/bundle-plugin の emit 形が変わった可能性があります（esbuild-plugin.js の\n' +
    'onLoad(@vscode/ripgrep) を確認し、本スクリプトの SHIM_PATTERN を追随させること）。\n' +
    'このまま package すると rgPath が app.asar 内を指し、パッケージ版のファイル検索が\n' +
    '全プラットフォームで壊れる（issue #5）ため、ここで停止する。'
  );
  process.exit(1);
}

const patched = source.replace(
  SHIM_PATTERN,
  match => `(${match}).replace(/\\bapp\\.asar([\\\\/])/, "app.asar.unpacked$1")`
);
await writeFile(target, patched);
console.log(
  `[patch-ripgrep-asar-path] rgPath を asar.unpacked 対応へパッチ: ` +
  `${matches.length} 箇所（${path.relative(shellRoot, target)}）`
);
