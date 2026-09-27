import { myStyleSamplePresentation, type MyStyle } from './my-style';

/** 同梱の見本だけを指す。ID はパス区切りを含めない。 */
export function shelfPreviewPath(kind: 'lut' | 'transition', id: string, strip = false): string | undefined {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) return undefined;
    if (kind === 'lut') return `presets/luts/${id}/preview.webp`;
    return `presets/transitions/${id}/${strip ? 'preview-strip.webp' : 'preview.webp'}`;
}

export function fontPreviewPath(id: string): string | undefined {
    return /^[a-z0-9][a-z0-9-]*$/.test(id) ? `catalog/font/${id}/preview.png` : undefined;
}

/** Reuse the My Style specimen renderer for catalog text styles. */
export function libraryTextStyleSample(raw: Record<string, unknown>): Record<string, string | number> {
    // myStyleSamplePresentation reads only parts; this adapter supplies a look part.
    const result = myStyleSamplePresentation({ parts: [{ kind: 'look', text_style: raw }] } as unknown as MyStyle);
    if (typeof raw.font_family === 'string') result.fontFamily = raw.font_family;
    if (typeof raw.letter_spacing_em === 'number') result.letterSpacing = `${raw.letter_spacing_em}em`;
    return result;
}
