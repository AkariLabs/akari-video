import type { VisualThumbnailCapture } from 'akari-preview/lib/common/visual-thumbnail';

export interface VisualThumbnailDiskEntry extends VisualThumbnailCapture {
    key: string;
    capturedAt: number;
    /** Restore the existing key's revision after retries or watched file edits. */
    sourceKey: string;
    dependencyRevision: number;
    dependencies: { uri: string; mtime: number; size: number }[];
}

/** Synchronous SHA-1 over UTF-8; this digest names cache files, not security credentials. */
export function visualThumbnailCacheFileName(key: string): string {
    const bytes = new TextEncoder().encode(key);
    const buffer = new Uint8Array(Math.ceil((bytes.length + 9) / 64) * 64);
    buffer.set(bytes); buffer[bytes.length] = 0x80;
    const view = new DataView(buffer.buffer);
    view.setUint32(buffer.length - 8, Math.floor(bytes.length / 0x20000000));
    view.setUint32(buffer.length - 4, bytes.length * 8);
    const state = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0];
    const words = new Uint32Array(80);
    const rotate = (value: number, bits: number): number => (value << bits) | (value >>> (32 - bits));
    for (let offset = 0; offset < buffer.length; offset += 64) {
        for (let i = 0; i < 16; i++) words[i] = view.getUint32(offset + i * 4);
        for (let i = 16; i < 80; i++) words[i] = rotate(words[i - 3] ^ words[i - 8] ^ words[i - 14] ^ words[i - 16], 1);
        let [a, b, c, d, e] = state;
        for (let i = 0; i < 80; i++) {
            const f = i < 20 ? (b & c) | (~b & d) : i < 40 ? b ^ c ^ d : i < 60 ? (b & c) | (b & d) | (c & d) : b ^ c ^ d;
            const k = i < 20 ? 0x5a827999 : i < 40 ? 0x6ed9eba1 : i < 60 ? 0x8f1bbcdc : 0xca62c1d6;
            const next = (rotate(a, 5) + f + e + k + words[i]) >>> 0;
            e = d; d = c; c = rotate(b, 30); b = a; a = next;
        }
        [a, b, c, d, e].forEach((value, i) => { state[i] = (state[i] + value) >>> 0; });
    }
    return state.map(value => value.toString(16).padStart(8, '0')).join('') + '.json';
}

export function pruneThumbnailIndex(entries: readonly { fileName: string; capturedAt: number; size: number }[],
    limits = { maxFiles: 400, maxBytes: 64 * 1024 * 1024 }): string[] {
    let count = entries.length;
    let bytes = entries.reduce((sum, entry) => sum + entry.size, 0);
    const removed: string[] = [];
    for (const entry of [...entries].sort((a, b) => a.capturedAt - b.capturedAt || a.fileName.localeCompare(b.fileName))) {
        if (count <= limits.maxFiles && bytes <= limits.maxBytes) break;
        removed.push(entry.fileName); count--; bytes -= entry.size;
    }
    return removed;
}

/** Corrupt/older records are misses; never let disk data escape into CSS or filesystem paths. */
export function isVisualThumbnailDiskEntry(value: unknown): value is VisualThumbnailDiskEntry {
    if (!value || typeof value !== 'object') return false;
    const entry = value as VisualThumbnailDiskEntry;
    const image = (data: unknown): boolean => typeof data === 'string' && /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(data);
    const rect = entry.contentRect;
    return typeof entry.key === 'string' && typeof entry.sourceKey === 'string'
        && Number.isSafeInteger(entry.dependencyRevision) && entry.dependencyRevision >= 0
        && Number.isFinite(entry.capturedAt) && entry.capturedAt >= 0 && image(entry.image)
        && (entry.croppedImage === undefined || image(entry.croppedImage))
        && (rect === undefined || !!rect && [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite)
            && rect.x >= 0 && rect.y >= 0 && rect.width > 0 && rect.height > 0)
        && Array.isArray(entry.dependencies) && entry.dependencies.every(dep => dep && typeof dep.uri === 'string'
            && Number.isFinite(dep.mtime) && Number.isFinite(dep.size) && dep.size >= 0);
}
