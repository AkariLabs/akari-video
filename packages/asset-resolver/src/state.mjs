// 合成ビュー: カタログ + ローカル取得状態 + entitlements を 1 リストにする。
// 「このアカウントで使える素材 = 無料全部 + 購入済み」の 1 ビュー（設計契約 §8）の核。

import { loadCatalog } from './catalog.mjs';
import { resolveAkariHome, resolveEffectiveBase } from './env.mjs';
import { fetchEntitlements, readStoreCredentials } from './entitlements.mjs';
import { scanLocalLibrary } from './library.mjs';

/**
 * @returns {Promise<{ home: string, base: string, catalogVersion: string|null, entitlementsStatus: 'ok'|'no_credentials'|'unauthorized'|'error', items: Array }>}
 * items の各要素はカタログ項目に `state`（'cached' | 'available' | 'locked'）を足したもの。
 */
export async function composeState({ env = process.env, fetchImpl = fetch } = {}) {
  const home = resolveAkariHome(env);
  const catalog = await loadCatalog({ env, fetchImpl });
  const base = resolveEffectiveBase(env, catalog);
  const installed = scanLocalLibrary(home);

  // entitlements API は有料商品が無ければ叩く必要がない（無駄な認証リクエストを避ける）
  const hasPaidItems = catalog.items.some((item) => (item.price ?? 0) > 0);
  const entitlementsResult = hasPaidItems
    ? await fetchEntitlements({ env, fetchImpl })
    : { ids: new Set(), status: await readStoreCredentials(env) ? 'ok' : 'no_credentials' };

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
    base,
    catalogVersion: catalog.version ?? null,
    entitlementsStatus: entitlementsResult.status,
    items,
  };
}
