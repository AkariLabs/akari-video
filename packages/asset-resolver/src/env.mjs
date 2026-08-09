// 環境変数・パス規約の一元化。
//
// AKARI_HOME は launcher の他コマンド（store-command.mjs 等）と同じ差し替え規約
// （テスト・隔離実行用に ~/.akari を上書きできる）。カタログ・素材ベースの取得元は
// 設計契約（notes-2026-08-04-asset-reference-distribution.md）どおり環境変数で差し替え可能にし、
// 未デプロイの間はローカルファイル / ローカルディレクトリを指すだけで開発できるようにする。

import os from 'node:os';
import path from 'node:path';

export const DEFAULT_CATALOG_URL = 'https://akari-oss.app/assets/catalog.json';
export const DEFAULT_STORE_API = 'https://akari-oss.app';
const CREDENTIALS_FILE = 'store-credentials.json';
const CATALOG_CACHE_FILE = 'catalog-cache.json';

/** http(s) URL かどうか（それ以外はローカルファイル/ディレクトリのパスとして扱う） */
export function isRemoteLocation(value) {
  return typeof value === 'string' && /^https?:\/\//i.test(value);
}

export function resolveAkariHome(env = process.env) {
  return env.AKARI_HOME || path.join(os.homedir(), '.akari');
}

/**
 * カタログの取得元。AKARI_ASSETS_CATALOG が URL ならリモート取得、
 * それ以外（未設定時の既定含む）はローカルパスとして解釈する。
 * 開発時は store リポの data/assets-catalog.json（レーン A 生成）を指す運用を想定。
 */
export function resolveCatalogSource(env = process.env) {
  const raw = env.AKARI_ASSETS_CATALOG || DEFAULT_CATALOG_URL;
  if (isRemoteLocation(raw)) {
    return { kind: 'url', value: raw };
  }
  return { kind: 'file', value: path.resolve(raw) };
}

/**
 * 素材実体の配信ベース。明示指定（AKARI_ASSETS_BASE）が無ければカタログ自身の "base"
 * フィールドを使う（akari-assets-catalog/v0 契約で必須）。ローカル開発では store リポの
 * dist-assets/ ディレクトリ等、ローカルディレクトリを指してもよい。
 */
export function resolveEffectiveBase(env = process.env, catalog) {
  const base = env.AKARI_ASSETS_BASE || catalog?.base;
  if (!base) {
    throw new Error('素材の配信ベースが決まりません（catalog.base 未設定・AKARI_ASSETS_BASE 未設定）');
  }
  return base;
}

export function resolveCredentialsPath(env = process.env) {
  return path.join(resolveAkariHome(env), CREDENTIALS_FILE);
}

export function catalogCachePath(env = process.env) {
  return path.join(resolveAkariHome(env), CATALOG_CACHE_FILE);
}

function trimTrailingSlash(value) {
  return value.replace(/\/+$/, '');
}

/**
 * entitlements API の URL。優先順位:
 *   1. AKARI_STORE_API（明示上書き。テスト・将来のホスト変更用）
 *   2. store-credentials.json の url（`akari store connect` が書き込む値。
 *      既に .../api/store まで含む — akari-launcher/src/store-command.mjs と同じ組み立て方に揃える）
 *   3. 既定ホスト（DEFAULT_STORE_API）
 */
export function resolveEntitlementsUrl(env = process.env, credentials) {
  if (env.AKARI_STORE_API) {
    return `${trimTrailingSlash(env.AKARI_STORE_API)}/api/store/v1/entitlements`;
  }
  if (credentials?.url) {
    return `${trimTrailingSlash(credentials.url)}/v1/entitlements`;
  }
  return `${DEFAULT_STORE_API}/api/store/v1/entitlements`;
}

/**
 * 有料配布物のダウンロード URL（`/api/store/v1/download/<productId>`。契約 §6/§8）。
 * 優先順位は resolveEntitlementsUrl と同一（AKARI_STORE_API → credentials.url → 既定ホスト）。
 */
export function resolveDownloadUrl(env = process.env, credentials, productId) {
  if (env.AKARI_STORE_API) {
    return `${trimTrailingSlash(env.AKARI_STORE_API)}/api/store/v1/download/${encodeURIComponent(productId)}`;
  }
  if (credentials?.url) {
    return `${trimTrailingSlash(credentials.url)}/v1/download/${encodeURIComponent(productId)}`;
  }
  return `${DEFAULT_STORE_API}/api/store/v1/download/${encodeURIComponent(productId)}`;
}
