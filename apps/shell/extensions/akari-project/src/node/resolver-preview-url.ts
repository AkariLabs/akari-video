import { ResolverRawCatalogItem, selectResolverAudioFileRef } from '../common/asset-catalog-view';
import { basename, isAbsolute, relative, resolve } from 'path';
import { pathToFileURL } from 'url';
import { lstatSync, realpathSync, statSync } from 'fs';

/**
 * http(s) URL かどうか。packages/asset-resolver/src/env.mjs の isRemoteLocation と
 * 同じ判定規約だが、その ESM 実装は commonjs ビルドの動的 import では読み込めない
 * （akari-project-service.ts の loadResolverCatalogItems コメント参照）ため、
 * この 1 行だけを複製する。
 */
function isRemoteLocation(value: string | undefined): boolean {
    return typeof value === 'string' && /^https?:\/\//i.test(value);
}

function isSafeRelativeKey(value: string): boolean {
    let decoded: string;
    try { decoded = decodeURIComponent(value); } catch { return false; }
    return !decoded.startsWith('/') && !decoded.startsWith('\\')
        && !isAbsolute(decoded) && !/^[a-z][a-z0-9+.-]*:/i.test(decoded)
        && !decoded.split(/[\\/]/).includes('..');
}

function isWithinFile(root: string, candidate: string): boolean {
    try {
        const within = relative(realpathSync(root), realpathSync(candidate));
        return within !== '' && !within.startsWith('..') && !isAbsolute(within)
            && statSync(candidate).isFile();
    } catch {
        return false;
    }
}

function pathExists(path: string): boolean {
    try { lstatSync(path); return true; } catch { return false; }
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
    if (!isSafeRelativeKey(preview)) return undefined;
    if (isRemoteLocation(base)) {
        return new URL(preview, base).toString();
    }
    const candidate = resolve(base, preview);
    if (pathExists(candidate) && !isWithinFile(base, candidate)) return undefined;
    return pathToFileURL(candidate).toString();
}

function resolveCatalogImageUrl(ref: string | null | undefined, base: string | null, libraryDir?: string): string | undefined {
    if (!ref) return undefined;
    if (isRemoteLocation(ref)) return ref;
    if (!isSafeRelativeKey(ref)) return undefined;
    if (libraryDir) {
        for (const key of [ref, basename(ref)]) {
            const candidate = resolve(libraryDir, key);
            if (pathExists(candidate)) {
                return isWithinFile(libraryDir, candidate) ? pathToFileURL(candidate).toString() : undefined;
            }
        }
    }
    return base ? resolveResolverPreviewUrl(ref, base) : undefined;
}

/** 置き場の主メディアは file URI。Lab の相対サムネキー・複数テイク試聴も維持する。 */
export function resolveResolverCatalogUrls(item: ResolverRawCatalogItem, base: string | null): {
    previewUrl?: string; thumbUrl?: string; previewStripUrl?: string; mediaUrl?: string
} {
    const audioRef = selectResolverAudioFileRef(item);
    return {
        previewUrl: resolveCatalogImageUrl(item.preview, base, item.libraryDir),
        ...(item.thumb ? { thumbUrl: resolveCatalogImageUrl(item.thumb, base, item.libraryDir) } : {}),
        ...(item.preview_strip ? { previewStripUrl: resolveCatalogImageUrl(item.preview_strip, base, item.libraryDir) } : {}),
        mediaUrl: item.libraryDir && item.mediaFile
            ? pathToFileURL(resolve(item.libraryDir, item.mediaFile)).toString()
            : base || isRemoteLocation(audioRef) ? resolveResolverPreviewUrl(audioRef, base ?? '') : undefined
    };
}
