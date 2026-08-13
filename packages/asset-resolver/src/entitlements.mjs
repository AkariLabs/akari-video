// エンタイトルメント（購入済み商品）の取得。~/.akari/store-credentials.json が無ければ
// 無料素材のみ（`akari store connect` 未実行 = ログインしていない状態）。
// 取得失敗（オフライン・トークン失効等）も同じ「無料のみ」へフォールバックするが、
// status は呼び出し側へ返して UI が失効・取得失敗を可視化できるようにする
// （設計契約: 「entitlements 不明」は fail-closed ではなく無料のみへ倒す。有料の resolve
// 自体は別途 fail-closed で拒否するので、ここで例外を投げて全体を止める必要はない）。

import { readFile } from 'node:fs/promises';
import { resolveCredentialsPath, resolveEntitlementsUrl } from './env.mjs';

export async function readStoreCredentials(env = process.env) {
  try {
    const parsed = JSON.parse(await readFile(resolveCredentialsPath(env), 'utf8'));
    if (typeof parsed?.token !== 'string' || !parsed.token) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * 購入済み商品 id の Set + 取得結果。取得できない場合も ids は空集合
 * （= 無料のみ使える）のままで、既存のフォールバックを変えない。
 * @returns {Promise<{ ids: Set<string>, status: 'ok'|'no_credentials'|'unauthorized'|'error' }>}
 */
export async function fetchEntitlements({ env = process.env, fetchImpl = fetch } = {}) {
  const credentials = await readStoreCredentials(env);
  if (!credentials) return { ids: new Set(), status: 'no_credentials' };

  const url = resolveEntitlementsUrl(env, credentials);
  try {
    const res = await fetchImpl(url, { headers: { authorization: `Bearer ${credentials.token}` } });
    if (res.status === 401 || res.status === 403) {
      return { ids: new Set(), status: 'unauthorized' };
    }
    let data;
    try {
      data = await res.json();
    } catch {
      return { ids: new Set(), status: 'error' };
    }
    if (data?.error === 'token_revoked') {
      return { ids: new Set(), status: 'unauthorized' };
    }
    if (!res.ok) return { ids: new Set(), status: 'error' };
    const list = Array.isArray(data?.entitlements) ? data.entitlements : [];
    const ids = list.map((entry) => (typeof entry === 'string' ? entry : entry?.product_id ?? entry?.id)).filter(Boolean);
    return { ids: new Set(ids), status: 'ok' };
  } catch {
    return { ids: new Set(), status: 'error' };
  }
}
