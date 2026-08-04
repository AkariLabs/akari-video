import { resolve } from 'path';
import { pathToFileURL } from 'url';

/**
 * http(s) URL かどうか。packages/asset-resolver/src/env.mjs の isRemoteLocation と
 * 同じ判定規約だが、その ESM 実装は commonjs ビルドの動的 import では読み込めない
 * （akari-project-service.ts の loadResolverCatalogItems コメント参照）ため、
 * この 1 行だけを複製する。
 */
function isRemoteLocation(value: string | undefined): boolean {
    return typeof value === 'string' && /^https?:\/\//i.test(value);
}

/**
 * resolver カタログの `preview`（絶対 URL または base 相対キー）と `base`
 * （リモート URL またはローカルディレクトリパス）から、frontend の `<img src>` に
 * そのまま渡せる URL 文字列を組み立てる。
 * - preview が既に絶対 URL ならそのまま
 * - base がリモートなら WHATWG URL 解決で絶対 URL 化
 * - base がローカルパスなら絶対パス化して file: URI 化（thumbnail-cache.ts の
 *   流儀 — 実ファイルを読んで data URI にはしない。<img src="file://...">は
 *   既存のローカル素材サムネ表示で実績済みの経路）
 */
export function resolveResolverPreviewUrl(preview: string | undefined, base: string): string | undefined {
    if (!preview) {
        return undefined;
    }
    if (isRemoteLocation(preview)) {
        return preview;
    }
    if (isRemoteLocation(base)) {
        return new URL(preview, base).toString();
    }
    return pathToFileURL(resolve(base, preview)).toString();
}
