// 合成ビュー: カタログ + ローカル取得状態 + entitlements を 1 リストにする。
// 「このアカウントで使える素材 = 無料全部 + 購入済み」の 1 ビュー（設計契約 §8）の核。

import { resolveAssetLibraryRoots } from '../../creator-root/src/index.mjs';
import { loadCatalog, catalogNetworkAllowed } from './catalog.mjs';
import { resolveAkariHome, resolveEffectiveBase, resolveEntitlementsUrl } from './env.mjs';
import { fetchEntitlements, readStoreCredentials } from './entitlements.mjs';
import { scanLocalLibrary, readLocalLibraryItem, sourceFields } from './library.mjs';
import { loadInstalledItems, mergeInstalledItems } from './installed.mjs';
import { assetTier, isAssetEntitled } from './tier.mjs';

async function fetchEntitledProducts({ env, fetchImpl }) {
  const credentials = await readStoreCredentials(env);
  if (!credentials) return [];
  try {
    const response = await fetchImpl(resolveEntitlementsUrl(env, credentials), {
      headers: { authorization: `Bearer ${credentials.token}` },
    });
    if (!response.ok) return [];
    const data = await response.json();
    if (!Array.isArray(data?.entitlements)) return [];
    return data.entitlements.flatMap((entry) => {
      if (typeof entry === 'string') {
        return entry ? [{ id: entry, kind: null, currentVersion: null }] : [];
      }
      const id = entry?.product_id ?? entry?.id;
      if (typeof id !== 'string' || !id) return [];
      return [{
        id,
        kind: typeof entry.kind === 'string' ? entry.kind : null,
        currentVersion: Number.isFinite(entry.current_version) ? entry.current_version : null,
      }];
    });
  } catch {
    return [];
  }
}

/**
 * @returns {Promise<{ home: string, base: string, catalogVersion: string|null, entitlementsStatus: 'ok'|'no_credentials'|'unauthorized'|'error', items: Array }>}
 * items の各要素はカタログ項目に `state`（'cached' | 'available' | 'locked'）を足したもの。
 */
export async function composeState({ env = process.env, fetchImpl = fetch, intent = 'user' } = {}) {
  const home = resolveAkariHome(env);
  const networkAllowed = await catalogNetworkAllowed(intent, env);
  const warnings = [];
  let remoteCatalog;
  try { remoteCatalog = await loadCatalog({ env, fetchImpl, includeInstalled: false, intent }); }
  catch (error) {
    warnings.push(error.message);
    remoteCatalog = { items: [], version: null };
  }
  const catalogKeys = new Set(remoteCatalog.items.map(item => `${item.category}/${item.id}`));
  let installedItems = [];
  try { installedItems = await loadInstalledItems(env); }
  catch (error) { warnings.push(error.message); }
  const catalog = mergeInstalledItems(remoteCatalog, installedItems);
  const hasCatalogItems = catalog.items.some((item) => item.source !== 'installed');
  let base = null;
  if (hasCatalogItems) {
    try { base = resolveEffectiveBase(env, catalog); }
    catch (error) { warnings.push(error.message); }
  }
  const installed = scanLocalLibrary(env);

  // Pro 素材が無ければ認証リクエストは不要。
  const hasProItems = catalog.items.some((item) => assetTier(item) === 'pro');
  const entitlementsResult = hasProItems && networkAllowed
    ? await fetchEntitlements({ env, fetchImpl, intent })
    : { ids: new Set(), status: await readStoreCredentials(env) ? 'ok' : 'no_credentials' };
  // entitlements.mjs は id/status だけを返し編集できないため、商品 kind/version は
  // 同じ API への 2 回目の fail-soft 取得で補う。
  const entitledProducts = networkAllowed ? await fetchEntitledProducts({ env, fetchImpl }) : [];

  const localItems = new Map([...installed].map(key => {
    const [category, id] = key.split('/');
    return [key, readLocalLibraryItem(env, category, id)];
  }));
  const merged = catalog.items.map(item => {
    const key = `${item.category}/${item.id}`;
    const local = localItems.get(key);
    localItems.delete(key);
    // Preserve remote download descriptors/preview keys for existing consumers.
    // Local-only assets use the actual directory listing assembled above.
    return local ? { ...item, ...local, tier: item.tier ?? assetTier(item), files: item.files ?? local.files, preview: item.preview ?? local.preview,
      ...(item.source === 'installed' ? { source: item.source } : {}) } : item;
  });
  merged.push(...[...localItems.values()].filter(Boolean));
  const items = merged.map((item) => {
    const key = `${item.category}/${item.id}`;
    const tier = assetTier(item);
    let state;
    if (installed.has(key)) state = 'cached';
    else if (tier === 'pro' && item.source !== 'installed' && !isAssetEntitled(item, entitlementsResult.ids)) state = 'locked';
    else state = 'available';
    const sources = sourceFields(item, catalogKeys.has(key) || item.source === 'installed');
    const machineTags = (sources.machineTags ?? item.machineTags ?? []).filter(tag => !tag.startsWith('tier:'));
    const visible = { ...item, tier, state, ...sources, machineTags: [...machineTags, `tier:${tier}`] };
    if (state === 'locked') delete visible.files;
    return visible;
  });

  return {
    home,
    libraryRoots: resolveAssetLibraryRoots(env),
    base,
    catalogVersion: catalog.version ?? null,
    entitlementsStatus: entitlementsResult.status,
    entitledProducts,
    warnings,
    items,
  };
}
