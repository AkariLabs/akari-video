import { createHash } from 'crypto';

/**
 * 未分析サムネキャッシュのキー導出。ファイルの path + size + mtime 由来
 * （project-structure-v0 契約 §2-2: `.akari/cache/` は再生成可能・削除安全と定義されており、
 * 原本の内容が変わればキーも変わって再生成される必要がある）。
 */
export function deriveThumbnailCacheKey(relativePath: string, size: number, mtimeMs: number): string {
    const hash = createHash('sha256');
    hash.update(relativePath);
    hash.update(String(size));
    hash.update(String(Math.trunc(mtimeMs)));
    return hash.digest('hex').slice(0, 16);
}

export function thumbnailCacheFileName(key: string, extension: string): string {
    const normalized = extension.startsWith('.') ? extension : `.${extension}`;
    return `${key}${normalized.toLowerCase()}`;
}
