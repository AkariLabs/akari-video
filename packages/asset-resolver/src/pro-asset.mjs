// Pro item の記述子と店の HTTP 応答を検査する。ファイル取得前に全件を検査する。
import { AssetResolverError } from './errors.mjs';
import { resolveProAssetUrl } from './env.mjs';
import { fetchTimed, readTimedJson } from './fetch-file.mjs';

function timedOut(error) {
  return error instanceof Error && error.message.includes('時間切れ');
}

export function storeFailure(status, data, context) {
  const storeCode = typeof data?.error === 'string' ? data.error : undefined;
  const message = typeof data?.message === 'string' ? data.message : undefined;
  const details = [storeCode, message].filter(Boolean).join(': ');
  const error = new AssetResolverError(
    `${context}に失敗しました（HTTP ${status ?? '不明'}${details ? `: ${details}` : ''}）`,
    status === 401 || (status === 403 && storeCode === 'pro_required') ? 'locked' : 'download_failed',
  );
  error.status = status;
  error.storeCode = storeCode;
  return error;
}

function invalid(reason) {
  throw new AssetResolverError(`Pro 素材の記述子が不正です: ${reason}`, 'integrity');
}

export function validateProAssetDescriptor(data, item, descriptorUrl) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) invalid('JSON object が必要です');
  if (data.schema !== 'akari-pro-asset/v1') invalid('schema');
  if (data.category !== item.category || data.id !== item.id) invalid('category/id');
  if (!Number.isInteger(data.version) || data.version <= 0) invalid('version');
  if (!Array.isArray(data.files) || data.files.length === 0) invalid('files');
  const origin = new URL(descriptorUrl).origin;
  const names = new Set();
  for (const file of data.files) {
    if (!file || typeof file !== 'object' || Array.isArray(file)) invalid('file');
    const name = file.name;
    if (typeof name !== 'string' || !name || name.startsWith('/') || name.includes('\\') || name.includes('\0')
      || name.split('/').some(part => !part || part === '.' || part === '..')) invalid('name');
    if (names.has(name)) invalid('name が重複しています');
    names.add(name);
    if (typeof file.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(file.sha256)) invalid('sha256');
    if (!Number.isInteger(file.bytes) || file.bytes < 0) invalid('bytes');
    let url;
    try { url = new URL(file.url); } catch { invalid('url'); }
    if (!['http:', 'https:'].includes(url.protocol) || url.origin !== origin) invalid('url のオリジン');
  }
  if (!names.has('meta.json')) invalid('meta.json');
  return data;
}

/** 404 asset_not_found だけを null として返し、zip 予備経路へ渡す。 */
export async function fetchProAssetDescriptor(item, credentials, { env, fetchImpl, timeouts }) {
  const url = resolveProAssetUrl(env, credentials, item.category, item.id);
  let res;
  let controller;
  try {
    ({ response: res, controller } = await fetchTimed(url, {
      fetchImpl, request: { headers: { authorization: `Bearer ${credentials.token}` }, redirect: 'error' },
      timeouts, label: 'Pro 素材の記述子',
    }));
  } catch (error) {
    throw new AssetResolverError(`Pro 素材の記述子取得に失敗しました: ${error.message}`, timedOut(error) ? 'timeout' : 'download_failed');
  }
  let data;
  try {
    data = await readTimedJson(res, controller, { timeouts, label: 'Pro 素材の記述子' });
  } catch (error) {
    if (timedOut(error)) throw new AssetResolverError(error.message, 'timeout');
    if (res.ok) invalid('JSON');
    const failure = storeFailure(res.status, null, 'Pro 素材の記述子取得');
    if (res.status === 401) failure.message += '。トークン失効の可能性があります。akari store connect をやり直してください';
    throw failure;
  } finally {
    controller.abort();
  }
  if (!res.ok) {
    if (res.status === 404 && data?.error === 'asset_not_found') return null;
    if (res.status === 403 && data?.error === 'pro_required') {
      const error = new AssetResolverError(
        `Pro 素材は all-access-pass（Lifetime パス）または購入済み product_id が必要です: ${item.id}${data?.message ? `（${data.message}）` : ''}`,
        'locked',
      );
      error.status = res.status;
      error.storeCode = data.error;
      throw error;
    }
    if (res.status === 401) {
      const failure = storeFailure(res.status, data, 'Pro 素材の記述子取得');
      failure.message += '。トークン失効の可能性があります。akari store connect をやり直してください';
      throw failure;
    }
    throw storeFailure(res.status, data, 'Pro 素材の記述子取得');
  }
  return validateProAssetDescriptor(data, item, url);
}
