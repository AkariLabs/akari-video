import { chmod, copyFile, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

// task/2026-07-31-shell-ffmpeg-bundle: PATH に ffmpeg/ffprobe が無い環境（brew 未導入の
// さらの PC 等）でもプロキシ生成・書き出しが動くよう、① (task/2026-07-31-ffmpeg-resolver)
// と同じ ffmpeg-static@5.3.0 / ffprobe-static@3.1.0（packages/media-bin の依存）の実バイナリを
// prepackage 時に resources/vendor-ffmpeg/ へコピーし、electron-builder の extraResources で
// Contents/Resources/media-bin/**（win/linux は resources/media-bin/**）へ同梱する。
//
// app.asar の中へは入れない（extraResources は asar の外側に置かれる）。ffmpeg-static は
// 別プロセスとして spawn する実行ファイルであり、asar 内に置くと child_process.spawn が
// asar 仮想 FS を解決できず失敗する（本リポの @vscode/ripgrep と同じ問題 —
// patch-ripgrep-asar-path.mjs 冒頭コメント参照）。extraResources 配置ならこの問題を
// 構造的に回避できるため、asarUnpack 側の追加設定は不要。
//
// require() は Node の通常のモジュール解決規則で apps/shell → リポ直下の node_modules まで
// 自動的に遡る。copy-native-helpers.mjs が node-pty の spawn-helper 向けに実装している
// 「apps/shell とリポ直下の両方を明示的に探す」という hoisting 対応は、あちらが
// path.join によるディレクトリ直参照だからこそ必要なもので、require ベースの本スクリプトには
// 不要（Node が自動でやってくれる）。

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const shellRoot = path.resolve(scriptDir, '../..');
const outDir = path.join(shellRoot, 'resources', 'vendor-ffmpeg');
const require = createRequire(import.meta.url);

function resolveBinary(packageName, pick) {
  let mod;
  try {
    mod = require(packageName);
  } catch (error) {
    console.error(
      `BUNDLE-FFMPEG FAILED — ${packageName} を require できません（node_modules に見つからない）。\n` +
      'packages/media-bin の依存としてインストール済みか確認してください（リポ root で npm install）。\n' +
      String(error instanceof Error ? error.message : error)
    );
    process.exit(1);
  }
  const resolved = pick(mod);
  if (typeof resolved !== 'string' || resolved.length === 0 || !existsSync(resolved)) {
    console.error(`BUNDLE-FFMPEG FAILED — ${packageName} のバイナリが実在しません: ${resolved}`);
    process.exit(1);
  }
  return resolved;
}

const ffmpegSource = resolveBinary('ffmpeg-static', mod => mod);
const ffprobeSource = resolveBinary('ffprobe-static', mod => mod?.path);

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
