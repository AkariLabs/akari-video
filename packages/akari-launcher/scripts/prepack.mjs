#!/usr/bin/env node
/**
 * prepack / postpack: npm 配布 tarball にモノレポ同梱物を vendor/ として焼き込む。
 *
 * - レイアウトはモノレポと同一ミラー（vendor/skills, vendor/templates/project-default,
 *   vendor/packages/schemas, vendor/packages/project-scaffold）。repo-assets.mjs が
 *   vendor/ を「もう一つのリポジトリルート」としてそのまま解決できるようにするため
 * - コピー対象は `git ls-files`（追跡ファイルのみ）で列挙する。開発 checkout には
 *   ローカルビルドの補助バイナリ（skills/analyze-footage/bin/ の helper 等）や
 *   node_modules / .DS_Store が実在するため、ディレクトリ丸ごとコピーだと配布物に
 *   混入する
 * - `.gitignore` はコピーしない。npm は tarball 生成時にこの名前のファイルを無条件に
 *   除外し、かつ .npmignore の無いディレクトリでは除外規則として解釈するため、残すと
 *   「本体が消えて周囲を巻き込む」だけになる。雛形の .gitignore はスキャフォールド時に
 *   project-scaffold の writeFallbackTemplate が同内容（PROJECT_GITIGNORE）を補完する
 * - LICENSE はリポジトリルートの正本をパッケージルートへコピーする（npm はパッケージ
 *   ルートの LICENSE を files 指定と無関係に同梱する）
 * - `clean`（postpack から呼ぶ）で vendor/ と LICENSE コピーを削除し、作業ツリーに
 *   生成物を残さない
 */
import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { discoverCheckoutCapabilitySources } from '../src/capability-sources.mjs';

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = path.resolve(PACKAGE_ROOT, '..', '..');
const VENDOR_ROOT = path.join(PACKAGE_ROOT, 'vendor');
const LICENSE_COPY = path.join(PACKAGE_ROOT, 'LICENSE');

const VENDOR_SOURCES = [
  'skills',
  'templates/project-default',
  'presets/luts',
  // edit-lint は外部 npm 依存ゼロだが、src から edit-store のビルド済み実装と
  // textanim preset を参照する。既に同梱済みの schemas / audio-library-setup /
  // media-bin と合わせ、CLI の実行時閉包を明示的に揃える。
  'presets/textanim',
  'assets/font/noto-sans-jp/NotoSansJP-Variable.ttf',
  'packages/schemas',
  'packages/project-scaffold',
  // analysis-report は package.json / README.md を capability source として既に収集する。
  // 実行に必要な CLI と同居必須テンプレートだけを追加し、test/ は配布しない。
  'packages/analysis-report/render-analysis-report.mjs',
  'packages/analysis-report/template.html',
  // decision-log-report も package.json / README.md は capability source として収集する。
  // 実行に必要な CLI と同居必須テンプレートだけを追加し、test/ は配布しない。
  'packages/decision-log-report/render-decision-log-report.mjs',
  'packages/decision-log-report/template.html',
  'packages/edit-lint/bin',
  'packages/edit-lint/src',
  'packages/edit-store/lib',
  // 作業場（creator-root）モジュール。npm 配布時も初回動線（first-run.mjs 経由の
  // 動的 import）が機能するよう同梱する。未同梱の場合は repo-assets.mjs 側で
  // creatorRootModulePath が null になり、現行動作へフォールバックする。
  'packages/creator-root',
  // 公式音源ライブラリ（AKARI Sounds）の一括取得（sounds-setup.mjs / `akari sounds`）。
  // media-bin は fetch スクリプトの preview.png 生成（waveform-preview.mjs）が ffmpeg 解決に
  // 使う。未同梱なら audioFetchScriptPath が null になり、音源セットアップだけスキップされる。
  'packages/audio-library-setup',
  'packages/media-bin',
  // 素材 resolver（`akari assets` — アカウントの素材 = 無料 + 購入済みの一覧・取得）。
  // 未同梱なら assetResolverCliPath が null になり、`akari assets` だけスキップされる
  // （タスク契約 2026-08-09-agent-assets-discovery）。
  'packages/asset-resolver',
  // 履歴に何を入れるかの宣言（history-policy.mjs）。project-scaffold が相対パスで参照するため、
  // vendor ミラーにもモノレポと同じ深さで置く（`vendor/packages/akari-launcher/src/` →
  // `vendor/packages/project-scaffold/src/` から `../../akari-launcher/src/` で解決できる）。
  // 本体の src/ にも同じファイルが入るが、配布物の中で相対パスを 1 本に保つ方を採る。
  'packages/akari-launcher/src/history-policy.mjs'
];

if (process.argv[2] === 'clean') {
  rmSync(VENDOR_ROOT, { recursive: true, force: true });
  rmSync(LICENSE_COPY, { force: true });
  process.exit(0);
}

// モノレポ checkout の外で pack された場合（配布済みコピーの再 pack など）は、
// 既存の vendor があればそれを信じて続行し、無ければ失敗させる。
if (!existsSync(path.join(REPO_ROOT, 'skills', 'analyze-footage', 'SKILL.md'))) {
  if (existsSync(VENDOR_ROOT)) {
    console.error('prepack: モノレポ checkout が見つからないため既存の vendor/ をそのまま使います');
    process.exit(0);
  }
  console.error('prepack: モノレポ checkout が見つからず vendor/ も無いため中止します');
  process.exit(1);
}

const listed = execFileSync('git', ['-C', REPO_ROOT, 'ls-files', '-z'], {
  maxBuffer: 64 * 1024 * 1024
});
const allTrackedFiles = listed.toString('utf8').split('\0').filter(Boolean);
// 移設・削除を含む未コミット worktree からの検証でも、index にだけ残る旧パスを
// コピー対象にしない。配布候補は「追跡済みかつ現在も実在する」ファイルに限定する。
const existingTrackedFiles = allTrackedFiles.filter((relative) => existsSync(path.join(REPO_ROOT, relative)));
const baseVendorFiles = existingTrackedFiles.filter((relative) => VENDOR_SOURCES.some(
  (source) => relative === source || relative.startsWith(`${source}/`),
));
// package.json#bin は capability の説明情報ではあるが、target だけをコピーしても、src や
// npm dependencies が無ければ実行物にはならない。bin は VENDOR_SOURCES で実行時閉包を
// 明示したパッケージだけに限定し、その他は下で reference-only metadata へ変換する。
const capabilityFiles = discoverCheckoutCapabilitySources(REPO_ROOT, {
  trackedFiles: existingTrackedFiles,
  includeBinTargets: false,
});
const trackedFiles = [...new Set([...baseVendorFiles, ...capabilityFiles])]
  .sort((left, right) => left.localeCompare(right, 'en'));
if (trackedFiles.length === 0) {
  console.error('prepack: git ls-files が対象を 1 件も返しませんでした（checkout が壊れていないか確認してください）');
  process.exit(1);
}

rmSync(VENDOR_ROOT, { recursive: true, force: true });

let copied = 0;
for (const relative of trackedFiles) {
  if (path.basename(relative) === '.gitignore') {
    continue;
  }
  const from = path.join(REPO_ROOT, relative);
  const to = path.join(VENDOR_ROOT, relative);
  mkdirSync(path.dirname(to), { recursive: true });
  copyFileSync(from, to);
  chmodSync(to, statSync(from).mode);
  copied += 1;
}
rewriteReferenceOnlyPackageManifests(trackedFiles);
writeFileSync(
  path.join(VENDOR_ROOT, '.akari-capability-sources.json'),
  `${JSON.stringify({ version: 1, sources: capabilityFiles }, null, 2)}\n`,
  'utf8',
);
copyFileSync(path.join(REPO_ROOT, 'LICENSE'), LICENSE_COPY);

console.error(`prepack: vendor 同梱を作成しました（追跡ファイル ${copied} 件 → ${VENDOR_ROOT}）`);

function rewriteReferenceOnlyPackageManifests(selectedFiles) {
  const selected = new Set(selectedFiles);
  const manifests = selectedFiles.filter((relative) => /^packages\/[^/]+\/package\.json$/u.test(relative));
  for (const manifestPath of manifests) {
    const sourcePath = path.join(REPO_ROOT, manifestPath);
    const manifest = JSON.parse(readFileSync(sourcePath, 'utf8'));
    const entries = manifestBinEntries(manifest);
    if (entries.length === 0) continue;

    const packageRoot = path.posix.dirname(manifestPath);
    const included = [];
    const omitted = [];
    for (const entry of entries) {
      const canonical = path.posix.normalize(path.posix.join(packageRoot, entry.target)).replace(/^\.\//u, '');
      (selected.has(canonical) ? included : omitted).push(entry);
    }
    if (omitted.length === 0) continue;

    if (included.length === 0) {
      delete manifest.bin;
    } else {
      manifest.bin = Object.fromEntries(included.map(({ command, target }) => [command, target]));
    }
    // electron-builder NSIS per-user 既定 = sanitize-filename(`apps/shell/package.json` の `name`)。
    const guidance = 'These CLI entrypoints are not included in the akari-video npm package. Use `akari doctor --json` and run the path reported in `render_cut.path`. Full installations provide it in a monorepo checkout, ~/.akari/app, /Applications/AKARI Video.app/Contents/Resources/packages, or %LOCALAPPDATA%\\Programs\\@akari-videoshell\\resources\\packages.';
    const referenceOnlyTargets = omitted.map(({ target }) => `${target} is reference-only`).join('; ');
    // capability.mjs は package description を検索結果の見出しに使う。bin path を検索した
    // ユーザーが上位結果だけを見ても、古い実行例より先に配布形態と導線を読めるようにする。
    manifest.description = `${manifest.description ?? manifest.name ?? 'Package'} [akari-video npm vendor: ${referenceOnlyTargets}. ${guidance}]`;
    manifest.akariVideoVendor = {
      execution: included.length === 0 ? 'reference-only' : 'partial',
      omittedBin: Object.fromEntries(omitted.map(({ command, target }) => [command, target])),
      guidance
    };
    writeFileSync(
      path.join(VENDOR_ROOT, manifestPath),
      `${JSON.stringify(manifest, null, 2)}\n`,
      'utf8',
    );
  }
}

function manifestBinEntries(manifest) {
  if (typeof manifest?.bin === 'string') {
    return [{ command: manifest.name, target: manifest.bin }];
  }
  if (manifest?.bin && typeof manifest.bin === 'object' && !Array.isArray(manifest.bin)) {
    return Object.entries(manifest.bin).map(([command, target]) => ({ command, target }));
  }
  return [];
}
