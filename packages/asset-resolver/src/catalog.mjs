// カタログ（akari-assets-catalog/v0）の取得。リモート URL は fetch → 成功したら
// ~/.akari/catalog-cache.json へ自動キャッシュ（オフライン時のフォールバック）。
// ローカルパス指定（開発・テスト）はファイルをそのまま読む。

import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { catalogCachePath, resolveAkariHome, resolveCatalogSource } from './env.mjs';

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
export async function loadCatalog({ env = process.env, fetchImpl = fetch } = {}) {
  const source = resolveCatalogSource(env);

  if (source.kind === 'file') {
    const raw = await readFile(source.value, 'utf8');
    return normalizeCatalog(JSON.parse(raw));
  }

  try {
    const res = await fetchImpl(source.value);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const catalog = normalizeCatalog(await res.json());
    await cacheCatalog(env, catalog);
    return catalog;
  } catch (error) {
    const cached = await readCatalogCache(env);
    if (cached) return cached;
    throw new Error(
      `カタログを取得できず、キャッシュもありません（${source.value}）: ${
        error instanceof Error ? error.message : String(error)
      }。オンライン環境で先に \`akari-assets sync\` を実行してください`,
    );
  }
}

export { resolveEffectiveBase } from './env.mjs';
