#!/usr/bin/env node
// latest.json ジェネレータ — 更新フィードのスキーマを成果物ディレクトリから機械生成する。
// スキーマ契約は非公開の内部リポジトリ akari-video-internal 側で管理している。
// 「生成は手書き禁止・リリースワークフロー内のジェネレータのみ（Generated Wiki 扱い）」の実体。
//
// Date.now() は直書きしない（決定論を保つため released は必須引数）。
//
// 使い方:
//   node scripts/release/gen-latest-json.mjs \
//     --artifacts-dir <dir> --tag v0.1.0 --channel prerelease \
//     --released 2026-07-27T00:00:00+09:00 [--out latest.json] [--repo-root <dir>]
//
// <dir> には release.yml が固定名の ZIP 等（ARTIFACT_FILES 参照）と版付き名の DMG を配置する。
// ZIP は electron-builder の固定名を維持し、DMG は実ファイル名を使う（任意・最大 1 個）。
// npm pack 等の成果物はワークフロー側で固定名へ配置する。latest.json の url は
// GitHub Release のダウンロード URL 規則
// （https://github.com/<repo>/releases/download/<tag>/<filename>）から組み立てる。
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const defaultRepoRoot = join(here, '..', '..');

const SCHEMA_VERSION = 1;
const REPO_SLUG = 'AkariLabs/akari-video';
const TAG_RE = /^v\d+\.\d+\.\d+$/;
const CHANNELS = new Set(['prerelease', 'stable']);

export const ARTIFACT_FILES = {
  shellMac: 'shell-mac.zip',
  shellWin: 'shell-win.zip',
  shellWinSetup: 'shell-win-setup.exe',
  cli: 'cli.tgz',
  // フル構成ソース tarball（install.sh が展開するものと同内容 = タグのソースツリー）。
  // CLI self-update（update-and-versioning 契約 §11）が DL する実体。
  // 既存の cli.tgz（npm パッケージのサブセット・preview-server 非同梱）とは別物。
  app: 'app.tgz'
};

function sha256File(path) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(path);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

function releaseAssetUrl(tag, filename) {
  return `https://github.com/${REPO_SLUG}/releases/download/${tag}/${filename}`;
}

export function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case '--artifacts-dir':
        args.artifactsDir = argv[++i];
        break;
      case '--tag':
        args.tag = argv[++i];
        break;
      case '--channel':
        args.channel = argv[++i];
        break;
      case '--released':
        args.released = argv[++i];
        break;
      case '--out':
        args.out = argv[++i];
        break;
      case '--repo-root':
        args.repoRoot = argv[++i];
        break;
      default:
        throw new Error(`未知の引数: ${arg}`);
    }
  }
  return args;
}

// 戻り値: latest.json の中身（オブジェクト）
export async function generateLatestJson({ artifactsDir, tag, channel, released, repoRoot = defaultRepoRoot }) {
  if (!artifactsDir) throw new Error('--artifacts-dir は必須です');
  if (typeof tag !== 'string' || !TAG_RE.test(tag)) {
    throw new Error(`--tag の形式が不正です（vX.Y.Z で指定してください）: ${tag}`);
  }
  if (!CHANNELS.has(channel)) {
    throw new Error(`--channel は prerelease か stable のいずれかで指定してください: ${channel}`);
  }
  if (!released || Number.isNaN(Date.parse(released))) {
    throw new Error(`--released は ISO8601 の日時で指定してください（Date.now() 由来の直書きは禁止）: ${released}`);
  }

  const productVersion = tag.slice(1);

  const [shellPkg, cliPkg, pluginPkg] = await Promise.all([
    readFile(join(repoRoot, 'apps/shell/package.json'), 'utf8').then(JSON.parse),
    readFile(join(repoRoot, 'packages/akari-launcher/package.json'), 'utf8').then(JSON.parse),
    readFile(join(repoRoot, 'plugin/.claude-plugin/plugin.json'), 'utf8').then(JSON.parse)
  ]);

  const dmgFiles = (await readdir(artifactsDir, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith('.dmg'))
    .map((entry) => entry.name);
  if (dmgFiles.length > 1) {
    throw new Error(`DMG 成果物は最大 1 個です（検出: ${dmgFiles.length}）`);
  }
  const macDmg = dmgFiles.length === 1
    ? { url: releaseAssetUrl(tag, dmgFiles[0]), sha256: await sha256File(join(artifactsDir, dmgFiles[0])) }
    : undefined;

  const shellMacPath = join(artifactsDir, ARTIFACT_FILES.shellMac);
  const shellWinPath = join(artifactsDir, ARTIFACT_FILES.shellWin);
  const shellWinSetupPath = join(artifactsDir, ARTIFACT_FILES.shellWinSetup);
  const cliPath = join(artifactsDir, ARTIFACT_FILES.cli);
  const appPath = join(artifactsDir, ARTIFACT_FILES.app);

  const [shellMacSha, shellWinSha, shellWinSetupSha, cliSha, appSha] = await Promise.all([
    sha256File(shellMacPath),
    sha256File(shellWinPath),
    sha256File(shellWinSetupPath),
    sha256File(cliPath),
    sha256File(appPath)
  ]);

  return {
    schema: SCHEMA_VERSION,
    product: productVersion,
    channel,
    released,
    notes_url: `https://github.com/${REPO_SLUG}/releases/tag/${tag}`,
    components: {
      shell: {
        version: shellPkg.version,
        mac: { url: releaseAssetUrl(tag, ARTIFACT_FILES.shellMac), sha256: shellMacSha },
        ...(macDmg ? { mac_dmg: macDmg } : {}),
        // 契約 §3 の例示どおり win の正はインストーラ（...exe）。ポータブル zip は
        // win_zip として併記する（後方互換の追加のみ → schema は 1 のまま）
        win: { url: releaseAssetUrl(tag, ARTIFACT_FILES.shellWinSetup), sha256: shellWinSetupSha },
        win_zip: { url: releaseAssetUrl(tag, ARTIFACT_FILES.shellWin), sha256: shellWinSha }
      },
      cli: {
        version: cliPkg.version,
        npm: cliPkg.name,
        tarball: { url: releaseAssetUrl(tag, ARTIFACT_FILES.cli), sha256: cliSha }
      },
      plugin: { version: pluginPkg.version },
      // update-and-versioning 契約（内部リポ）§11 追記: install.sh が展開するものと同内容の
      // フル構成ソース tarball（CLI self-update の実体）。additive 追加のため schema は 1 のまま。
      app: { version: productVersion, url: releaseAssetUrl(tag, ARTIFACT_FILES.app), sha256: appSha }
    }
  };
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`エラー: ${error.message}`);
    process.exitCode = 1;
    return;
  }

  try {
    const latest = await generateLatestJson(args);
    const json = `${JSON.stringify(latest, null, 2)}\n`;
    process.stdout.write(json);
    if (args.out) {
      await writeFile(args.out, json, 'utf8');
    }
  } catch (error) {
    console.error(`エラー: ${error.message}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && await realpath(fileURLToPath(import.meta.url)) === await realpath(process.argv[1])) {
  await main();
}
