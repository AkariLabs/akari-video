#!/usr/bin/env node
// akari-assets — 素材 resolver v0 の CLI（list / add / fetch / bundle / migrate / sync / browse）。
//
//   akari-assets list [--category <c>] [--source <lab|site|own>] [--json]
//   akari-assets add <path...> --plan [--json]
//   akari-assets add --apply <plan.json> [--json]
//   akari-assets fetch <id> [--project <dir>] [--reference] [--force]
//   akari-assets bundle --project <dir> [--dry-run]
//   akari-assets sync
//   akari-assets browse [--port <n>]

import { readFile } from 'node:fs/promises';
import { planAdd, applyAdd } from '../src/add.mjs';
import { migrateAssetLibrary } from '../../creator-root/src/index.mjs';
import { startBrowseServer } from '../src/browse-server.mjs';
import { bundleProjectReferences } from '../src/bundle.mjs';
import { cacheCatalog, loadCatalog } from '../src/catalog.mjs';
import { resolve as resolveAsset } from '../src/resolve.mjs';
import { DEFAULT_CATALOG_URL, DEFAULT_STORE_API } from '../src/service-urls.mjs';
import { composeState } from '../src/state.mjs';

function flagValue(args, name) {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : null;
}

// Validate the entire command before any handler can read or mutate user data.
function validateArgs(sub, args) {
  const specs = {
    list: { values: ['--category', '--source'], flags: ['--json'], max: 0 },
    add: { values: ['--apply'], flags: ['--plan', '--json'], max: Infinity },
    fetch: { values: ['--project'], flags: ['--reference', '--force'], min: 1, max: 1 },
    bundle: { values: ['--project'], flags: ['--dry-run'], max: 0 },
    migrate: { values: [], flags: ['--dry-run'], max: 0 },
    sync: { values: [], flags: [], max: 0 },
    browse: { values: ['--port'], flags: [], max: 0 },
  };
  const spec = specs[sub];
  if (!spec) throw new Error(`不明なコマンド: ${sub}`);
  const seen = new Set();
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg.startsWith('-')) { positional.push(arg); continue; }
    if (!spec.values.includes(arg) && !spec.flags.includes(arg)) throw new Error(`不明なオプション: ${arg}`);
    if (seen.has(arg)) throw new Error(`重複したオプション: ${arg}`);
    seen.add(arg);
    if (spec.values.includes(arg) && (!args[++i] || args[i].startsWith('-'))) throw new Error(`${arg} には値が必要です`);
  }
  if (positional.length < (spec.min ?? 0) || positional.length > spec.max) throw new Error('引数の数が正しくありません');
  if (sub === 'add' && (seen.has('--plan') === seen.has('--apply')
    || (seen.has('--apply') ? positional.length !== 0 : positional.length === 0))) {
    throw new Error('add は <path...> --plan または --apply <plan.json> を指定してください');
  }
  if (sub === 'bundle' && !seen.has('--project')) throw new Error('--project <dir> が必要です');
  if (sub === 'fetch') {
    if (args[0] !== positional[0]) throw new Error('fetch の先頭には素材 ID を指定してください');
    if (seen.has('--reference') && !seen.has('--project')) throw new Error('--reference には --project <dir> が必要です');
  }
}

const STATE_BADGE = { cached: '✓', locked: '¥', available: '☁' };

function badgeOf(item) {
  if (item.source === 'installed') return '[installed]';
  if (item.state === 'locked') return `¥${(item.price ?? 0).toLocaleString()}`;
  return STATE_BADGE[item.state] ?? '?';
}

async function cmdList(args, env) {
  const category = flagValue(args, '--category');
  const asJson = args.includes('--json');
  const source = flagValue(args, '--source');
  if (args.includes('--source') && !['lab', 'site', 'own'].includes(source)) throw new Error('--source は lab / site / own で指定してください');
  const { libraryRoots, items, warnings } = await composeState({ env });
  for (const warning of warnings) console.error(`警告: ${warning}`);
  const filtered = items.filter(item => (!category || item.category === category) && (!source || item.sourceKind === source));

  if (asJson) {
    console.log(JSON.stringify(filtered, null, 2));
    return;
  }

  console.log(`使える素材 ${filtered.length} 件（ライブラリ: ${libraryRoots.write}）`);
  for (const item of filtered) {
    console.log(`  ${badgeOf(item)}  ${item.id}\t${item.sourceKind}\t[${item.category}]\t${item.title}`);
  }
}

async function cmdAdd(args, env) {
  const apply = flagValue(args, '--apply');
  if (args.includes('--plan') === args.includes('--apply')) throw new Error('add は --plan または --apply <plan.json> のどちらかを指定してください');
  let result;
  if (args.includes('--apply')) {
    if (!apply || args.some((arg, index) => !['--apply', '--json'].includes(arg) && index !== args.indexOf('--apply') + 1)) throw new Error('使い方: akari-assets add --apply <plan.json> [--json]');
    result = await applyAdd(JSON.parse(await readFile(apply, 'utf8')), { env });
    if (result.failures.length) process.exitCode = 1;
  } else {
    if (args.some(arg => arg.startsWith('--') && !['--plan', '--json'].includes(arg))) throw new Error('使い方: akari-assets add <path...> --plan [--json]');
    result = await planAdd(args.filter(arg => !['--plan', '--json'].includes(arg)), { env });
  }
  console.log(JSON.stringify(result, null, 2));
}

async function cmdFetch(args, env) {
  const id = args[0];
  if (!id || id.startsWith('--')) {
    console.error('使い方: akari-assets fetch <id> [--project <dir>] [--reference] [--force]');
    process.exitCode = 1;
    return;
  }
  const project = flagValue(args, '--project');
  const reference = args.includes('--reference');
  const force = args.includes('--force');
  if (reference && !project) {
    console.error('--reference には --project <dir> が必要です');
    process.exitCode = 1;
    return;
  }
  try {
    const result = await resolveAsset(id, { env, project, force, reference });
    console.log(`${result.cached ? '取得済み（キャッシュ）を使用' : '取得しました'}: ${result.dir}`);
    if (result.projectDir) console.log(`  プロジェクトへコピー: ${result.projectDir}`);
    if (result.referenced) console.log(`  参照を記帳: ${result.category}/${result.id}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

async function cmdBundle(args, env) {
  const project = flagValue(args, '--project');
  const dryRun = args.includes('--dry-run');
  if (!project) {
    console.error('使い方: akari-assets bundle --project <dir> [--dry-run]');
    process.exitCode = 1;
    return;
  }

  const result = await bundleProjectReferences({ project, env, dryRun });
  if (result.planned.length === 0) {
    console.log('実体化する参照はありません');
    return;
  }
  if (dryRun) {
    for (const reference of result.planned) {
      console.log(`実体化予定: ${reference.category}/${reference.id}`);
    }
    return;
  }

  for (const materialized of result.materialized) {
    console.log(
      `実体化しました: ${materialized.category}/${materialized.id} -> ${materialized.projectDir}`,
    );
  }
  if (result.failures.length > 0) {
    console.error(`実体化できなかった参照 ${result.failures.length} 件:`);
    for (const failure of result.failures) {
      console.error(
        `  ${failure.reference.category}/${failure.reference.id}: ${failure.message}`,
      );
    }
    process.exitCode = 1;
  }
}

async function cmdSync(_args, env) {
  const catalog = await loadCatalog({ env, includeInstalled: false });
  await cacheCatalog(env, catalog);
  console.log(`カタログを同期しました: ${catalog.items.length} 件（version ${catalog.version ?? '不明'}）`);
}

async function cmdBrowse(args, env) {
  const port = Number(flagValue(args, '--port') ?? 8910);
  await startBrowseServer({ env, port });
  // サーバプロセスを起動したまま維持する（declare-server.mjs 等と同じ流儀）
}

function printUsage() {
  console.log(`使い方: akari-assets <list|add|fetch|bundle|migrate|sync|browse> [options]

  list [--category <c>] [--source <lab|site|own>] [--json]
                                          出どころ・取得状態つき素材一覧
  add <path...> --plan [--json]           ローカル素材の取り込み計画（書き込みなし）
  add --apply <plan.json> [--json]        計画で選択した素材を複製して登録
  fetch <id> [--project <dir>] [--reference] [--force]
                                          素材を解決して登録（--reference はコピーせず参照を記帳）
  bundle --project <dir> [--dry-run]      参照素材をプロジェクトへ実体化（素材をまとめる）
  migrate [--dry-run]                     ライブラリを作業場へ移行
  sync                                    カタログを取得してローカルにキャッシュ（オフライン用）
  browse [--port <n>]                     ローカル HTTP サーバでカタログを閲覧・投入（既定 8910）

環境変数:
  AKARI_HOME             マシン設定の置き場（既定: ~/.akari）
  AKARI_LIBRARY_ROOT     ライブラリの置き場の上書き
  AKARI_ASSETS_CATALOG   カタログの取得元。URL またはローカルパス（既定: ${DEFAULT_CATALOG_URL}）
  AKARI_ASSETS_BASE      素材実体の配信ベースの上書き（既定はカタログの "base" フィールド）
  AKARI_STORE_API        entitlements API のホスト上書き（既定: ${DEFAULT_STORE_API}）`);
}

async function main() {
  const [sub, ...rest] = process.argv.slice(2);
  const env = process.env;

  if (!sub || process.argv.slice(2).some(arg => arg === '--help' || arg === '-h')) {
    printUsage();
    return;
  }
  try { validateArgs(sub, rest); }
  catch (error) {
    console.error(error.message);
    printUsage();
    process.exitCode = 2;
    return;
  }

  if (sub === 'migrate') {
    const result = await migrateAssetLibrary({ env, dryRun: rest.includes('--dry-run') });
    console.log(JSON.stringify(result, null, 2));
    if (result.failures.length) process.exitCode = 1;
    return;
  }
  if (sub === 'list') return cmdList(rest, env);
  if (sub === 'add') return cmdAdd(rest, env);
  if (sub === 'fetch') return cmdFetch(rest, env);
  if (sub === 'bundle') return cmdBundle(rest, env);
  if (sub === 'sync') return cmdSync(rest, env);
  if (sub === 'browse') return cmdBrowse(rest, env);

  printUsage();
  process.exitCode = sub && sub !== '--help' && sub !== '-h' ? 1 : 0;
}

main().catch((error) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
  process.exitCode = 1;
});
