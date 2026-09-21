// 合成ビュー: カタログ + ローカル取得状態 + entitlements を 1 リストにする。
// 「このアカウントで使える素材 = 無料全部 + 購入済み」の 1 ビュー（設計契約 §8）の核。

import { resolveAssetLibraryRoots } from '../../creator-root/src/index.mjs';
import { loadCatalog } from './catalog.mjs';
import { resolveAkariHome, resolveEffectiveBase, resolveEntitlementsUrl } from './env.mjs';
import { fetchEntitlements, readStoreCredentials } from './entitlements.mjs';
import { scanLocalLibrary } from './library.mjs';

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
export async function composeState({ env = process.env, fetchImpl = fetch } = {}) {
  const home = resolveAkariHome(env);
  const catalog = await loadCatalog({ env, fetchImpl });
  const hasCatalogItems = catalog.items.some((item) => item.source !== 'installed');
  const base = hasCatalogItems ? resolveEffectiveBase(env, catalog) : null;
  const installed = scanLocalLibrary(env);

  // entitlements API は有料商品が無ければ叩く必要がない（無駄な認証リクエストを避ける）
  const hasPaidItems = catalog.items.some((item) => (item.price ?? 0) > 0);
  const entitlementsResult = hasPaidItems
    ? await fetchEntitlements({ env, fetchImpl })
    : { ids: new Set(), status: await readStoreCredentials(env) ? 'ok' : 'no_credentials' };
  // entitlements.mjs は id/status だけを返し編集できないため、商品 kind/version は
  // 同じ API への 2 回目の fail-soft 取得で補う。
  const entitledProducts = await fetchEntitledProducts({ env, fetchImpl });

  const items = catalog.items.map((item) => {
    const key = `${item.category}/${item.id}`;
    const price = item.price ?? 0;
    let state;
    if (installed.has(key)) state = 'cached';
    else if (price > 0 && !entitlementsResult.ids.has(item.id)) state = 'locked';
    else state = 'available';
    return { ...item, state };
  });

  return {
    home,
    libraryRoots: resolveAssetLibraryRoots(env),
    base,
    catalogVersion: catalog.version ?? null,
    entitlementsStatus: entitlementsResult.status,
    entitledProducts,
    items,
  };
}
