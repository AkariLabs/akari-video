import { chmod, copyFile, mkdir, readdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// task/2026-07-31-shell-ffmpeg-bundle → task/2026-08-01-gpl-only-ffmpeg-swap →
// task/2026-08-17-media-bin-whisper（ffmpeg 専用スクリプトから改名: bundle-ffmpeg-binaries.mjs
// → bundle-media-binaries.mjs）: PATH に ffmpeg/ffprobe/whisper-cli が無い環境（brew 未導入の
// さらの PC 等）でもプロキシ生成・書き出し・文字起こしが動くよう、packages/media-bin が
// ピン留めした GPL-only・真ネイティブビルド（ffmpeg/ffprobe。binary-manifest.mjs 参照。
// ffmpeg-static/ffprobe-static は --enable-nonfree ビルドかつ darwin/arm64 の ffprobe が
// x86_64 実体だったため撤去）と whisper.cpp の whisper-cli（MIT。win32 は公式リリース zip、
// macOS は release CI の cmake ソースビルド — build-whisper.mjs）の実バイナリを prepackage 時に
// resources/vendor-ffmpeg/ へコピーし、electron-builder の extraResources で
// Contents/Resources/media-bin/**（win/linux は resources/media-bin/**）へ同梱する。
// ディレクトリ名 resources/vendor-ffmpeg は歴史的名称のまま維持する（extraResources の
// from/to 規約を壊さないため — apps/shell/package.json 側は変更しない）。
//
// app.asar の中へは入れない（extraResources は asar の外側に置かれる）。ffmpeg/ffprobe/
// whisper-cli は別プロセスとして spawn する実行ファイルであり、asar 内に置くと
// child_process.spawn が asar 仮想 FS を解決できず失敗する（本リポの @vscode/ripgrep と
// 同じ問題 — patch-ripgrep-asar-path.mjs 冒頭コメント参照）。extraResources 配置ならこの
// 問題を構造的に回避できるため、asarUnpack 側の追加設定は不要。
//
// packages/media-bin は apps/shell の npm 依存グラフに入れていない（apps/shell は
// `npm install --no-workspaces` で単独インストールされ、workspace 越しの npm 依存解決が
// 効かない構成のため — 過去タスクの申し送り §0-1 参照）。相対 import は node_modules を
// 経由しないただのファイルパス解決なので、この制約と無関係に機能する
// （packages/*/src/*.mjs が media-bin を相互参照するのと同じ相対 import の流儀）。
//
// whisper-cli は ffmpeg/ffprobe と違い「必須」ではなく best-effort で同梱する:
// - win32-x64 は ensureVendorBinaries() が manifest 経由で fetch する（ffmpeg と同格の
//   sha256 検証済み・失敗すれば ensureVendorBinaries 自体が例外を投げるので下の
//   ffmpeg/ffprobe 必須チェックと同じ強制力になる）
// - darwin-*（macOS）は fetch 経路が無く、release.yml の build-mac ジョブが prepackage より
//   前に `npm run build:whisper`（build-whisper.mjs、cmake ソースビルド）を実行して
//   vendor に置いておく前提。ローカル開発機に cmake が無い場合は vendor に whisper-cli が
//   無いままになるため、その場合は「無ければ同梱しない」で prepackage 自体は落とさない
//   （ffmpeg 取得と同じベストエフォート精神 — 文字起こし機能が使えないだけで他機能は動く）

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const shellRoot = path.resolve(scriptDir, '../..');
const outDir = path.join(shellRoot, 'resources', 'vendor-ffmpeg');

const { ensureVendorBinaries } = await import('../../../../packages/media-bin/scripts/fetch-binaries.mjs');
const { vendorBinaryPath, currentTarget } = await import('../../../../packages/media-bin/src/binary-manifest.mjs');

const result = await ensureVendorBinaries({ log: msg => console.log(msg) }).catch(error => {
  console.error(`BUNDLE-MEDIA-BIN FAILED — ffmpeg/ffprobe 同梱バイナリの取得に失敗しました。\n${error.message}`);
  process.exit(1);
});

if (result.supported === false || !result.ffmpeg || !result.ffprobe) {
  console.error(
    `BUNDLE-MEDIA-BIN FAILED — ${process.platform}-${process.arch} 向けの取得先ピン留めが ` +
    'packages/media-bin/src/binary-manifest.mjs にありません。'
  );
  process.exit(1);
}

for (const [label, source] of [['ffmpeg', result.ffmpeg], ['ffprobe', result.ffprobe]]) {
  if (!existsSync(source)) {
    console.error(`BUNDLE-MEDIA-BIN FAILED — ${label} のバイナリが実在しません: ${source}`);
    process.exit(1);
  }
}

const ffmpegSource = result.ffmpeg;
const ffprobeSource = result.ffprobe;

const exeName = name => (process.platform === 'win32' ? `${name}.exe` : name);

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

for (const [source, name] of [[ffmpegSource, 'ffmpeg'], [ffprobeSource, 'ffprobe']]) {
  const destination = path.join(outDir, exeName(name));
  await copyFile(source, destination);
  await chmod(destination, 0o755);
  console.log(`BUNDLE-MEDIA-BIN: ${path.relative(shellRoot, source)} -> ${path.relative(shellRoot, destination)}`);
}

// whisper-cli は vendor/<target>/ に実在すれば同梱する（best-effort — 存在確認は
// ensureVendorBinaries() の戻り値ではなく実ファイルで行う。darwin は result に
// whisper-cli キー自体が無いため — manifest の win32-x64 にしか whisper-cli エントリが無い）。
const target = currentTarget();
const whisperSource = vendorBinaryPath('whisper-cli', target);
if (existsSync(whisperSource)) {
  const whisperDestination = path.join(outDir, exeName('whisper-cli'));
  await copyFile(whisperSource, whisperDestination);
  await chmod(whisperDestination, 0o755);
  console.log(
    `BUNDLE-MEDIA-BIN: ${path.relative(shellRoot, whisperSource)} -> ${path.relative(shellRoot, whisperDestination)}`
  );

  // whisper-cli の隣に実行時依存の companion ファイル（win32 の DLL 群、万一の dylib）が
  // あればそのまま同じ階層へ複製する。vendor 側のディレクトリ構成が同梱物の完全な集合
  // （fetch-binaries.mjs の extraMembers / build-whisper.mjs の dylib 保険）なので、
  // whisper-cli 以外の兄弟ファイルを機械的に列挙すれば過不足なく拾える。
  const vendorDir = path.dirname(whisperSource);
  const siblings = await readdir(vendorDir, { withFileTypes: true });
  const whisperBaseName = path.basename(whisperSource);
  const companionExtensions = new Set(['.dll', '.dylib', '.so']);
  for (const sibling of siblings) {
    if (!sibling.isFile() || sibling.name === whisperBaseName) continue;
    if (!companionExtensions.has(path.extname(sibling.name))) continue;
    const companionSource = path.join(vendorDir, sibling.name);
    const companionDestination = path.join(outDir, sibling.name);
    await copyFile(companionSource, companionDestination);
    console.log(
      `BUNDLE-MEDIA-BIN: ${path.relative(shellRoot, companionSource)} (companion) -> ` +
      `${path.relative(shellRoot, companionDestination)}`
    );
  }
} else {
  console.log(
    `BUNDLE-MEDIA-BIN: whisper-cli が vendor/${target}/ に見つからないため同梱しません` +
    '（win32-x64 は npm install の postinstall で取得済みのはず、macOS は事前に ' +
    '`npm run build:whisper`（packages/media-bin, cmake 必須）の実行が必要です）。'
  );
}

console.log(
  `BUNDLE-MEDIA-BIN DONE: ${process.platform}-${process.arch} 向け ffmpeg/ffprobe` +
  `${existsSync(whisperSource) ? '/whisper-cli' : ''} を ` +
  `${path.relative(shellRoot, outDir)} に同梱（extraResources で Resources/media-bin/** へ配置される）`
);
