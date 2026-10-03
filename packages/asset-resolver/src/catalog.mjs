// カタログ（akari-assets-catalog/v0）の取得。リモート URL は fetch → 成功したら
// ~/.akari/catalog-cache.json へ自動キャッシュ（オフライン時のフォールバック）。
// ローカルパス指定（開発・テスト）はファイルをそのまま読む。

import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { catalogCachePath, resolveAkariHome, resolveCatalogSource } from './env.mjs';
import { loadInstalledItems, mergeInstalledItems } from './installed.mjs';
import { fetchTimed, readTimedJson } from './fetch-file.mjs';

function normalizeCatalog(catalog) {
  if (!catalog || !Array.isArray(catalog.items)) {
    throw new Error('カタログの形式が想定と違います（items 配列がない）');
  }
  return catalog;
}

export async function readCatalogCache(env = process.env) {
  try {
    return normalizeCatalog(JSON.parse(await readFile(catalogCachePath(env), 'utf8')));
  } catch {
    return null;
  }
}

export async function cacheCatalog(env = process.env, catalog) {
  const home = resolveAkariHome(env);
  await mkdir(home, { recursive: true });
  await writeFile(catalogCachePath(env), `${JSON.stringify(catalog, null, 2)}\n`);
}

/**
 * カタログを読む。リモート取得が失敗した場合（オフライン等）はローカルキャッシュへ
 * フォールバックする（黙って劣化させるのではなく、キャッシュが無ければ明示的に失敗する）。
 */
export async function loadCatalog({ env = process.env, fetchImpl = fetch, includeInstalled = true, timeouts, fallbackToCache = true } = {}) {
  const source = resolveCatalogSource(env);
  const installedItems = includeInstalled ? await loadInstalledItems(env) : [];
  let catalog;

  if (source.kind === 'file') {
    const raw = await readFile(source.value, 'utf8');
    catalog = normalizeCatalog(JSON.parse(raw));
  } else {
    try {
      const { response: res, controller } = await fetchTimed(source.value, { fetchImpl, timeouts, label: 'カタログ' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      catalog = normalizeCatalog(await readTimedJson(res, controller, { timeouts, label: 'カタログ' }));
      await cacheCatalog(env, catalog);
    } catch (error) {
      if (!fallbackToCache) throw new Error('カタログの取得に失敗しました: ' + (error instanceof Error ? error.message : String(error)));
      const cached = await readCatalogCache(env);
      if (cached) {
        catalog = cached;
      } else if (installedItems.length > 0) {
        catalog = { schema: 'akari-assets-catalog/v0', version: null, base: null, items: [] };
      } else {
        throw new Error(
          `カタログを取得できず、キャッシュもありません（${source.value}）: ${
            error instanceof Error ? error.message : String(error)
          }。オンライン環境で先に \`akari-assets sync\` を実行してください`,
        );
      }
    }
  }

  return includeInstalled ? mergeInstalledItems(catalog, installedItems) : catalog;
}

/** Resolve uses a valid local cache first; listing/sync remains responsible for freshness. */
export async function loadCatalogForResolve(id, { env = process.env, fetchImpl = fetch, timeouts } = {}) {
  const installedItems = await loadInstalledItems(env);
  if (installedItems.some(item => item.id === id)) {
    return { schema: 'akari-assets-catalog/v0', version: null, base: null, items: installedItems };
  }
  if (resolveCatalogSource(env).kind === 'url') {
    const cached = await readCatalogCache(env);
    if (cached && cached.items.some(item => item.id === id)) {
      return mergeInstalledItems(cached, installedItems);
    }
  }
  return loadCatalog({ env, fetchImpl, timeouts, fallbackToCache: false });
}

export { resolveEffectiveBase } from './env.mjs';
