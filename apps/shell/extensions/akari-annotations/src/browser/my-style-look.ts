import { mergeCaptionTextStyles, type CaptionTextStyle, type CaptionTextStylePatch } from '../common/caption-store';

const KEYS: Readonly<Record<string, string>> = {
    sizePx: 'size_px', referenceHeightPx: 'reference_height_px', fontFamily: 'font_family',
    fontWeight: 'font_weight', letterSpacingEm: 'letter_spacing_em', lineHeight: 'line_height',
    verticalAlign: 'vertical_align', textTransform: 'text_transform', maxWidthPct: 'max_width_pct',
    maxCharacters: 'max_characters', widthPx: 'width_px', radiusPx: 'radius_px', paddingPx: 'padding_px',
    widthPct: 'width_pct', heightPct: 'height_pct', offsetX: 'offset_x', offsetY: 'offset_y',
    blurPx: 'blur_px', distancePx: 'distance_px', angleDeg: 'angle_deg', spread: 'spread'
};
const SKIP = new Set(['position', 'textAnchor', 'text_anchor', 'zone', 'animation', 'layout']);

function record(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Use the existing caption merge, then freeze only its visual fields. */
export function effectiveMyStyleLook(defaultStyle: CaptionTextStyle | undefined,
    captionStyle: CaptionTextStyle | undefined): Record<string, unknown> {
    const effective = mergeCaptionTextStyles(defaultStyle, captionStyle) as Record<string, unknown> | undefined;
    const convert = (source: Record<string, unknown>): Record<string, unknown> => Object.fromEntries(
        Object.entries(source).filter(([key]) => !SKIP.has(key)).map(([key, value]) => [
            KEYS[key] ?? key, record(value) ? convert(value) : value
        ])
    );
    const look = convert(effective ?? {});
    // Explicit absence is distinct from an omitted field: it clears an effect on the target.
    if (!('shadow' in look)) look.shadow = null;
    if (!('glow' in look)) look.glow = null;
    if (!('stroke' in look)) look.stroke = { width_px: 0 };
    if (!('background' in look)) look.background = { opacity: 0 };
    return look;
}

/** The v0 write route accepts these look fields as one patch and one undo entry. */
export function myStyleLookPatch(value: unknown): CaptionTextStylePatch {
    if (!record(value)) return {};
    const patch: CaptionTextStylePatch = {};
    if (typeof value.color === 'string') patch.color = value.color;
    if (typeof value.size_px === 'number') patch.sizePx = value.size_px;
    if (typeof value.font_weight === 'number') patch.fontWeight = value.font_weight;
    if (typeof value.weight === 'number') patch.weight = value.weight;
    if (typeof value.line_height === 'number') patch.lineHeight = value.line_height;
    if (typeof value.letter_spacing_em === 'number') patch.letterSpacingEm = value.letter_spacing_em;
    if (typeof value.font_family === 'string') patch.fontFamily = value.font_family;
    if (record(value.stroke)) {
        patch.stroke = {
            ...(typeof value.stroke.color === 'string' ? { color: value.stroke.color } : {}),
            ...(typeof value.stroke.width_px === 'number' ? { widthPx: value.stroke.width_px } : {})
        };
    }
    if (record(value.background)) {
        patch.background = {
            ...(typeof value.background.color === 'string' ? { color: value.background.color } : {}),
            ...(typeof value.background.opacity === 'number' ? { opacity: value.background.opacity } : {}),
            ...(typeof value.background.radius_px === 'number' ? { radiusPx: value.background.radius_px } : {}),
            ...(typeof value.background.padding_px === 'number' ? { paddingPx: value.background.padding_px } : {}),
            ...(typeof value.background.mode === 'string' ? { mode: value.background.mode as NonNullable<CaptionTextStylePatch['background']>['mode'] } : {})
        };
    }
    if (value.shadow === null) patch.shadow = null;
    else if (record(value.shadow)) patch.shadow = {
        color: String(value.shadow.color ?? '#000000'),
        ...(typeof value.shadow.opacity === 'number' ? { opacity: value.shadow.opacity } : {}),
        ...(typeof value.shadow.blur_px === 'number' ? { blurPx: value.shadow.blur_px } : {}),
        ...(typeof value.shadow.distance_px === 'number' ? { distancePx: value.shadow.distance_px } : {}),
        ...(typeof value.shadow.angle_deg === 'number' ? { angleDeg: value.shadow.angle_deg } : {})
    };
    if (value.glow === null) patch.glow = null;
    else if (record(value.glow)) patch.glow = {
        color: String(value.glow.color ?? '#000000'),
        ...(typeof value.glow.density === 'number' ? { density: value.glow.density } : {}),
        ...(typeof value.glow.spread === 'number' ? { spread: value.glow.spread } : {}),
        ...(typeof value.glow.offset_x === 'number' ? { offsetX: value.glow.offset_x } : {}),
        ...(typeof value.glow.offset_y === 'number' ? { offsetY: value.glow.offset_y } : {})
    };
    return patch;
}

export function unsupportedMyStyleLookFields(value: unknown): string[] {
    if (!record(value)) return [];
    const top = new Set(['color', 'size_px', 'font_weight', 'weight', 'line_height', 'letter_spacing_em',
        'font_family', 'shadow', 'glow', 'stroke', 'background']);
    const nested: Readonly<Record<string, ReadonlySet<string>>> = {
        stroke: new Set(['color', 'width_px']),
        background: new Set(['color', 'opacity', 'radius_px', 'padding_px', 'mode']),
        shadow: new Set(['color', 'opacity', 'blur_px', 'distance_px', 'angle_deg']),
        glow: new Set(['color', 'density', 'spread', 'offset_x', 'offset_y'])
    };
    return [
        ...Object.keys(value).filter(key => !top.has(key)),
        ...Object.entries(nested).flatMap(([key, allowed]) => record(value[key])
            ? Object.keys(value[key]).filter(field => !allowed.has(field)).map(field => `${key}.${field}`) : [])
    ];
}

const PART_LABELS: Readonly<Record<string, string>> = {
    look: '見た目', motion: '動き', sfx: '効果音', fx: '画面効果', decor: '装飾', camera: 'カメラ'
};
const FIELD_LABELS: Readonly<Record<string, string>> = {
    italic: '斜体', underline: '下線', align: '文字揃え', vertical: '縦書き',
    'background.width_pct': '座布団の幅', 'background.height_pct': '座布団の高さ',
    max_width_pct: '文字の最大幅', text_transform: '文字変換'
};

export function myStyleApplyNotice(parts: readonly { kind: string; text_style?: unknown }[]): string | undefined {
    const look = parts.find(part => part.kind === 'look');
    const ignored = [...new Set([
        ...parts.filter(part => part.kind !== 'look').map(part => PART_LABELS[part.kind] ?? part.kind),
        ...unsupportedMyStyleLookFields(look?.text_style).map(field => FIELD_LABELS[field] ?? field)
    ])];
    if (!ignored.length) return undefined;
    const labels = ignored.length > 3 ? `${ignored.slice(0, 3).join('・')}ほか` : ignored.join('・');
    return `${labels} は v0 では当てません。${look ? '見た目を当てました。' : ''}`;
}

/** Put the look in the new cue before insertCaption, keeping its default position. */
export function placedMyStyleTextStyle(base: CaptionTextStyle | undefined, value: unknown): CaptionTextStyle {
    const patch = myStyleLookPatch(value);
    const effects = {
        ...patch,
        ...(patch.shadow === null ? { shadow: { color: '#000000', opacity: 0 } } : {}),
        ...(patch.glow === null ? { glow: { color: '#000000', density: 0 } } : {})
    };
    const withoutNull = (input: unknown): unknown => {
        if (!record(input)) return input;
        return Object.fromEntries(Object.entries(input)
            .filter(([, entry]) => entry !== null && entry !== undefined)
            .map(([key, entry]) => [key, record(entry) ? withoutNull(entry) : entry]));
    };
    return { ...base, ...withoutNull(effects) as CaptionTextStyle };
}
