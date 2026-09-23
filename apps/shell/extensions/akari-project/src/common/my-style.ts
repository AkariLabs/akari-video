/** Portable, library-owned style. Unknown parts are deliberately retained. */
export interface MyStyle {
    schema: 'akari-style/v0';
    id: string;
    name: string;
    when_to_use: string;
    parts: Array<{ kind: string; [key: string]: unknown }>;
    sample_text: string;
    created_at: string;
    updated_at: string;
    author?: string;
    license: string;
    version: number;
}

export const MY_STYLE_ID = /^[a-z0-9][a-z0-9-]*$/;
const POSITION_KEYS = new Set(['position', 'text_anchor', 'textAnchor', 'zone']);

function hasAbsolutePath(value: unknown): boolean {
    if (typeof value === 'string') {
        return value.startsWith('/') || value.startsWith('~/')
            || /^[A-Za-z]:[\\/]/.test(value) || value.startsWith('\\\\')
            || /^file:\/\//i.test(value);
    }
    if (Array.isArray(value)) return value.some(hasAbsolutePath);
    if (record(value)) return Object.values(value).some(hasAbsolutePath);
    return false;
}

function record(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Apply the same exclusion at read and write boundaries. */
export function portableLook(value: unknown): Record<string, unknown> {
    if (!record(value)) return {};
    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
        if (POSITION_KEYS.has(key) || key === 'animation') continue;
        result[key] = record(entry) ? portableLook(entry) : entry;
    }
    return result;
}

export function parseMyStyle(value: unknown): MyStyle {
    if (!record(value) || value.schema !== 'akari-style/v0'
        || typeof value.id !== 'string' || !MY_STYLE_ID.test(value.id)
        || typeof value.name !== 'string' || !value.name.trim()
        || typeof value.when_to_use !== 'string' || !value.when_to_use.trim()
        || !Array.isArray(value.parts) || value.parts.some(part => !record(part) || typeof part.kind !== 'string')
        || typeof value.sample_text !== 'string'
        || typeof value.created_at !== 'string' || typeof value.updated_at !== 'string'
        || typeof value.license !== 'string' || !value.license
        || typeof value.version !== 'number' || !Number.isInteger(value.version) || value.version < 1) {
        throw new Error('スタイルの保存形を確認できません。');
    }
    const style = value as unknown as MyStyle;
    if (hasAbsolutePath(style)) throw new Error('スタイルに絶対パスは保存できません。');
    return { ...style, parts: style.parts.map(part => part.kind === 'look'
        ? { ...part, text_style: portableLook(part.text_style) } : { ...part }) };
}

export function createMyStyle(input: Pick<MyStyle, 'id' | 'name' | 'when_to_use' | 'sample_text' | 'parts'>,
    now: string): MyStyle {
    return parseMyStyle({ schema: 'akari-style/v0', ...input, created_at: now, updated_at: now,
        license: 'private', version: 1 });
}

export function myStyleLook(style: MyStyle): Record<string, unknown> | undefined {
    const look = style.parts.find(part => part.kind === 'look');
    return look ? portableLook(look.text_style) : undefined;
}

export function ignoredMyStyleParts(style: MyStyle): string[] {
    return [...new Set(style.parts.filter(part => part.kind !== 'look').map(part => part.kind))];
}

const PART_LABELS: Readonly<Record<string, string>> = {
    look: '見た目', motion: '動き', sfx: '効果音', fx: '画面効果', decor: '装飾', camera: 'カメラ'
};

export function myStylePartLabel(kind: string): string {
    return PART_LABELS[kind] ?? kind;
}

/** Compact CSS sample for the library card; the saved value remains unchanged. */
export function myStyleSamplePresentation(style: MyStyle): Record<string, string | number> {
    const look = myStyleLook(style) ?? {};
    const stroke = record(look.stroke) ? look.stroke : {};
    const background = record(look.background) ? look.background : {};
    const shadow = record(look.shadow) ? look.shadow : {};
    const opacity = typeof background.opacity === 'number' ? Math.min(1, Math.max(0, background.opacity)) : 1;
    // The preview is smaller than the caption canvas. Keep every px dimension in the
    // same ratio as its text; a positive feature remains visible at subpixel size.
    const hasSize = typeof look.size_px === 'number' && look.size_px > 0;
    const sourceSize = hasSize ? look.size_px as number : 38;
    const previewSize = hasSize ? Math.min(22, Math.max(12, sourceSize * 0.28)) : 16;
    const scale = previewSize / sourceSize;
    const previewPx = (value: number): number => value > 0
        ? Math.max(0.5, Math.round(value * scale * 10) / 10) : 0;
    const presentation: Record<string, string | number> = {
        color: typeof look.color === 'string' ? look.color : '#ffffff',
        fontSize: previewSize,
        fontWeight: typeof look.weight === 'number' ? look.weight
            : typeof look.font_weight === 'number' ? look.font_weight : 700,
        borderRadius: typeof background.radius_px === 'number' ? `${previewPx(background.radius_px)}px` : '0px',
        padding: typeof background.padding_px === 'number' ? `${previewPx(background.padding_px)}px` : '2px 5px',
        paintOrder: 'stroke fill'
    };
    if (typeof stroke.width_px === 'number' && stroke.width_px > 0 && typeof stroke.color === 'string') {
        presentation.WebkitTextStroke = `${previewPx(stroke.width_px)}px ${stroke.color}`;
    }
    if (typeof background.color === 'string' && opacity > 0) {
        presentation.backgroundColor = `color-mix(in srgb, ${background.color} ${Math.round(opacity * 100)}%, transparent)`;
    }
    if (typeof shadow.color === 'string' && shadow.opacity !== 0) {
        const distance = previewPx(typeof shadow.distance_px === 'number' ? shadow.distance_px : 1);
        const angle = typeof shadow.angle_deg === 'number' ? shadow.angle_deg * Math.PI / 180 : Math.PI / 4;
        const x = Math.round(Math.cos(angle) * distance * 10) / 10;
        const y = Math.round(Math.sin(angle) * distance * 10) / 10;
        const blur = previewPx(typeof shadow.blur_px === 'number' ? shadow.blur_px : 2);
        const shadowOpacity = typeof shadow.opacity === 'number' ? Math.min(1, Math.max(0, shadow.opacity)) : 1;
        presentation.textShadow = `${x}px ${y}px ${blur}px color-mix(in srgb, ${shadow.color} ${Math.round(shadowOpacity * 100)}%, transparent)`;
    }
    return presentation;
}
