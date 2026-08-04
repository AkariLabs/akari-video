// エンタイトルメント（購入済み商品）の取得。~/.akari/store-credentials.json が無ければ
// 無料素材のみ（`akari store connect` 未実行 = ログインしていない状態）。
// 取得失敗（オフライン・トークン失効等）も同じ「無料のみ」へフォールバックする
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

/** 購入済み商品 id の Set。取得できない場合は空集合（= 無料のみ使える）を返す */
export async function fetchEntitlements({ env = process.env, fetchImpl = fetch } = {}) {
  const credentials = await readStoreCredentials(env);
  if (!credentials) return new Set();

  const url = resolveEntitlementsUrl(env, credentials);
  try {
    const res = await fetchImpl(url, { headers: { authorization: `Bearer ${credentials.token}` } });
    if (!res.ok) return new Set();
    const data = await res.json();
    const list = Array.isArray(data?.entitlements) ? data.entitlements : [];
    const ids = list.map((entry) => (typeof entry === 'string' ? entry : entry?.product_id ?? entry?.id)).filter(Boolean);
    return new Set(ids);
  } catch {
    return new Set();
  }
}
