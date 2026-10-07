export { libraryTextStyleSample } from 'akari-preview/lib/common/textstyle-sample';

/** 同梱の見本だけを指す。ID はパス区切りを含めない。 */
export function shelfPreviewPath(kind: 'lut' | 'transition', id: string, strip = false): string | undefined {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) return undefined;
    if (kind === 'lut') return `presets/luts/${id}/preview.webp`;
    return `presets/transitions/${id}/${strip ? 'preview-strip.webp' : 'preview.webp'}`;
}

export function fontPreviewPath(id: string): string | undefined {
    return /^[a-z0-9][a-z0-9-]*$/.test(id) ? `catalog/font/${id}/row.webp` : undefined;
}

export function fitStyleSpecimen(stageWidth: number, stageHeight: number, width: number, height: number): number {
    return Math.min(1, Math.max(0.05, (stageWidth - 26) / Math.max(1, width)),
        Math.max(0.05, (stageHeight - 8) / Math.max(1, height)));
}
