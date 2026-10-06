import { createHash } from 'crypto';
import { promises as fs } from 'fs';

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

/** A cheap PNG header probe avoids decoding a full-size catalog poster on the shelf path. */
export async function pngPreviewWidth(path: string): Promise<number | undefined> {
    const file = await fs.open(path, 'r');
    try {
        const header = Buffer.alloc(24);
        const { bytesRead } = await file.read(header, 0, header.length, 0);
        if (bytesRead < 24 || !header.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
            || header.toString('ascii', 12, 16) !== 'IHDR') return undefined;
        return header.readUInt32BE(16);
    } finally {
        await file.close();
    }
}
