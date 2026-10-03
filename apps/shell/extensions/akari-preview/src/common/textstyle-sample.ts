import { resolveCaptionRichFillVars } from '@akari-video/edit-store/lib/caption-display';

/** One compact CSS specimen for the library shelf and the caption inspector. */
export const TEXTSTYLE_SHOWCASE_COMMAND_ID = 'akari.library.listTextstyleShowcase';
/** Mirrors caption-display's fallback font size until edit-store exports it. */
export const CAPTION_DEFAULT_SIZE_PX = 38;

/** React adds px to numeric lengths; direct DOM style assignment needs it explicitly. */
export function applyLibraryTextStyleSample(style: CSSStyleDeclaration,
    sample: Record<string, string | number>): void {
    for (const [key, value] of Object.entries(sample)) {
        (style as unknown as Record<string, string>)[key] = typeof value === 'number' && key === 'fontSize'
            ? `${value}px` : String(value);
    }
}

export function libraryTextStyleSample(raw: Record<string, unknown>): Record<string, string | number> {
    const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown> : {};
    const sourceSize = typeof raw.size_px === 'number' && raw.size_px > 0 ? raw.size_px : CAPTION_DEFAULT_SIZE_PX;
    const previewSize = 20;
    const ratio = previewSize / sourceSize;
    const px = (value: unknown): number => typeof value === 'number' ? value * ratio : 0;
    const stroke = object(raw.stroke);
    const background = object(raw.background);
    const shadow = object(raw.shadow);
    const glow = object(raw.glow);
    const result: Record<string, string | number> = {
        color: typeof raw.color === 'string' ? raw.color : '#ffffff',
        fontSize: previewSize,
        fontWeight: typeof raw.weight === 'number' ? raw.weight
            : typeof raw.font_weight === 'number' ? raw.font_weight : 700,
        fontFamily: typeof raw.font_family === 'string' ? raw.font_family : 'inherit',
        letterSpacing: typeof raw.letter_spacing_em === 'number' ? `${raw.letter_spacing_em}em` : 'normal',
        textTransform: typeof raw.text_transform === 'string' ? raw.text_transform : 'none',
        borderRadius: `${px(background.radius_px)}px`,
        padding: typeof background.padding_px === 'number' ? `${px(background.padding_px)}px` : '2px 5px',
        paintOrder: 'stroke fill'
    };
    if (typeof background.color === 'string' && background.opacity !== 0) {
        const opacity = typeof background.opacity === 'number' ? Math.max(0, Math.min(1, background.opacity)) : 1;
        result.backgroundColor = `color-mix(in srgb, ${background.color} ${Math.round(opacity * 100)}%, transparent)`;
    }
    const richStrokes = Array.isArray(raw.strokes) ? raw.strokes.filter(objectEntry =>
        objectEntry && typeof objectEntry === 'object' && !Array.isArray(objectEntry)) as Record<string, unknown>[] : [];
    const outer = richStrokes[0] ?? stroke;
    if (typeof outer.color === 'string' && typeof outer.width_px === 'number' && outer.width_px > 0) {
        result.WebkitTextStroke = `${Math.max(0.5, px(outer.width_px) * (richStrokes.length ? 2 : 1))}px ${outer.color}`;
    }
    const shadows: string[] = [];
    for (const layer of richStrokes.slice(1)) {
        if (typeof layer.color !== 'string' || typeof layer.width_px !== 'number') continue;
        const radius = px(layer.width_px);
        const offsetX = px(layer.offset_x);
        const offsetY = px(layer.offset_y);
        for (const [x, y] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-0.7, -0.7], [0.7, -0.7],
            [-0.7, 0.7], [0.7, 0.7]]) shadows.push(`${offsetX + x * radius}px ${offsetY + y * radius}px 0 ${layer.color}`);
    }
    if (typeof shadow.color === 'string' && shadow.opacity !== 0) {
        const angle = (typeof shadow.angle_deg === 'number' ? shadow.angle_deg : 45) * Math.PI / 180;
        const distance = px(shadow.distance_px);
        const blur = px(shadow.blur_px);
        const opacity = typeof shadow.opacity === 'number' ? Math.max(0, Math.min(1, shadow.opacity)) : 1;
        shadows.push(`${Math.cos(angle) * distance}px ${Math.sin(angle) * distance}px ${blur}px `
            + `color-mix(in srgb, ${shadow.color} ${Math.round(opacity * 100)}%, transparent)`);
    }
    if (typeof glow.color === 'string' && glow.density !== 0) {
        const strength = typeof glow.density === 'number' ? Math.max(0, Math.min(100, glow.density)) : 100;
        shadows.push(`${px(glow.offset_x)}px ${px(glow.offset_y)}px ${px(glow.spread)}px `
            + `color-mix(in srgb, ${glow.color} ${strength}%, transparent)`);
    }
    if (shadows.length) result.textShadow = shadows.join(', ');
    const fill = object(raw.fill);
    if (fill.type === 'solid' && typeof fill.color === 'string') result.color = fill.color;
    const pattern = object(fill.pattern);
    const richFill = fill.type === 'gradient' && typeof fill.angle_deg === 'number' && Array.isArray(fill.stops)
        && fill.stops.every(stop => typeof stop?.color === 'string' && typeof stop?.at === 'number')
        || fill.type === 'pattern' && typeof pattern.scale === 'number' && pattern.scale > 0
        && ['diamond', 'dot', 'stripe', 'gingham', 'skull', 'hazard', 'night', 'heart', 'thunder'].includes(String(pattern.id));
    if (richFill) {
        const vars = resolveCaptionRichFillVars(fill, ratio);
        result.backgroundImage = vars['--caption-rich-fill-image'];
        result.backgroundSize = vars['--caption-rich-fill-size'];
        result.backgroundPosition = vars['--caption-rich-fill-position'];
        result.backgroundClip = 'text';
        result.WebkitBackgroundClip = 'text';
        result.WebkitTextFillColor = 'transparent';
    }
    return result;
}
