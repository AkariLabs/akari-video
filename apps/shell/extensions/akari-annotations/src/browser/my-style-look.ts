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
const LOOK_FIELDS: Readonly<Record<string, true | readonly string[]>> = {
    color: true, size_px: true, reference_height_px: true, font_family: true,
    font_weight: true, weight: true, line_height: true, letter_spacing_em: true,
    stroke: ['color', 'width_px'], background: ['color', 'opacity', 'radius_px', 'padding_px', 'mode'],
    shadow: ['color', 'opacity', 'blur_px', 'distance_px', 'angle_deg'],
    glow: ['color', 'density', 'spread', 'offset_x', 'offset_y']
};
const ULID_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function newMyStyleUid(now = Date.now()): string {
    let time = now;
    let prefix = '';
    for (let i = 0; i < 10; i++) { prefix = ULID_ALPHABET[time % 32] + prefix; time = Math.floor(time / 32); }
    const bytes = new Uint8Array(16);
    globalThis.crypto.getRandomValues(bytes);
    return prefix + Array.from(bytes, byte => ULID_ALPHABET[byte & 31]).join('');
}

export function newMyStyleSlug(name: string): string {
    const readable = name.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '').slice(0, 40) || 'my-style';
    return `${readable}-${crypto.randomUUID().slice(0, 8)}`;
}

export function myStyleOutputHeight(editSource: string): number {
    const edit = JSON.parse(editSource) as { output?: { height?: unknown } };
    const height = edit.output?.height;
    if (typeof height !== 'number' || !Number.isInteger(height) || height < 1) {
        throw new Error('出力解像度の高さを確認できません。');
    }
    return height;
}

function record(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Use the existing caption merge, then freeze only its visual fields. */
export function effectiveMyStyleLook(defaultStyle: CaptionTextStyle | undefined,
    captionStyle: CaptionTextStyle | undefined, referenceHeightPx?: number): Record<string, unknown> {
    const effective = mergeCaptionTextStyles(defaultStyle, captionStyle) as Record<string, unknown> | undefined;
    const convert = (source: Record<string, unknown>): Record<string, unknown> => Object.fromEntries(
        Object.entries(source).filter(([key]) => !SKIP.has(key)).map(([key, value]) => [
            KEYS[key] ?? key, record(value) ? convert(value) : value
        ])
    );
    const look = sanitizeMyStyleLook(convert(effective ?? {}));
    if (!record(look.stroke) || look.stroke.width_px === 0) look.stroke = { width_px: 0 };
    if (!record(look.background) || look.background.opacity === 0) look.background = { opacity: 0 };
    if (!record(look.shadow) || look.shadow.opacity === 0) look.shadow = { color: '#000000', opacity: 0 };
    if (!record(look.glow) || look.glow.density === 0) look.glow = { color: '#000000', density: 0 };
    if (referenceHeightPx !== undefined) look.reference_height_px = referenceHeightPx;
    return look;
}

/** layout and reference height are exclusive after default + cue merge (the preset is removed). */
export function assertMyStyleLayoutCompatible(defaultStyle: unknown, cueStyle: unknown): void {
    const base = record(defaultStyle) ? defaultStyle : {};
    const cue = record(cueStyle) ? cueStyle : {};
    const layout = cue.layout ?? base.layout;
    const height = cue.reference_height_px ?? cue.referenceHeightPx
        ?? base.reference_height_px ?? base.referenceHeightPx;
    if (layout !== undefined && height !== undefined) {
        throw new Error('既定のスタイルを含めて layout と基準高さが重なるため、マイスタイルを当てられません。');
    }
}

export function sanitizeMyStyleLook(value: unknown): Record<string, unknown> {
    if (!record(value)) return {};
    const look: Record<string, unknown> = {};
    for (const [key, allowed] of Object.entries(LOOK_FIELDS)) {
        if (!(key in value)) continue;
        const entry = value[key];
        if (allowed === true) look[key] = entry;
        else if (record(entry)) look[key] = Object.fromEntries(
            Object.entries(entry).filter(([field]) => allowed.includes(field)));
    }
    return look;
}

/** One source write replaces every look field and removes style_preset on all selected cues. */
export function replaceMyStyleLookInSource(source: string, ids: readonly string[], value: unknown): string {
    const look = sanitizeMyStyleLook(value);
    const document = JSON.parse(source) as unknown;
    const rows = Array.isArray(document) ? document
        : record(document) && Array.isArray(document.captions) ? document.captions : undefined;
    if (!rows) throw new Error('字幕データを読み取れません。');
    for (const id of new Set(ids)) {
        const matches = rows.filter(row => record(row) && row.id === id);
        if (matches.length !== 1) throw new Error(`字幕 ${id} が一意に見つかりません。`);
        const row = matches[0] as Record<string, unknown>;
        const before = record(row.text_style) ? row.text_style : {};
        const next = { ...before };
        for (const key of Object.keys(LOOK_FIELDS)) delete next[key];
        Object.assign(next, look);
        const defaultStyle = record(document) ? document.default_text_style : undefined;
        assertMyStyleLayoutCompatible(defaultStyle, next);
        if (Object.keys(next).length) row.text_style = next;
        else delete row.text_style;
        delete row.style_preset;
    }
    return `${JSON.stringify(document, null, 2)}\n`;
}

export interface MyStyleUsageEntry {
    caption_ids: string[];
    style_uid: string;
    revision: number;
    parts: string[];
    applied_at: string;
}

export function appendMyStyleUsage(source: string | undefined, entry: MyStyleUsageEntry): string {
    const document = source ? JSON.parse(source) as unknown : { version: 1, entries: [] };
    if (!record(document) || document.version !== 1 || !Array.isArray(document.entries)) {
        throw new Error('スタイル利用台帳の保存形を確認できません。');
    }
    return `${JSON.stringify({ ...document, entries: [...document.entries, entry] }, null, 2)}\n`;
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
    const top = new Set(['color', 'size_px', 'reference_height_px', 'font_weight', 'weight', 'line_height', 'letter_spacing_em',
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
export function placedMyStyleTextStyle(base: CaptionTextStyle | undefined, value: unknown,
    defaultStyle?: CaptionTextStyle): CaptionTextStyle {
    const look = sanitizeMyStyleLook(value);
    const patch = myStyleLookPatch(look);
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
    const next = { ...base } as Record<string, unknown>;
    for (const key of Object.keys(LOOK_FIELDS)) {
        const camel = Object.entries(KEYS).find(([, json]) => json === key)?.[0] ?? key;
        delete next[camel];
    }
    const result = { ...next, ...withoutNull(effects) as CaptionTextStyle,
        ...(typeof look.reference_height_px === 'number' ? { referenceHeightPx: look.reference_height_px } : {}) };
    assertMyStyleLayoutCompatible(defaultStyle, result);
    return result;
}
