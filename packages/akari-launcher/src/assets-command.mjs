import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { resolveLauncherAssets } from './repo-assets.mjs';
import { assetsResolverUnavailableError } from './messages.mjs';

/**
 * `akari assets <list|fetch|sync|...>` — `packages/asset-resolver` の CLI
 * （`bin/akari-assets.mjs`）への薄い委譲（タスク契約 2026-08-09-agent-assets-discovery）。
 *
 * カタログ合成・entitlements 判定・取得・sha256 検証・validate-asset・fail-closed の実ロジックは
 * すべて resolver 側の責務のまま変更しない。認証（`~/.akari/store-credentials.json`）も
 * resolver がそのまま読む。ここでは引数をそのまま子プロセスへ転送し、resolver 側の usage /
 * エラー文言 / exit code をそのまま利用者に返すだけ。
 *
 * 規約は他の launcher 委譲コマンド（`akari sounds` = sounds-setup.mjs）と同じ:
 *   - 同梱の実体解決は `resolveLauncherAssets()`（モノレポ checkout → npm 配布時の vendor/）
 *   - 副作用（spawn）は options で注入可能・node --test で実プロセス不要
 */

function defaultSpawnAssetsCli(cliPath, args, env) {
  // stdio: inherit — list の一覧表示・fetch の進捗ログ・JSON 出力をそのまま利用者に見せる
  // （sounds-setup.mjs の defaultSpawnFetch と同じ流儀）。env を明示的に渡すのは必須 —
  // 注入された AKARI_HOME（テスト・隔離実行）が resolver 側の解決にも効くようにする。
  return spawnSync(process.execPath, [cliPath, ...args], { stdio: 'inherit', env });
}

export async function runAssetsCommand(args, options = {}) {
  const logError = options.logError ?? ((line) => console.error(line));
  const env = options.env ?? process.env;
  const assets = options.assets ?? resolveLauncherAssets();

  // These catalog pack IDs are reference entries; their tracks are distributed by the
  // first-party Sounds fetcher, while the resolver catalog contains only individual IDs.
  if (args[0] === 'fetch' && /^akari-sounds-[a-z0-9-]+$/u.test(args[1] ?? '')) {
    if (!assets?.audioFetchScriptPath) {
      logError('AKARI Sounds の取得スクリプトが同梱されていません');
      return { exitCode: 1 };
    }
    const spawn = options.spawnSoundsCli ?? defaultSpawnAssetsCli;
    const fetchArgs = ['--pack', args[1], ...(args.includes('--force') ? ['--force'] : [])];
    const result = spawn(assets.audioFetchScriptPath, fetchArgs, env);
    return { exitCode: typeof result.status === 'number' ? result.status : 1 };
  }

  const cliPath = assets?.assetResolverCliPath;
  if (!cliPath) {
    logError(assetsResolverUnavailableError());
    return { exitCode: 1 };
  }

  const spawnAssetsCli = options.spawnAssetsCli ?? defaultSpawnAssetsCli;
  if (args[0] === 'fetch' && assets?.repoRoot) {
    try {
      const load = options.loadCatalog ?? (await import(pathToFileURL(resolve(dirname(cliPath), '../src/catalog.mjs')).href)).loadCatalog;
      const catalog = await load({ env });
      if (!catalog.items.some(item => item.id === args[1])) {
        const members = catalog.items.filter(item => Array.isArray(item.tags) && item.tags.includes(`pack:${args[1]}`));
        if (members.length > 0) {
          let exitCode = 0;
          for (const item of members) {
            const result = spawnAssetsCli(cliPath, ['fetch', item.id, ...args.slice(2)], env);
            if (result.status !== 0) exitCode = 1;
          }
          return { exitCode };
        }
      }
    } catch {
      // Delegate to the resolver, which owns catalog errors and offline guidance.
    }
  }
  const result = spawnAssetsCli(cliPath, args, env);
  const exitCode = typeof result.status === 'number' ? result.status : (result.error ? 1 : 0);
  return { exitCode };
}
