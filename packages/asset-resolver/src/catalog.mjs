// カタログ（akari-assets-catalog/v0）の取得。リモート URL は fetch → 成功したら
// ~/.akari/catalog-cache.json へ自動キャッシュ（オフライン時のフォールバック）。
// ローカルパス指定（開発・テスト）はファイルをそのまま読む。

import { readFile, mkdir, writeFile, stat } from 'node:fs/promises';
import { catalogCachePath, resolveAkariHome, resolveCatalogSource } from './env.mjs';
import { join } from 'node:path';
import { loadInstalledItems, mergeInstalledItems } from './installed.mjs';
import { fetchTimed, readTimedJson } from './fetch-file.mjs';
import { assetTier } from './tier.mjs';

function normalizeCatalog(catalog) {
  if (!catalog || !Array.isArray(catalog.items)) {
    throw new Error('カタログの形式が想定と違います（items 配列がない）');
  }
  return catalog;
}

// The local catalog is large; keep the parsed value until the file changes.
const parsedCatalogs = new Map();
async function readLocalCatalog(file, visible = false) {
  const info = await stat(file);
  const cached = parsedCatalogs.get(file);
  if (cached && cached.mtimeMs === info.mtimeMs && cached.ctimeMs === info.ctimeMs
      && cached.size === info.size) {
    if (visible && !cached.public) cached.public = publicCatalog(cached.catalog);
    return visible ? cached.public : cached.catalog;
  }
  const catalog = normalizeCatalog(JSON.parse(await readFile(file, 'utf8')));
  const entry = { mtimeMs: info.mtimeMs, ctimeMs: info.ctimeMs, size: info.size, catalog,
    ...(visible ? { public: publicCatalog(catalog) } : {}) };
  parsedCatalogs.set(file, entry);
  return visible ? entry.public : catalog;
}

export async function readCatalogCache(env = process.env) {
  try {
    return await readLocalCatalog(catalogCachePath(env), true);
  } catch {
    return null;
  }
}

function publicCatalog(catalog) {
  return {
    ...catalog,
    items: catalog.items.map(item => {
      if (item.state !== 'locked' && assetTier(item) !== 'pro') return item;
      const { files, ...visible } = item;
      return visible;
    }),
  };
}

/** The update preference is the shared source for shell and resolver automatic requests. */
export async function automaticChecksEnabled(env = process.env) {
  try {
    const settings = JSON.parse(await readFile(join(resolveAkariHome(env), 'update-preferences.json'), 'utf8'));
    return settings.autoCheck !== false;
  } catch {
    return true;
  }
}

export async function catalogNetworkAllowed(intent = 'user', env = process.env) {
  return intent !== 'automatic' || await automaticChecksEnabled(env);
}

export async function cacheCatalog(env = process.env, catalog) {
  const home = resolveAkariHome(env);
  await mkdir(home, { recursive: true });
  await writeFile(catalogCachePath(env), `${JSON.stringify(publicCatalog(normalizeCatalog(catalog)), null, 2)}\n`);
  parsedCatalogs.delete(catalogCachePath(env));
}

/**
 * カタログを読む。リモート取得が失敗した場合（オフライン等）はローカルキャッシュへ
 * フォールバックする（黙って劣化させるのではなく、キャッシュが無ければ明示的に失敗する）。
 */
export async function loadCatalog({ env = process.env, fetchImpl = fetch, includeInstalled = true, intent = 'user', timeouts, fallbackToCache = true } = {}) {
  const source = resolveCatalogSource(env);
  const installedItems = includeInstalled ? await loadInstalledItems(env) : [];
  let catalog;

  if (source.kind === 'url' && !await catalogNetworkAllowed(intent, env)) {
    catalog = await readCatalogCache(env) ?? { schema: 'akari-assets-catalog/v0', version: null, base: null, items: [] };
    return includeInstalled ? mergeInstalledItems(catalog, installedItems) : catalog;
  }

  if (source.kind === 'file') {
    catalog = await readLocalCatalog(source.value);
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
export async function loadCatalogForResolve(ref, { env = process.env, fetchImpl = fetch, timeouts } = {}) {
  // ref は category/id か bare id（resolve.mjs の findCatalogItem と同じ受け方）
  const matches = typeof ref === 'string' && ref.includes('/')
    ? item => `${item.category}/${item.id}` === ref
    : item => item.id === ref;
  const installedItems = await loadInstalledItems(env);
  if (installedItems.some(matches)) {
    return { schema: 'akari-assets-catalog/v0', version: null, base: null, items: installedItems };
  }
  if (resolveCatalogSource(env).kind === 'url') {
    const cached = await readCatalogCache(env);
    if (cached && cached.items.some(matches)) {
      return mergeInstalledItems(cached, installedItems);
    }
  }
  return loadCatalog({ env, fetchImpl, timeouts, fallbackToCache: false });
}

export { resolveEffectiveBase } from './env.mjs';
