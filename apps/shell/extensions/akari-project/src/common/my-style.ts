/** Portable, library-owned style. Unknown parts are deliberately retained. */
export interface MyStyle {
    schema: 'akari-style';
    uid: string;
    id: string;
    name: string;
    when_to_use: string;
    parts: Array<{ kind: string; [key: string]: unknown }>;
    sample_text: string;
    created_at: string;
    updated_at: string;
    author?: string;
    license: { spdx: string; scope: string; attribution_required: boolean; ai_training_allowed: boolean };
    visibility: 'private' | 'shared';
    price: null;
    requires: unknown[];
    provenance: Record<string, unknown>;
    tags: string[];
    version: 1;
    revision: number;
}

export const MY_STYLE_ID = /^[a-z0-9][a-z0-9-]*$/;
const LOOK_FIELDS: Readonly<Record<string, true | readonly string[]>> = {
    color: true, size_px: true, reference_height_px: true, font_family: true,
    font_weight: true, weight: true, line_height: true, letter_spacing_em: true,
    stroke: ['color', 'width_px'], background: ['color', 'opacity', 'radius_px', 'padding_px', 'mode'],
    shadow: ['color', 'opacity', 'blur_px', 'distance_px', 'angle_deg'],
    glow: ['color', 'density', 'spread', 'offset_x', 'offset_y']
};
const ULID = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const STRING_LOOK_FIELDS = new Set(['color', 'font_family', 'mode']);

export function createMyStyleUid(now = Date.now()): string {
    let time = now;
    let prefix = '';
    for (let i = 0; i < 10; i++) { prefix = ALPHABET[time % 32] + prefix; time = Math.floor(time / 32); }
    const bytes = new Uint8Array(16);
    globalThis.crypto.getRandomValues(bytes);
    return prefix + Array.from(bytes, byte => ALPHABET[byte & 31]).slice(0, 16).join('');
}

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
        const fields = LOOK_FIELDS[key];
        if (!fields) continue;
        if (fields === true) result[key] = entry;
        else if (record(entry)) result[key] = Object.fromEntries(
            Object.entries(entry).filter(([field]) => fields.includes(field)));
    }
    return result;
}

export function parseMyStyle(value: unknown): MyStyle {
    if (!record(value) || value.schema !== 'akari-style' || value.version !== 1
        || typeof value.uid !== 'string' || !ULID.test(value.uid)
        || !Number.isInteger(value.revision) || (value.revision as number) < 1
        || typeof value.id !== 'string' || !MY_STYLE_ID.test(value.id)
        || typeof value.name !== 'string' || !value.name.trim()
        || typeof value.when_to_use !== 'string' || !value.when_to_use.trim()
        || !Array.isArray(value.parts) || value.parts.some(part => !record(part) || typeof part.kind !== 'string')
        || typeof value.sample_text !== 'string'
        || typeof value.created_at !== 'string' || typeof value.updated_at !== 'string'
        || !record(value.license) || typeof value.license.spdx !== 'string'
        || typeof value.license.scope !== 'string'
        || typeof value.license.attribution_required !== 'boolean'
        || typeof value.license.ai_training_allowed !== 'boolean'
        || !['private', 'shared'].includes(String(value.visibility))
        || value.price !== null || !Array.isArray(value.requires)
        || !record(value.provenance) || !Array.isArray(value.tags)
        || value.tags.some(tag => typeof tag !== 'string')) {
        throw new Error('スタイルの保存形を確認できません。');
    }
    const style = value as unknown as MyStyle;
    if (hasAbsolutePath(style)) throw new Error('スタイルに絶対パスは保存できません。');
    const parts: Array<{ kind: string; [key: string]: unknown }> = style.parts.map(part => part.kind === 'look'
        ? { ...part, scope: part.scope ?? 'caption', mode: part.mode ?? 'modify',
            text_style: portableLook(part.text_style) }
        : part.kind === 'motion'
            ? { ...part, scope: part.scope ?? 'caption', mode: part.mode ?? 'modify' }
            : { ...part });
    for (const part of parts) {
        if (part.kind === 'motion') {
            if (part.scope !== 'caption' || part.mode !== 'modify' || !record(part.animation)
                || !Object.keys(part.animation).length
                || Object.entries(part.animation).some(([slot, animation]) =>
                    !['in', 'loop', 'out'].includes(slot) || !record(animation)
                    || typeof animation.id !== 'string' || !animation.id.trim())) {
                throw new Error('動きの保存形を確認できません。');
            }
        }
        if (part.kind !== 'look') continue;
        const look = part.text_style as Record<string, unknown>;
        const height = look.reference_height_px;
        if (!Number.isInteger(height) || (height as number) < 1) {
            throw new Error('見た目には出力の基準高さが必要です。');
        }
        for (const [key, entry] of Object.entries(look)) {
            if (record(entry)) {
                if ((key === 'shadow' || key === 'glow') && typeof entry.color !== 'string') {
                    throw new Error('見た目の効果色が不正です。');
                }
                for (const [field, nested] of Object.entries(entry)) {
                    if (STRING_LOOK_FIELDS.has(field) ? typeof nested !== 'string'
                        : typeof nested !== 'number' || !Number.isFinite(nested)) {
                        throw new Error('見た目の値が不正です。');
                    }
                }
            } else if (key !== 'reference_height_px' && (STRING_LOOK_FIELDS.has(key)
                ? typeof entry !== 'string' : typeof entry !== 'number' || !Number.isFinite(entry))) {
                throw new Error('見た目の値が不正です。');
            }
        }
    }
    const result: MyStyle & { applies_to?: unknown } = { ...style, parts };
    delete result.applies_to;
    return result;
}

export function createMyStyle(input: Pick<MyStyle, 'id' | 'name' | 'when_to_use' | 'sample_text' | 'parts'> & { uid?: string },
    now: string): MyStyle {
    return parseMyStyle({ schema: 'akari-style', version: 1, revision: 1, uid: createMyStyleUid(),
        ...input, created_at: now, updated_at: now, tags: [], visibility: 'private',
        license: { spdx: 'LicenseRef-user-owned', scope: 'private-owned',
            attribution_required: false, ai_training_allowed: false },
        price: null, requires: [], provenance: {} });
}

export function myStyleAppliesTo(style: MyStyle): string[] {
    return [...new Set(style.parts.map(part => part.scope).filter((scope): scope is string => typeof scope === 'string'))];
}

export function myStyleLook(style: MyStyle): Record<string, unknown> | undefined {
    const look = style.parts.find(part => part.kind === 'look');
    return look ? portableLook(look.text_style) : undefined;
}

export function ignoredMyStyleParts(style: MyStyle): string[] {
    return [...new Set(style.parts.filter(part => part.kind !== 'look' && part.kind !== 'motion').map(part => part.kind))];
}

export function defaultMyStyleParts(parts: readonly { kind: string }[], previous?: readonly string[]): string[] {
    const supported = [...new Set(parts.filter(part => part.kind === 'look' || part.kind === 'motion').map(part => part.kind))];
    return previous === undefined ? supported : supported.filter(kind => previous.includes(kind));
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
