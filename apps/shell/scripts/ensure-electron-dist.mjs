#!/usr/bin/env node
// apps/shell/scripts/ensure-electron-dist.mjs
//
// node_modules/electron/dist/ と path.txt を「必ず完成した状態」にする自己修復ステップ。
//
// なぜ要るか（2026-08-19 実測 / task 2026-08-19-shell-webpack-pin）:
//   electron の postinstall（node_modules/electron/install.js）は zip 展開に
//   extract-zip 2.0.1 → yauzl 2.10 → fd-slicer 1.1 を使う。この経路は
//   **Node 24 以降（実測は v26.3.0）で大きなエントリの途中で無言停止する**。
//   fd-slicer の Readable が pipe のバックプレッシャー解除後に再開されず、
//   1,900,544 B（64KiB × 29 チャンク）でイベントループが空になり、
//   'end' も 'error' も出ないまま install.js が **exit 0 で終わる**。
//   結果 dist/ には LICENSE と切り詰められた LICENSES.chromium.html だけが残り、
//   Electron.app も dist/version も path.txt も無い状態で「成功」扱いになる。
//   （Node 22.23.1 では同じ zip が完走することを実測。zlib 単体・fd-slicer 単体も正常で、
//     pipe（バックプレッシャー）経路だけが停まる）
//   npm の allow-scripts ゲートでスキップされた場合も、結果は同じ「dist が無い」状態になる。
//
// このスクリプトは **原因を問わず結果だけを見る**: dist が健全なら何もしない。
// 壊れている / 無いなら、zip を（@electron/get のキャッシュ経由で）取り直し、
// Node の zip 実装を通さない OS 側の展開ツールで展開して path.txt まで書く。
//
//   darwin : ditto -x -k   （.app のシンボリックリンク・実行権限・拡張属性を保つ唯一の正解）
//   win32  : tar -xf       （Windows 10 1803+ 同梱の bsdtar。無ければ PowerShell Expand-Archive）
//   linux  : unzip -q -o   （無ければ bsdtar）
//
// ELECTRON_SKIP_BINARY_DOWNLOAD=1 で丸ごと無効化できる（electron 本家と同じ環境変数）。
// CI の L0 レーンは --ignore-scripts なのでそもそも呼ばれない。

import { existsSync, readFileSync, writeFileSync, rmSync, mkdirSync, renameSync, chmodSync } from 'node:fs';
import { spawnSync, execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const TAG = '[ensure-electron-dist]';
const shellRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const electronDir = path.join(shellRoot, 'node_modules', 'electron');
const distDir = process.env.ELECTRON_OVERRIDE_DIST_PATH || path.join(electronDir, 'dist');
const pathTxt = path.join(electronDir, 'path.txt');

const rel = (p) => path.relative(shellRoot, p);

if (process.env.ELECTRON_SKIP_BINARY_DOWNLOAD) {
  console.log(`${TAG} ELECTRON_SKIP_BINARY_DOWNLOAD が設定されています — スキップ`);
  process.exit(0);
}

if (!existsSync(path.join(electronDir, 'package.json'))) {
  console.log(`${TAG} ${rel(electronDir)} が見つかりません（electron devDependency 未インストール）— スキップ`);
  process.exit(0);
}

const version = JSON.parse(readFileSync(path.join(electronDir, 'package.json'), 'utf8')).version;

/** electron/install.js の getPlatformPath() と同一の対応表 */
function platformPath(platform) {
  switch (platform) {
    case 'mas':
    case 'darwin':
      return 'Electron.app/Contents/MacOS/Electron';
    case 'freebsd':
    case 'openbsd':
    case 'linux':
      return 'electron';
    case 'win32':
      return 'electron.exe';
    default:
      throw new Error(`Electron builds are not available on platform: ${platform}`);
  }
}

const targetPlatform = process.env.npm_config_platform || os.platform();

/** electron/install.js と同じ Rosetta 判定（x64 Node が arm64 Mac で動いている場合） */
function targetArch() {
  let arch = process.env.npm_config_arch || process.arch;
  if (targetPlatform === 'darwin' && process.platform === 'darwin' && arch === 'x64'
      && process.env.npm_config_arch === undefined) {
    try {
      if (execSync('sysctl -in sysctl.proc_translated').toString().trim() === '1') {
        arch = 'arm64';
      }
    } catch {
      // 判定できなければそのまま
    }
  }
  return arch;
}

const relPath = platformPath(targetPlatform);

/** electron/install.js の isInstalled() と同じ判定 */
function isHealthy() {
  try {
    if (readFileSync(path.join(distDir, 'version'), 'utf8').replace(/^v/, '') !== version) {
      return false;
    }
    if (readFileSync(pathTxt, 'utf8') !== relPath) {
      return false;
    }
  } catch {
    return false;
  }
  return existsSync(path.join(distDir, relPath));
}

if (isHealthy()) {
  console.log(`${TAG} OK — ${rel(distDir)} は electron ${version} で完成済み（何もしません）`);
  process.exit(0);
}

console.log(`${TAG} ${rel(distDir)} が未完成です（electron ${version} / ${targetPlatform}-${targetArch()}）— 展開し直します`);

// ── 1. zip を取得（キャッシュにあればダウンロードは走らない。checksum は @electron/get が検証する）
let zipPath;
try {
  const requireFromElectron = createRequire(path.join(electronDir, 'package.json'));
  const { downloadArtifact } = requireFromElectron('@electron/get');
  const checksums = process.env.electron_use_remote_checksums || process.env.npm_config_electron_use_remote_checksums
    ? undefined
    : requireFromElectron('./checksums.json');
  zipPath = await downloadArtifact({
    version,
    artifactName: 'electron',
    force: process.env.force_no_cache === 'true',
    cacheRoot: process.env.electron_config_cache,
    checksums,
    platform: targetPlatform,
    arch: targetArch()
  });
} catch (err) {
  console.error(`${TAG} FAILED — electron ${version} の zip を取得できませんでした: ${err.message}`);
  console.error(`${TAG} ネットワーク不通なら、疎通後に \`npm run preflight\` で再試行できます`);
  process.exit(1);
}

console.log(`${TAG} zip: ${zipPath}`);

// ── 2. 壊れた途中結果を捨ててから展開（Node の zip 実装は通さない）
rmSync(distDir, { recursive: true, force: true });
mkdirSync(distDir, { recursive: true });

const extractors = {
  darwin: [['ditto', ['-x', '-k', zipPath, distDir]]],
  win32: [
    ['tar', ['-xf', zipPath, '-C', distDir]],
    ['powershell', ['-NoProfile', '-NonInteractive', '-Command',
      `Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${distDir}' -Force`]]
  ]
};
const candidates = extractors[process.platform] ?? [
  ['unzip', ['-q', '-o', zipPath, '-d', distDir]],
  ['bsdtar', ['-xf', zipPath, '-C', distDir]]
];

let extracted = false;
const failures = [];
for (const [cmd, args] of candidates) {
  const res = spawnSync(cmd, args, { stdio: 'inherit' });
  if (!res.error && res.status === 0) {
    console.log(`${TAG} ${cmd} で展開しました`);
    extracted = true;
    break;
  }
  failures.push(`${cmd}: ${res.error ? res.error.message : `exit ${res.status}`}`);
}

if (!extracted) {
  console.error(`${TAG} FAILED — zip を展開できませんでした:`);
  for (const f of failures) console.error(`${TAG}   ${f}`);
  process.exit(1);
}

// ── 3. electron 本家の install.js と同じ後処理（型定義の引き上げ + path.txt）
const distTypeDef = path.join(distDir, 'electron.d.ts');
if (existsSync(distTypeDef)) {
  renameSync(distTypeDef, path.join(electronDir, 'electron.d.ts'));
}
writeFileSync(pathTxt, relPath);

if (process.platform !== 'win32') {
  try {
    chmodSync(path.join(distDir, relPath), 0o755);
  } catch {
    // ditto / unzip が権限を保っていれば不要
  }
}

// ── 4. 検証（黙って壊れたまま進ませない）
if (!isHealthy()) {
  console.error(`${TAG} FAILED — 展開後も ${rel(distDir)} が不完全です`);
  console.error(`${TAG}   期待: ${path.join(rel(distDir), 'version')} = ${version} / ${rel(pathTxt)} = ${relPath}`);
  process.exit(1);
}

console.log(`${TAG} OK — ${rel(distDir)} に electron ${version} を展開し、path.txt を書きました`);
