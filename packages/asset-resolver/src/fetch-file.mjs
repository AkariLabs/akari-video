// カタログの files[] / preview を実ロケーション（リモート URL かローカルパスか）に解決し、
// 一時ディレクトリへ実体化する（ダウンロード or ファイルコピー）。
//
// akari-assets-catalog/v0 契約: files[] の各エントリは "url"（絶対 URL）か "key"（base からの
// 相対キー）のどちらか一方を持つ。base 自体は http(s) の場合もローカルディレクトリの場合もある
// （開発時は store リポのローカル出力を指す運用）。

import { createWriteStream } from 'node:fs';
import { copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { isRemoteLocation } from './env.mjs';

export const DEFAULT_FETCH_TIMEOUTS = { responseMs: 15_000, idleMs: 30_000 };

function deadline(promise, ms, label, abort) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error(label + 'が時間切れになりました（' + Math.ceil(ms / 1000) + ' 秒応答がありません）'));
        abort();
      }, ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

export async function fetchTimed(url, { fetchImpl = fetch, request = {}, timeouts = DEFAULT_FETCH_TIMEOUTS, label = '通信' } = {}) {
  const controller = new AbortController();
  const response = await deadline(
    Promise.resolve().then(() => fetchImpl(url, { ...request, signal: controller.signal })),
    timeouts.responseMs ?? DEFAULT_FETCH_TIMEOUTS.responseMs, label + 'の接続・応答開始', () => controller.abort(),
  );
  return { response, controller };
}

export async function* timedBody(body, controller, { timeouts = DEFAULT_FETCH_TIMEOUTS, label = '通信' } = {}) {
  const reader = body.getReader();
  try {
    while (true) {
      const { done, value } = await deadline(reader.read(), timeouts.idleMs ?? DEFAULT_FETCH_TIMEOUTS.idleMs,
        label + 'の転送', () => controller.abort());
      if (done) return;
      yield value;
    }
  } finally {
    controller.abort();
    void reader.cancel().catch(() => {});
  }
}

export async function readTimedJson(response, controller, options = {}) {
  if (!response.body) {
    return deadline(response.json(), options.timeouts?.idleMs ?? DEFAULT_FETCH_TIMEOUTS.idleMs,
      (options.label ?? '通信') + 'の転送', () => controller.abort());
  }
  const chunks = [];
  for await (const chunk of timedBody(response.body, controller, options)) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function joinRemote(base, key) {
  const withSlash = base.endsWith('/') ? base : `${base}/`;
  return new URL(key, withSlash).toString();
}

/** files[] エントリ 1 件を { location, remote } に解決する */
export function resolveFileLocation(base, fileEntry) {
  if (fileEntry.local_path) {
    return { location: fileEntry.local_path, remote: false };
  }
  if (fileEntry.url) {
    if (!isRemoteLocation(fileEntry.url)) {
      throw new Error(`files[].url は絶対 URL である必要があります: ${fileEntry.url}`);
    }
    return { location: fileEntry.url, remote: true };
  }
  if (fileEntry.key) {
    if (isRemoteLocation(base)) {
      return { location: joinRemote(base, fileEntry.key), remote: true };
    }
    return { location: path.join(base, fileEntry.key), remote: false };
  }
  throw new Error('files[] エントリに local_path / url / key のいずれかが必要です');
}

/**
 * preview（サムネ/試聴）フィールドの解決。すでに絶対 URL ならそのまま、
 * そうでなければ files[] の key と同じ規約（base 相対）として扱う。
 */
export function resolvePreviewLocation(base, preview) {
  if (!preview) return null;
  if (isRemoteLocation(preview)) return { location: preview, remote: true };
  if (isRemoteLocation(base)) return { location: joinRemote(base, preview), remote: true };
  return { location: path.join(base, preview), remote: false };
}

/** 解決済みロケーションを destPath へ実体化する（リモートは fetch、ローカルはファイルコピー） */
export async function materialize({ location, remote }, destPath, { fetchImpl = fetch, timeouts, request } = {}) {
  await mkdir(path.dirname(destPath), { recursive: true });
  if (remote) {
    const { response: res, controller } = await fetchTimed(location, { fetchImpl, request, timeouts, label: '素材ファイル' });
    if (!res.ok || !res.body) {
      if (!request) throw new Error(`ダウンロード失敗: ${location} → HTTP ${res.status}`);
      let detail = '';
      let storeCode;
      try {
        const data = await readTimedJson(res, controller, { timeouts, label: '素材ファイル' });
        storeCode = typeof data?.error === 'string' ? data.error : undefined;
        detail = [storeCode, typeof data?.message === 'string' ? data.message : ''].filter(Boolean).join(': ');
      } catch (error) {
        if (error instanceof Error && error.message.includes('時間切れ')) throw error;
        // エラー本文が JSON でない場合も HTTP status を残す。
      }
      controller.abort();
      const error = new Error(`ダウンロード失敗: ${location} → HTTP ${res.status}${detail ? ` (${detail})` : ''}`);
      error.status = res.status;
      error.storeCode = storeCode;
      throw error;
    }
    await pipeline(Readable.from(timedBody(res.body, controller, { timeouts, label: '素材ファイル' })), createWriteStream(destPath));
    return;
  }
  await copyFile(location, destPath);
}
