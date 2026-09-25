export interface InstanceHitMask {
    id: string;
    width: number;
    height: number;
    pixels: Uint8Array;
    invert?: boolean;
    area?: number;
}

/** Hit test an already produced mask at the source-normalized pointer position. */
export function hitPhotoInstance(point: readonly [number, number], masks: readonly InstanceHitMask[]): string | null {
    const [u, v] = point;
    if (!Number.isFinite(u) || !Number.isFinite(v) || u < 0 || u > 1 || v < 0 || v > 1) return null;
    let best: { id: string; area: number } | undefined;
    for (const mask of masks) {
        if (!Number.isInteger(mask.width) || !Number.isInteger(mask.height)
            || mask.width < 1 || mask.height < 1 || mask.pixels.length !== mask.width * mask.height) continue;
        const x = Math.min(mask.width - 1, Math.floor(u * mask.width));
        const y = Math.min(mask.height - 1, Math.floor(v * mask.height));
        const coverage = mask.pixels[y * mask.width + x]!;
        if ((mask.invert ? 255 - coverage : coverage) < 128) continue;
        const area = mask.area === undefined
            ? mask.pixels.reduce((count, value) => count + ((mask.invert ? value < 128 : value >= 128) ? 1 : 0), 0)
            : mask.invert ? mask.width * mask.height - mask.area : mask.area;
        if (!best || area < best.area) best = { id: mask.id, area };
    }
    return best?.id ?? null;
}
