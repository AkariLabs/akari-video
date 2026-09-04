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
export async function materialize({ location, remote }, destPath, { fetchImpl = fetch } = {}) {
  await mkdir(path.dirname(destPath), { recursive: true });
  if (remote) {
    const res = await fetchImpl(location);
    if (!res.ok || !res.body) {
      throw new Error(`ダウンロード失敗: ${location} → HTTP ${res.status}`);
    }
    await pipeline(Readable.fromWeb(res.body), createWriteStream(destPath));
    return;
  }
  await copyFile(location, destPath);
}
