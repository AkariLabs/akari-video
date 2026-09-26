import type { CaptionTextStyle, CaptionTextStylePatch } from './caption-store';
export { CAPTION_FONT_FAMILY } from 'akari-preview/lib/common/caption-visual-contract';

export type CaptionPanel = 'font' | 'style';

export function nextCaptionPanel(current: CaptionPanel | null, requested: CaptionPanel,
    hasTextSelection: boolean): CaptionPanel | null {
    return hasTextSelection ? current === requested ? null : requested : null;
}

export function retainCaptionPanel(current: CaptionPanel | null, hasTextSelection: boolean): CaptionPanel | null {
    return hasTextSelection ? current : null;
}

export function captionPanelChangedDetail(panel: CaptionPanel | null): { panel: CaptionPanel | null } {
    return { panel };
}

export function captionPanelLookWrite(id: string, look: Record<string, unknown>): {
    kind: 'caption-style-my-style'; id: string; value: { parts: Array<{ kind: 'look'; text_style: Record<string, unknown> }> }
} {
    return { kind: 'caption-style-my-style', id, value: { parts: [{ kind: 'look', text_style: look }] } };
}

/** The existing effect patch accepts all visual fields without freezing inherited defaults. */
export function captionPanelFontWrite(id: string, family: string, weight?: number): {
    kind: 'caption-style-effect'; id: string; value: CaptionTextStylePatch
} {
    return { kind: 'caption-style-effect', id, value: {
        fontFamily: family, ...(weight === undefined ? {} : { fontWeight: weight, weight })
    } };
}

export function filterCaptionFonts<T extends { title: string; family: string; tags: readonly string[] }>(
    fonts: readonly T[], query: string, selected: ReadonlySet<string>): T[] {
    const needle = query.trim().toLocaleLowerCase();
    return fonts.filter(font => (!needle || `${font.title} ${font.family}`.toLocaleLowerCase().includes(needle))
        && [...selected].every(tag => font.tags.includes(tag)));
}

export function renderableCaptionFonts<T extends { id: string }>(fonts: readonly T[],
    faces: ReadonlyMap<string, string>): T[] {
    return fonts.filter(font => faces.has(font.id));
}

export function captionFontRowDetail(tags: readonly string[]): string {
    return `Aa Bb 123 · 同梱${tags.includes('japanese') ? '' : ' · 日本語は代わりの書体で表示'}`;
}

/** Only verified, bundled font files get weight choices. Reference fonts have no known local axes. */
export function captionFontWeights(id: string): readonly number[] {
    const weights: Record<string, readonly number[]> = {
        'biz-udgothic': [400, 700],
        'dela-gothic-one': [400],
        'dotgothic16': [400],
        'klee-one': [400],
        'mplus-rounded-1c': [500, 800, 900],
        'noto-sans-jp': [100, 200, 300, 400, 500, 600, 700, 800, 900],
        'noto-serif-jp': [200, 300, 400, 500, 600, 700, 800, 900],
        'shippori-mincho': [400],
        'zen-maru-gothic': [400, 700]
    };
    return weights[id] ?? [];
}

type StyleRecord = Record<string, unknown>;
const object = (value: unknown): StyleRecord => value && typeof value === 'object' && !Array.isArray(value)
    ? value as StyleRecord : {};
const numeric = (value: unknown): number | undefined => typeof value === 'number' && Number.isFinite(value) ? value : undefined;
const string = (value: unknown): string | undefined => typeof value === 'string' ? value : undefined;

/** Catalog preset and My Style look fields use snake_case; captions use camelCase. */
export function captionPanelTextStyle(raw: StyleRecord): CaptionTextStyle {
    const stroke = object(raw.stroke);
    const background = object(raw.background);
    const shadow = object(raw.shadow);
    return {
        color: string(raw.color), sizePx: numeric(raw.size_px), fontFamily: string(raw.font_family),
        weight: numeric(raw.weight) ?? numeric(raw.font_weight), letterSpacingEm: numeric(raw.letter_spacing_em),
        stroke: { color: string(stroke.color), widthPx: numeric(stroke.width_px) },
        background: { color: string(background.color), opacity: numeric(background.opacity),
            paddingPx: numeric(background.padding_px), radiusPx: numeric(background.radius_px),
            mode: background.mode === 'block' ? 'block' : 'per-line' },
        ...(string(shadow.color) ? { shadow: { color: string(shadow.color)!, opacity: numeric(shadow.opacity),
            blurPx: numeric(shadow.blur_px), distancePx: numeric(shadow.distance_px),
            angleDeg: numeric(shadow.angle_deg) } } : {})
    };
}
