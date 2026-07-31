import { chmod, copyFile, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// task/2026-07-31-shell-ffmpeg-bundle → task/2026-08-01-gpl-only-ffmpeg-swap: PATH に
// ffmpeg/ffprobe が無い環境（brew 未導入のさらの PC 等）でもプロキシ生成・書き出しが動くよう、
// packages/media-bin がピン留めした GPL-only・真ネイティブビルド（binary-manifest.mjs 参照。
// ffmpeg-static/ffprobe-static は --enable-nonfree ビルドかつ darwin/arm64 の ffprobe が
// x86_64 実体だったため撤去）の実バイナリを prepackage 時に resources/vendor-ffmpeg/ へ
// コピーし、electron-builder の extraResources で Contents/Resources/media-bin/**
// （win/linux は resources/media-bin/**）へ同梱する。
//
// app.asar の中へは入れない（extraResources は asar の外側に置かれる）。ffmpeg/ffprobe は
// 別プロセスとして spawn する実行ファイルであり、asar 内に置くと child_process.spawn が
// asar 仮想 FS を解決できず失敗する（本リポの @vscode/ripgrep と同じ問題 —
// patch-ripgrep-asar-path.mjs 冒頭コメント参照）。extraResources 配置ならこの問題を
// 構造的に回避できるため、asarUnpack 側の追加設定は不要。
//
// packages/media-bin は apps/shell の npm 依存グラフに入れていない（apps/shell は
// `npm install --no-workspaces` で単独インストールされ、workspace 越しの npm 依存解決が
// 効かない構成のため — 過去タスクの申し送り §0-1 参照）。相対 import は node_modules を
// 経由しないただのファイルパス解決なので、この制約と無関係に機能する
// （packages/*/src/*.mjs が media-bin を相互参照するのと同じ相対 import の流儀）。

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const shellRoot = path.resolve(scriptDir, '../..');
const outDir = path.join(shellRoot, 'resources', 'vendor-ffmpeg');

const { ensureVendorBinaries } = await import('../../../../packages/media-bin/scripts/fetch-binaries.mjs');

const result = await ensureVendorBinaries({ log: msg => console.log(msg) }).catch(error => {
  console.error(`BUNDLE-FFMPEG FAILED — 同梱バイナリの取得に失敗しました。\n${error.message}`);
  process.exit(1);
});

if (result.supported === false || !result.ffmpeg || !result.ffprobe) {
  console.error(
    `BUNDLE-FFMPEG FAILED — ${process.platform}-${process.arch} 向けの取得先ピン留めが ` +
    'packages/media-bin/src/binary-manifest.mjs にありません。'
  );
  process.exit(1);
}

for (const [label, source] of [['ffmpeg', result.ffmpeg], ['ffprobe', result.ffprobe]]) {
  if (!existsSync(source)) {
    console.error(`BUNDLE-FFMPEG FAILED — ${label} のバイナリが実在しません: ${source}`);
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
  console.log(`BUNDLE-FFMPEG: ${path.relative(shellRoot, source)} -> ${path.relative(shellRoot, destination)}`);
}

console.log(
  `BUNDLE-FFMPEG DONE: ${process.platform}-${process.arch} 向け ffmpeg/ffprobe を ` +
  `${path.relative(shellRoot, outDir)} に同梱（extraResources で Resources/media-bin/** へ配置される）`
);
