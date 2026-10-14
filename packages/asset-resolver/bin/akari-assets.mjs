#!/usr/bin/env node
// akari-assets — 素材 resolver v0 の CLI（list / add / fetch / bundle / migrate / sync / browse / check / credits / catalog / show / validate）。
//
//   akari-assets list [--category <c>] [--source <lab|site|own>] [--tag <t> ...] [--query <s>] [--json]
//   akari-assets add <path...> --plan [--json]
//   akari-assets add --apply <plan.json> [--json]
//   akari-assets fetch <ref> [--project <dir>] [--reference] [--force]  （ref は category/id）
//   akari-assets bundle --project <dir> [--dry-run]
//   akari-assets migrate [--dry-run]
//   akari-assets sync
//   akari-assets browse [--port <n>]
//   akari-assets check [--project <dir>] [--json]
//   akari-assets credits --project <dir>
//   akari-assets catalog [--json]
//   akari-assets show <category/id> [--json]
//   akari-assets validate <dir>

import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { planAdd, applyAdd } from '../src/add.mjs';
import { migrateAssetLibrary } from '../../creator-root/src/index.mjs';
import { startBrowseServer } from '../src/browse-server.mjs';
import { bundleProjectReferences } from '../src/bundle.mjs';
import { cacheCatalog, loadCatalog } from '../src/catalog.mjs';
import { resolve as resolveAsset } from '../src/resolve.mjs';
import { DEFAULT_CATALOG_URL, DEFAULT_STORE_API } from '../src/service-urls.mjs';
import { composeState } from '../src/state.mjs';
import { checkLibrary, projectCredits } from '../src/library-check.mjs';
import { filterListItems } from '../src/list-filter.mjs';
import { BUNDLED_CATALOG_ENV, resolveBundledCatalog, readBundledCatalog, externalReferences,
  mergeBundledReferences, findBundledEntry } from '../src/bundled-catalog.mjs';
import { ASSET_CATEGORIES, cachedAssetDir, readLocalLibraryItem, sourceFields } from '../src/library.mjs';

const VALIDATOR = fileURLToPath(new URL('../../schemas/bin/validate-asset.mjs', import.meta.url));

function flagValue(args, name) {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : null;
}

// Validate the entire command before any handler can read or mutate user data.
function validateArgs(sub, args) {
  const specs = {
    list: { values: ['--category', '--source', '--tag', '--query'], flags: ['--json'], max: 0 },
    catalog: { values: [], flags: ['--json'], max: 0 },
    show: { values: [], flags: ['--json'], min: 1, max: 1 },
    validate: { values: [], flags: [], min: 1, max: 1 },
    add: { values: ['--apply'], flags: ['--plan', '--json'], max: Infinity },
    fetch: { values: ['--project'], flags: ['--reference', '--force'], min: 1, max: 1 },
    bundle: { values: ['--project'], flags: ['--dry-run'], max: 0 },
    migrate: { values: [], flags: ['--dry-run'], max: 0 },
    sync: { values: [], flags: [], max: 0 },
    browse: { values: ['--port'], flags: [], max: 0 },
    check: { values: ['--project'], flags: ['--json'], max: 0 },
    credits: { values: ['--project'], flags: [], max: 0 },
  };
  const spec = specs[sub];
  if (!spec) throw new Error(`不明なコマンド: ${sub}`);
  const seen = new Set();
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg.startsWith('-')) { positional.push(arg); continue; }
    if (!spec.values.includes(arg) && !spec.flags.includes(arg)) throw new Error(`不明なオプション: ${arg}`);
    if (seen.has(arg) && !(sub === 'list' && arg === '--tag')) throw new Error(`重複したオプション: ${arg}`);
    seen.add(arg);
    if (spec.values.includes(arg) && (!args[++i] || args[i].startsWith('-'))) throw new Error(`${arg} には値が必要です`);
  }
  if (positional.length < (spec.min ?? 0) || positional.length > spec.max) throw new Error('引数の数が正しくありません');
  if (sub === 'add' && (seen.has('--plan') === seen.has('--apply')
    || (seen.has('--apply') ? positional.length !== 0 : positional.length === 0))) {
    throw new Error('add は <path...> --plan または --apply <plan.json> を指定してください');
  }
  if (sub === 'bundle' && !seen.has('--project')) throw new Error('--project <dir> が必要です');
  if (sub === 'credits' && !seen.has('--project')) throw new Error('--project <dir> が必要です');
  if (sub === 'fetch') {
    if (args[0] !== positional[0]) throw new Error('fetch の先頭には素材参照 category/id を指定してください');
    if (seen.has('--reference') && !seen.has('--project')) throw new Error('--reference には --project <dir> が必要です');
  }
}

const STATE_BADGE = { cached: '✓', locked: '🔒 Pro', available: '☁', reference: '↗' };

function badgeOf(item) {
  if (item.source === 'installed') return '[installed]';
  if (item.state === 'locked') return STATE_BADGE.locked;
  if (item.state === 'available' && item.tier === 'pro') return '✓ Pro';
  return STATE_BADGE[item.state] ?? '?';
}

async function cmdList(args, env) {
  const category = flagValue(args, '--category');
  const asJson = args.includes('--json');
  const source = flagValue(args, '--source');
  const tags = args.flatMap((arg, index) => arg === '--tag' ? [args[index + 1]] : []);
  const query = flagValue(args, '--query');
  if (args.includes('--source') && !['lab', 'site', 'own'].includes(source)) throw new Error('--source は lab / site / own で指定してください');
  const { libraryRoots, items, warnings } = await composeState({ env });
  for (const warning of warnings) console.error(`警告: ${warning}`);
  const bundled = resolveBundledCatalog(env);
  if (!bundled.root && bundled.origin === 'env') console.error(`警告: 同梱カタログが見つかりません: ${bundled.candidates[0]}`);
  const { entries, warnings: catalogWarnings } = bundled.root ? readBundledCatalog(bundled.root) : { entries: [], warnings: [] };
  for (const warning of catalogWarnings) console.error(`警告: ${warning}`);
  const filtered = filterListItems(mergeBundledReferences(items, externalReferences(entries)), { category, source, tags, query });

  if (asJson) {
    console.log(JSON.stringify(filtered, null, 2));
    return;
  }

  const usable = filtered.filter(item => item.state !== 'reference');
  const references = filtered.filter(item => item.state === 'reference');
  console.log(`使える素材 ${usable.length} 件（ライブラリ: ${libraryRoots.write}）`);
  for (const item of usable) {
    console.log(`  ${badgeOf(item)}  ${item.category}/${item.id}\t${item.sourceKind}\t[${item.category}]\t${item.tier === 'pro' ? 'pro' : 'free'}\t${item.title}`);
  }
  if (references.length) {
    console.log(`外部サイトの参照 ${references.length} 件（同梱カタログ: ${bundled.root}）— 取得先の索引です。「同梱済み」と付いた行は実体がアプリに入っています。それ以外はまだ手元にありません。中身は akari assets show <category/id>、取得は setup-library スキルの手順で`);
    for (const item of references) console.log(`  ${badgeOf(item)}  ${item.category}/${item.id}\tsite\t[${item.category}]\t${item.tier === 'pro' ? 'pro' : 'free'}\t${item.title}\t${item.source?.acquisition ?? '-'}\t${item.source?.url ?? '-'}${item.bundledAssetDir ? '\t同梱済み' : ''}`);
  }
}

function presentFile(location) {
  try { return statSync(location).isFile() ? location : null; } catch { return null; }
}
function presentDir(location) {
  try { return statSync(location).isDirectory() ? location : null; } catch { return null; }
}
function bundledEntries(env) {
  const resolved = resolveBundledCatalog(env);
  const content = resolved.root ? readBundledCatalog(resolved.root) : { entries: [], warnings: [] };
  return { ...resolved, ...content };
}

function cmdCatalog(args, env) {
  const bundled = bundledEntries(env);
  const root = bundled.root;
  const byCategory = {};
  for (const category of ASSET_CATEGORIES) {
    const count = bundled.entries.filter(item => item.category === category).length;
    if (count) byCategory[category] = count;
  }
  const sitesDir = root && presentDir(path.join(root, 'sites'));
  const sites = [];
  const warnings = [...bundled.warnings];
  if (sitesDir) for (const name of readdirSync(sitesDir).filter(name => name.endsWith('.json')).sort()) {
    try {
      const site = JSON.parse(readFileSync(path.join(sitesDir, name), 'utf8'));
      if (!site || typeof site !== 'object' || Array.isArray(site) || site.id !== name.slice(0, -5)) throw new Error('サイト定義が不正です');
      sites.push({ id: site.id, name: site.name, tab: site.tab, entryUrl: site.entry_url,
        directFetchAllowed: site.direct_fetch_allowed, path: path.join(sitesDir, name) });
    } catch (error) { warnings.push(`sites/${name}: ${error.message}`); }
  }
  const validatorPath = presentFile(VALIDATOR);
  const result = { root, origin: bundled.origin, env: BUNDLED_CATALOG_ENV,
    indexPath: root && presentFile(path.join(root, 'INDEX.md')),
    packsPath: root && presentFile(path.join(root, 'packs.json')), sitesDir,
    audioCandidatesPath: root && presentFile(path.join(root, 'audio/candidates.json')), validatorPath,
    counts: { total: bundled.entries.length, external: externalReferences(bundled.entries).length, byCategory }, sites, warnings };
  if (args.includes('--json')) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(`同梱カタログ: ${root ?? '見つかりません'}`);
    console.log(`素材: ${result.counts.total} 件（外部サイト: ${result.counts.external} 件）`);
    console.log(`索引: ${result.indexPath ?? '-'}`);
    console.log(`素材サイト: ${sites.length} 件`);
    console.log(`音源の候補: ${result.audioCandidatesPath ?? '-'}`);
    console.log('検証は akari assets validate <dir>');
  }
  for (const warning of warnings) console.error(`警告: ${warning}`);
  if (!root) {
    console.error(`同梱カタログが見つかりません（探した場所: ${bundled.candidates.join(', ')}）。AKARI_CATALOG_ROOT で場所を指定できます`);
    process.exitCode = 1;
  }
}

async function cmdShow(args, env) {
  const ref = args.find(arg => !arg.startsWith('-'));
  try {
    const bundled = bundledEntries(env);
    for (const warning of bundled.warnings) console.error(`警告: ${warning}`);
    let entry = findBundledEntry(bundled.entries, ref);
    let meta;
    let libraryDir;
    let catalogDir = null;
    let metaPath = null;
    let bundledAssetDir = null;
    let state;
    let sourceKind;
    if (entry) {
      meta = JSON.parse(readFileSync(entry.metaPath, 'utf8'));
      ({ catalogDir, metaPath, sourceKind, bundledAssetDir } = entry);
      libraryDir = cachedAssetDir(env, entry.category, entry.id);
      state = libraryDir ? 'cached' : 'reference';
    } else {
      const category = ref.includes('/') ? ref.split('/')[0] : null;
      const id = ref.includes('/') ? ref.split('/')[1] : ref;
      const localCategories = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(id)
        ? (category ? ASSET_CATEGORIES.filter(kind => kind === category) : ASSET_CATEGORIES) : [];
      const localMatches = localCategories
        .map(kind => readLocalLibraryItem(env, kind, id)).filter(Boolean);
      if (localMatches.length > 1) {
        const candidates = localMatches.map(item => `${item.category}/${item.id}`);
        const error = new Error(`素材 ID が曖昧です: ${ref}（候補: ${candidates.join(', ')}）`);
        error.code = 'ambiguous_id';
        error.candidates = candidates;
        throw error;
      }
      const local = localMatches[0] ?? null;
      if (local) {
        ({ libraryDir, state } = local);
        meta = local;
        sourceKind = sourceFields(local, false).sourceKind;
        entry = local;
      } else {
        const composed = await composeState({ env });
        entry = findBundledEntry(composed.items, ref);
        if (entry) {
          meta = entry;
          ({ state, sourceKind } = entry);
          libraryDir = entry.libraryDir ?? null;
        }
      }
    }
    if (!entry) {
      console.error(`未知の素材参照です: ${ref}（同梱カタログにも手元のライブラリにもありません。akari assets list で確かめてください）`);
      process.exitCode = 1;
      return;
    }
    const canonical = `${entry.category}/${entry.id}`;
    const result = { ref: canonical, state, sourceKind, catalogDir, metaPath, libraryDir: libraryDir ?? null, bundledAssetDir, meta };
    if (args.includes('--json')) { console.log(JSON.stringify(result, null, 2)); return; }
    console.log(`${canonical} — ${meta.title ?? entry.title}`);
    console.log(state === 'cached' ? `手元にあります: ${libraryDir}`
      : state === 'reference' && bundledAssetDir ? `外部サイトの参照（実体はアプリに同梱済み: ${bundledAssetDir}）`
        : state === 'reference' ? '外部サイトの参照（まだ手元にありません）'
          : state === 'available' ? `まだ手元にありません（akari assets fetch ${canonical} で取得できます）`
            : state === 'locked' ? '未購入の Pro 素材です（akari assets fetch では取得できません）'
              : `状態: ${state}`);
    if (meta.source?.url) console.log(`取得先: ${meta.source.url}`);
    if (meta.source?.acquisition) console.log(`取得方法: ${meta.source.acquisition}`);
    if (meta.source?.license_at_source) console.log(`配布元のライセンス表記: ${meta.source.license_at_source}`);
    if (meta.source?.attribution_required !== undefined || meta.license?.attribution_required !== undefined)
      console.log(`クレジット表記: ${meta.source?.attribution_required || meta.license?.attribution_required ? '必要' : '不要'}`);
    if (meta.license?.spdx) console.log(`ライセンス: ${meta.license.spdx}`);
    if (metaPath) console.log(`場所: ${metaPath}`);
  } catch (error) {
    if (error?.code !== 'ambiguous_id') throw error;
    console.error(error.message);
    process.exitCode = 1;
  }
}

function cmdValidate(args, env) {
  if (!presentFile(VALIDATOR)) { console.error('検証器（validate-asset）が見つかりません'); process.exitCode = 1; return; }
  const target = args.find(arg => !arg.startsWith('-'));
  const result = spawnSync(process.execPath, [VALIDATOR, target], { stdio: 'inherit', env });
  process.exitCode = typeof result.status === 'number' ? result.status : 1;
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
  const ref = args[0];
  if (!ref || ref.startsWith('--')) {
    console.error('使い方: akari-assets fetch <ref> [--project <dir>] [--reference] [--force]（ref は category/id）');
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
    const result = await resolveAsset(ref, { env, project, force, reference });
    console.log(`${result.cached ? '取得済み（キャッシュ）を使用' : '取得しました'}: ${result.dir}`);
    if (result.projectDir) console.log(`  プロジェクトへコピー: ${result.projectDir}`);
    if (result.referenced) console.log(`  参照を記帳: ${result.category}/${result.id}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    if (error?.code === 'not_found') {
      const bundled = bundledEntries(env);
      const entry = findBundledEntry(bundled.entries, ref);
      if (entry) console.error(`この項目は外部サイトの参照です（akari assets fetch では取得できません）。akari assets show ${entry.category}/${entry.id} で取得先を確かめ、setup-library スキルの手順で取り込んでください`);
    }
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

async function cmdCheck(args, env) {
  const result = await checkLibrary({ env, project: flagValue(args, '--project') });
  if (args.includes('--json')) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(`問題なし ${result.ok} 件 / 注意 ${result.warnings.length} 件 / エラー ${result.errors.length} 件`);
    for (const row of result.findings) console.log(`${row.level === 'error' ? 'エラー' : '注意'}: ${row.category}/${row.id}: ${row.message} (${row.dir})`);
  }
  if (result.errors.length) process.exitCode = 1;
}

async function cmdCredits(args, env) {
  console.log((await projectCredits(flagValue(args, '--project'), env)).join('\n'));
}

function printUsage() {
  console.log(`使い方: akari-assets <list|add|fetch|bundle|migrate|sync|browse|check|credits|catalog|show|validate> [options]

  list [--category <c>] [--source <lab|site|own>] [--tag <t> ...] [--query <s>] [--json]
                                          タグ完全一致（複数は AND）・題名/id/タグ部分一致で絞る素材一覧
  add <path...> --plan [--json]           ローカル素材の取り込み計画（書き込みなし）
  add --apply <plan.json> [--json]        計画で選択した素材を複製して登録
  fetch <ref> [--project <dir>] [--reference] [--force]
                                          ref は category/id（bare id は一意な場合のみ）。--reference はコピーせず参照を記帳
  bundle --project <dir> [--dry-run]      参照素材をプロジェクトへ実体化（素材をまとめる）
  migrate [--dry-run]                     ライブラリを作業場へ移行
  sync                                    カタログを取得してローカルにキャッシュ（オフライン用）
  browse [--port <n>]                     ローカル HTTP サーバでカタログを閲覧・投入（既定 8910）
  check [--project <dir>] [--json]         ライブラリを読み取り専用で点検
  credits --project <dir>                 プロジェクトのクレジット文面を一覧
  catalog [--json]                        同梱カタログの場所と件数
  show <category/id> [--json]             素材 1 件の取得先とライセンス
  validate <dir>                          取り込んだ素材を検証

環境変数:
  AKARI_HOME             マシン設定の置き場（既定: ~/.akari）
  AKARI_LIBRARY_ROOT     ライブラリの置き場の上書き
  AKARI_ASSETS_CATALOG   カタログの取得元。URL またはローカルパス（既定: ${DEFAULT_CATALOG_URL}）
  AKARI_CATALOG_ROOT     同梱カタログ（外部サイトの素材の取得先の索引）の場所の上書き
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
  if (sub === 'catalog') return cmdCatalog(rest, env);
  if (sub === 'show') return cmdShow(rest, env);
  if (sub === 'validate') return cmdValidate(rest, env);
  if (sub === 'add') return cmdAdd(rest, env);
  if (sub === 'fetch') return cmdFetch(rest, env);
  if (sub === 'bundle') return cmdBundle(rest, env);
  if (sub === 'sync') return cmdSync(rest, env);
  if (sub === 'browse') return cmdBrowse(rest, env);
  if (sub === 'check') return cmdCheck(rest, env);
  if (sub === 'credits') return cmdCredits(rest, env);

  printUsage();
  process.exitCode = sub && sub !== '--help' && sub !== '-h' ? 1 : 0;
}

main().catch((error) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
  process.exitCode = 1;
});
