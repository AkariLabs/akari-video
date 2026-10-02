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
    const sourceSize = typeof raw.size_px === 'number' && raw.size_px > 0 ? raw.size_px : 38;
    const scale = Number(result.fontSize) / sourceSize;
    if (Array.isArray(raw.strokes)) {
        const outer = raw.strokes[0];
        if (outer && typeof outer === 'object' && typeof outer.color === 'string'
            && typeof outer.width_px === 'number' && outer.width_px > 0) {
            result.WebkitTextStroke = `${Math.max(0.5, outer.width_px * scale * 2)}px ${outer.color}`;
        }
    }
    const fill = raw.fill;
    if (fill && typeof fill === 'object' && !Array.isArray(fill)) {
        const value = fill as Record<string, unknown>;
        if (value.type === 'solid' && typeof value.color === 'string') result.color = value.color;
        if (value.type === 'gradient' && typeof value.angle_deg === 'number' && Array.isArray(value.stops)
            && value.stops.length >= 2 && value.stops.every(stop => stop && typeof stop === 'object'
                && typeof stop.at === 'number' && typeof stop.color === 'string')) {
            result.backgroundImage = `linear-gradient(${value.angle_deg}deg, ${value.stops.map(stop => `${stop.color} ${stop.at}%`).join(', ')})`;
            result.backgroundClip = 'text';
            result.WebkitBackgroundClip = 'text';
            result.WebkitTextFillColor = 'transparent';
        }
    }
    return result;
}

export function fitStyleSpecimen(stageWidth: number, stageHeight: number, width: number, height: number): number {
    return Math.min(1, Math.max(0.05, (stageWidth - 26) / Math.max(1, width)),
        Math.max(0.05, (stageHeight - 8) / Math.max(1, height)));
}
