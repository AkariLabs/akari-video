#!/usr/bin/env node
// akari-assets — 素材 resolver v0 の CLI（list / fetch / sync / browse）。
//
//   akari-assets list [--category <c>] [--json]
//   akari-assets fetch <id> [--project <dir>] [--force]
//   akari-assets sync
//   akari-assets browse [--port <n>]

import { startBrowseServer } from '../src/browse-server.mjs';
import { cacheCatalog, loadCatalog } from '../src/catalog.mjs';
import { resolve as resolveAsset } from '../src/resolve.mjs';
import { composeState } from '../src/state.mjs';

function flagValue(args, name) {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : null;
}

const STATE_BADGE = { cached: '✓', locked: '¥', available: '☁' };

function badgeOf(item) {
  if (item.state === 'locked') return `¥${(item.price ?? 0).toLocaleString()}`;
  return STATE_BADGE[item.state] ?? '?';
}

async function cmdList(args, env) {
  const category = flagValue(args, '--category');
  const asJson = args.includes('--json');
  const { home, items } = await composeState({ env });
  const filtered = category ? items.filter((item) => item.category === category) : items;

  if (asJson) {
    console.log(JSON.stringify(filtered, null, 2));
    return;
  }

  console.log(`使える素材 ${filtered.length} 件（ライブラリ: ${home}）`);
  for (const item of filtered) {
    console.log(`  ${badgeOf(item)}  ${item.id}\t[${item.category}]\t${item.title}`);
  }
}

async function cmdFetch(args, env) {
  const id = args[0];
  if (!id || id.startsWith('--')) {
    console.error('使い方: akari-assets fetch <id> [--project <dir>] [--force]');
    process.exitCode = 1;
    return;
  }
  const project = flagValue(args, '--project');
  const force = args.includes('--force');
  try {
    const result = await resolveAsset(id, { env, project, force });
    console.log(`${result.cached ? '取得済み（キャッシュ）を使用' : '取得しました'}: ${result.dir}`);
    if (result.projectDir) console.log(`  プロジェクトへコピー: ${result.projectDir}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

async function cmdSync(_args, env) {
  const catalog = await loadCatalog({ env });
  await cacheCatalog(env, catalog);
  console.log(`カタログを同期しました: ${catalog.items.length} 件（version ${catalog.version ?? '不明'}）`);
}

async function cmdBrowse(args, env) {
  const port = Number(flagValue(args, '--port') ?? 8910);
  await startBrowseServer({ env, port });
  // サーバプロセスを起動したまま維持する（declare-server.mjs 等と同じ流儀）
}

function printUsage() {
  console.log(`使い方: akari-assets <list|fetch|sync|browse> [options]

  list [--category <c>] [--json]          合成カタログ一覧（取得状態バッジ込み）
  fetch <id> [--project <dir>] [--force]  素材を解決してローカルへ登録（キャッシュ済みなら即返す）
  sync                                    カタログを取得してローカルにキャッシュ（オフライン用）
  browse [--port <n>]                     ローカル HTTP サーバでカタログを閲覧・投入（既定 8910）

環境変数:
  AKARI_HOME             ライブラリの置き場（既定: ~/.akari）
  AKARI_ASSETS_CATALOG   カタログの取得元。URL またはローカルパス（既定: akari-oss.app/assets/catalog.json）
  AKARI_ASSETS_BASE      素材実体の配信ベースの上書き（既定はカタログの "base" フィールド）
  AKARI_STORE_API        entitlements API のホスト上書き（既定: akari-oss.app）`);
}

async function main() {
  const [sub, ...rest] = process.argv.slice(2);
  const env = process.env;

  if (sub === 'list') return cmdList(rest, env);
  if (sub === 'fetch') return cmdFetch(rest, env);
  if (sub === 'sync') return cmdSync(rest, env);
  if (sub === 'browse') return cmdBrowse(rest, env);

  printUsage();
  process.exitCode = sub && sub !== '--help' && sub !== '-h' ? 1 : 0;
}

main().catch((error) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
  process.exitCode = 1;
});
