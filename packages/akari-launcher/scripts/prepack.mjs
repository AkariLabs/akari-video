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
import { copyFileSync, existsSync, mkdirSync, rmSync, statSync, chmodSync, writeFileSync } from 'node:fs';
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
  'assets/font/noto-sans-jp/NotoSansJP-Variable.ttf',
  'packages/schemas',
  'packages/project-scaffold',
  // 作業場（creator-root）モジュール。npm 配布時も初回動線（first-run.mjs 経由の
  // 動的 import）が機能するよう同梱する。未同梱の場合は repo-assets.mjs 側で
  // creatorRootModulePath が null になり、現行動作へフォールバックする。
  'packages/creator-root',
  // 公式音源ライブラリ（AKARI Sounds）の一括取得（sounds-setup.mjs / `akari sounds`）。
  // media-bin は fetch スクリプトの preview.png 生成（waveform-preview.mjs）が ffmpeg 解決に
  // 使う。未同梱なら audioFetchScriptPath が null になり、音源セットアップだけスキップされる。
  'packages/audio-library-setup',
  'packages/media-bin'
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
const capabilityFiles = discoverCheckoutCapabilitySources(REPO_ROOT, { trackedFiles: existingTrackedFiles });
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
writeFileSync(
  path.join(VENDOR_ROOT, '.akari-capability-sources.json'),
  `${JSON.stringify({ version: 1, sources: capabilityFiles }, null, 2)}\n`,
  'utf8',
);
copyFileSync(path.join(REPO_ROOT, 'LICENSE'), LICENSE_COPY);

console.error(`prepack: vendor 同梱を作成しました（追跡ファイル ${copied} 件 → ${VENDOR_ROOT}）`);
