import { mergeCaptionTextStyles, type CaptionAnimation, type CaptionTextStyle, type CaptionTextStylePatch } from '../common/caption-store';

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

/** Freeze the resolved caption animation in captions.json's snake_case shape. */
export function effectiveMyStyleMotion(defaultStyle: CaptionTextStyle | undefined,
    captionStyle: CaptionTextStyle | undefined): Record<string, unknown> | undefined {
    const animation = mergeCaptionTextStyles(defaultStyle, captionStyle)?.animation;
    if (!animation || !Object.keys(animation).length) return undefined;
    return Object.fromEntries(Object.entries(animation).map(([slot, value]) => {
        const { durationSec, ...rest } = value;
        return [slot, { ...rest, ...(durationSec !== undefined ? { duration_sec: durationSec } : {}) }];
    }));
}

export function placedMyStyleMotion(value: unknown): CaptionAnimation {
    if (!record(value)) return {};
    return Object.fromEntries(['in', 'loop', 'out'].filter(slot => record(value[slot])).map(slot => {
        const input = value[slot] as Record<string, unknown>;
        const { duration_sec, ...rest } = input;
        return [slot, { ...rest, ...(typeof duration_sec === 'number' ? { durationSec: duration_sec } : {}) }];
    })) as CaptionAnimation;
}

export function myStyleSaveParts(defaultStyle: CaptionTextStyle | undefined,
    captionStyle: CaptionTextStyle | undefined, referenceHeightPx: number,
    selected: readonly string[]): Array<{ kind: string; scope: 'caption'; mode: 'modify';
        text_style?: Record<string, unknown>; animation?: Record<string, unknown> }> {
    const motion = effectiveMyStyleMotion(defaultStyle, captionStyle);
    return [
        ...(selected.includes('look') ? [{ kind: 'look', scope: 'caption' as const, mode: 'modify' as const,
            text_style: effectiveMyStyleLook(defaultStyle, captionStyle, referenceHeightPx) }] : []),
        ...(selected.includes('motion') && motion ? [{ kind: 'motion', scope: 'caption' as const,
            mode: 'modify' as const, animation: motion }] : [])
    ];
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
export function replaceMyStylePartsInSource(source: string, ids: readonly string[],
    parts: readonly { kind: string; text_style?: unknown; animation?: unknown }[]): string {
    const lookPart = parts.find(part => part.kind === 'look');
    const motionPart = parts.find(part => part.kind === 'motion');
    const look = sanitizeMyStyleLook(lookPart?.text_style);
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
        if (lookPart) {
            for (const key of Object.keys(LOOK_FIELDS)) delete next[key];
            Object.assign(next, look);
            const defaultStyle = record(document) ? document.default_text_style : undefined;
            assertMyStyleLayoutCompatible(defaultStyle, next);
            delete row.style_preset;
        }
        if (motionPart) next.animation = motionPart.animation;
        if (Object.keys(next).length) row.text_style = next;
        else delete row.text_style;
    }
    return `${JSON.stringify(document, null, 2)}\n`;
}

export function replaceMyStyleLookInSource(source: string, ids: readonly string[], value: unknown): string {
    return replaceMyStylePartsInSource(source, ids, [{ kind: 'look', text_style: value }]);
}

export interface MyStyleUsageEntry {
    caption_ids: string[];
    style_uid: string;
    revision: number;
    parts: string[];
    applied_at: string;
}

export function appliedMyStyleKinds(parts: readonly { kind: string; mode?: unknown }[], selected: readonly string[]): string[] {
    return [...new Set(parts.filter(part => ((part.kind === 'look' || part.kind === 'motion')
        || supportedMyStyleAttachPart(part))
        && selected.includes(part.kind)).map(part => part.kind))];
}

export function supportedMyStyleAttachPart(part: { kind: string; mode?: unknown }): boolean {
    if (!['sfx', 'fx', 'decor'].includes(part.kind) || part.mode !== 'attach') return false;
    const value = part as Record<string, unknown>;
    const allowed = part.kind === 'sfx'
        ? ['kind', 'scope', 'mode', 'attach', 'asset', 'file', 'duration_sec', 'gain_db', 'in', 'out']
        : part.kind === 'decor'
            ? ['kind', 'scope', 'mode', 'attach', 'asset', 'file', 'vars', 'duration_sec']
            : ['kind', 'scope', 'mode', 'attach', 'effect', 'duration_sec'];
    if (Object.keys(value).some(key => !allowed.includes(key))) return false;
    const attach = value.attach;
    if (value.scope !== 'caption' || !record(attach)
        || !['in', 'out', 'whole'].includes(String(attach.at))
        || !Number.isInteger(attach.offset_frames)
        || Object.keys(attach).some(key => !['at', 'offset_frames'].includes(key))) return false;
    if (part.kind === 'sfx' || part.kind === 'decor') {
        const asset = value.asset;
        const category = part.kind === 'sfx' ? 'audio' : 'overlay';
        if (!record(asset) || asset.category !== category || typeof asset.id !== 'string'
            || !/^[A-Za-z0-9_-]+$/.test(asset.id) || typeof value.file !== 'string'
            || !/^[^/\\]+$/.test(value.file) || value.file === '.' || value.file === '..'
            || Object.keys(asset).some(key => !['category', 'id'].includes(key))) return false;
        if (part.kind === 'decor' ? !/\.html?$/i.test(value.file)
            : !/\.(wav|mp3|m4a|aac|flac|ogg|aif|aiff)$/i.test(value.file)) return false;
    }
    if (part.kind === 'fx') {
        const effect = value.effect;
        if (!record(effect) || !['invert', 'lut', 'saturation'].includes(String(effect.type))) return false;
        if (effect.type === 'invert' && Object.keys(effect).length !== 1) return false;
        if (effect.type === 'lut' && (typeof effect.id !== 'string' || !effect.id.trim()
            || Object.keys(effect).some(key => !['type', 'id', 'intensity'].includes(key))
            || (effect.intensity !== undefined && (typeof effect.intensity !== 'number'
                || effect.intensity < 0 || effect.intensity > 1)))) return false;
        if (effect.type === 'saturation' && (typeof effect.value !== 'number'
            || effect.value < 0 || effect.value > 3 || Object.keys(effect).length !== 2)) return false;
    }
    if (part.kind === 'sfx' && (typeof value.duration_sec !== 'number' || !Number.isFinite(value.duration_sec)
        || value.duration_sec <= 0 || (value.gain_db !== undefined
            && (typeof value.gain_db !== 'number' || value.gain_db < -60 || value.gain_db > 12)))) return false;
    if (part.kind === 'sfx' && ((value.in !== undefined
        && (typeof value.in !== 'number' || !Number.isFinite(value.in) || value.in < 0))
        || (value.out !== undefined && (typeof value.out !== 'number' || !Number.isFinite(value.out)
            || value.out <= (typeof value.in === 'number' ? value.in : 0))))) return false;
    if (part.kind === 'decor' && value.vars !== undefined && !record(value.vars)) return false;
    if (part.kind !== 'sfx' && attach.at !== 'whole'
        && (typeof value.duration_sec !== 'number' || !Number.isFinite(value.duration_sec)
            || value.duration_sec <= 0)) return false;
    return true;
}

type StylePart = { kind: string; [key: string]: unknown };
type StyleItem = { id: string; at: number; duration: number; source: Record<string, unknown>;
    anchor?: { caption: string; edge?: 'start' | 'end'; offset?: number; duration?: 'caption' | 'own';
        attached_by?: { style_uid: string; caption: string } };
    gain_db?: number; items?: StyleItem[] };
type StyleTrack = { id: string; lane: 'visual' | 'audio'; items?: StyleItem[]; content?: unknown };
type StyleEdit = { output: { fps: number }; sources: Array<{ id: string; path: string }>;
    tracks: StyleTrack[] };

function assetLocation(path: unknown, category: string): { id: string; file: string } | undefined {
    if (typeof path !== 'string') return undefined;
    const match = new RegExp(`^assets/${category}/([a-zA-Z0-9_-]+)/([^/?#]+)$`).exec(path);
    if (!match || match[2] === '.' || match[2] === '..') return undefined;
    return { id: match[1], file: match[2] };
}

/** Existing anchored timeline elements are the only source of attach parts. */
export function myStyleAttachedPartsFromEdit(edit: StyleEdit, captionId: string): StylePart[] {
    const parts: StylePart[] = [];
    if (!Array.isArray(edit.tracks) || !Array.isArray(edit.sources) || !edit.output?.fps) return parts;
    const visit = (items: StyleItem[], lane: string): void => {
        for (const item of items) {
            if (item.anchor?.caption === captionId) {
                const attach = { at: item.anchor.edge === 'end' ? 'out' : item.anchor.duration === 'caption' ? 'whole' : 'in',
                    offset_frames: item.anchor.offset ?? 0 };
                if (lane === 'audio' && item.source.kind === 'media' && item.source.src) {
                    const source = edit.sources.find(candidate => candidate.id === item.source.src);
                    const asset = assetLocation(source?.path, 'audio');
                    if (asset && /\.(wav|mp3|m4a|aac|flac|ogg|aif|aiff)$/i.test(asset.file)) parts.push({ kind: 'sfx', scope: 'caption', mode: 'attach', attach,
                        asset: { category: 'audio', id: asset.id }, file: asset.file,
                        duration_sec: item.duration / edit.output.fps,
                        ...(item.gain_db === undefined ? {} : { gain_db: item.gain_db }),
                        ...(typeof item.source.in === 'number' ? { in: item.source.in } : {}),
                        ...(typeof item.source.out === 'number' ? { out: item.source.out } : {}) });
                } else if (lane === 'visual' && item.source.kind === 'html') {
                    const asset = assetLocation(item.source.path, 'overlay');
                    if (asset && /\.html?$/i.test(asset.file)) parts.push({ kind: 'decor', scope: 'caption', mode: 'attach', attach,
                        asset: { category: 'overlay', id: asset.id }, file: asset.file,
                        ...(item.source.vars ? { vars: item.source.vars } : {}),
                        ...(attach.at !== 'whole' ? { duration_sec: item.duration / edit.output.fps } : {}) });
                } else if (lane === 'visual' && item.source.kind === 'filter') {
                    parts.push({ kind: 'fx', scope: 'caption', mode: 'attach', attach,
                        effect: item.source.filter,
                        ...(attach.at !== 'whole' ? { duration_sec: item.duration / edit.output.fps } : {}) });
                }
            }
            if (Array.isArray(item.items)) visit(item.items, lane);
        }
    };
    for (const track of edit.tracks) if (Array.isArray(track.items)) visit(track.items, track.lane);
    return parts;
}

/** A manual timeline move bakes the current timing into the item. */
export function detachMovedStyleItem<T extends StyleEdit>(edit: T, itemId: string): T {
    const visit = (items: StyleItem[]): void => {
        for (const item of items) {
            if (item.id === itemId && item.anchor?.attached_by) {
                delete item.anchor;
            }
            if (Array.isArray(item.items)) visit(item.items);
        }
    };
    for (const track of edit.tracks) if (Array.isArray(track.items)) visit(track.items);
    return edit;
}

/** Reapply replaces only this style's previous elements for each target caption. */
export function applyMyStyleAttachedParts(edit: StyleEdit, captions: readonly { id: string; start: number; end: number }[],
    captionIds: readonly string[], styleUid: string, parts: readonly StylePart[]): StyleEdit {
    const targets = new Set(captionIds);
    const next = structuredClone(edit);
    const prune = (items: StyleItem[]): StyleItem[] => items.filter(item =>
        !(item.anchor?.attached_by?.style_uid === styleUid && targets.has(item.anchor.attached_by.caption)))
        .map(item => item.items ? { ...item, items: prune(item.items) } : item);
    for (const track of next.tracks) if (Array.isArray(track.items)) track.items = prune(track.items);
    const fps = next.output.fps;
    const ids = new Set(next.tracks.flatMap(track => (track.items ?? []).map(item => item.id)));
    const trackFor = (lane: 'visual' | 'audio', at: number, duration: number): StyleTrack => {
        let track = next.tracks.find(candidate => candidate.lane === lane && candidate.id.startsWith('style-')
            && Array.isArray(candidate.items)
            && candidate.items.every(item => item.at + item.duration <= at || at + duration <= item.at));
        if (!track) {
            let index = 1;
            while (next.tracks.some(candidate => candidate.id === `style-${lane}-${index}`)) index++;
            track = { id: `style-${lane}-${index}`, lane, items: [] };
            next.tracks.push(track);
        }
        return track;
    };
    for (const captionId of targets) {
        const caption = captions.find(candidate => candidate.id === captionId);
        if (!caption) throw new Error(`字幕 ${captionId} が見つかりません。`);
        for (const part of parts) {
            if (!supportedMyStyleAttachPart(part)) continue;
            const attach = part.attach as { at?: string; offset_frames?: number } | undefined;
            const edge = attach?.at === 'out' ? 'end' : 'start';
            const duration = attach?.at === 'whole' ? 'caption' : 'own';
            const anchor = { caption: captionId, edge, offset: attach?.offset_frames ?? 0, duration,
                attached_by: { style_uid: styleUid, caption: captionId } } as const;
            const at = Math.round((edge === 'end' ? caption.end : caption.start) * fps) + anchor.offset;
            const frames = duration === 'caption' ? Math.max(1, Math.round((caption.end - caption.start) * fps))
                : Math.max(1, Math.round((Number(part.duration_sec) || 0.1) * fps));
            const base = { id: '', at, duration: frames, anchor };
            let index = 1;
            while (ids.has(`style-part-${index}`)) index++;
            base.id = `style-part-${index}`;
            ids.add(base.id);
            if (part.kind === 'sfx' || part.kind === 'decor') {
                const asset = part.asset as { category?: string; id?: string } | undefined;
                const category = part.kind === 'sfx' ? 'audio' : 'overlay';
                if (asset?.category !== category || typeof asset.id !== 'string' || typeof part.file !== 'string'
                    || !assetLocation(`assets/${category}/${asset.id}/${part.file}`, category))
                    throw new Error(`${part.kind} の素材参照が不正です。`);
                const path = `assets/${category}/${asset.id}/${part.file}`;
                if (part.kind === 'sfx') {
                    let source = next.sources.find(candidate => candidate.path === path);
                    if (!source) {
                        let serial = 1;
                        while (next.sources.some(candidate => candidate.id === `style-src-${serial}`)) serial++;
                        source = { id: `style-src-${serial}`, path };
                        next.sources.push(source);
                    }
                    trackFor('audio', at, frames).items!.push({ ...base, source: { kind: 'media', src: source.id,
                        in: typeof part.in === 'number' ? part.in : 0,
                        out: typeof part.out === 'number' ? part.out
                            : (typeof part.in === 'number' ? part.in : 0) + frames / fps },
                        ...(typeof part.gain_db === 'number' ? { gain_db: part.gain_db } : {}) });
                } else {
                    trackFor('visual', at, frames).items!.push({ ...base, source: { kind: 'html', path,
                        ...(part.vars ? { vars: part.vars } : {}) } });
                }
            } else if (part.effect && typeof part.effect === 'object') {
                trackFor('visual', at, frames).items!.push({ ...base, source: { kind: 'filter', filter: part.effect } });
            }
        }
    }
    return next;
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

export function myStyleApplyNotice(parts: readonly { kind: string; mode?: unknown; text_style?: unknown }[],
    selected: readonly string[] = ['look', 'motion']): string | undefined {
    const look = selected.includes('look') ? parts.find(part => part.kind === 'look') : undefined;
    const ignored = [...new Set([
        ...parts.filter(part => !['look', 'motion'].includes(part.kind)
            && !supportedMyStyleAttachPart(part)).map(part => PART_LABELS[part.kind] ?? part.kind),
        ...unsupportedMyStyleLookFields(look?.text_style).map(field => FIELD_LABELS[field] ?? field)
    ])];
    if (!ignored.length) return undefined;
    const labels = ignored.length > 3 ? `${ignored.slice(0, 3).join('・')}ほか` : ignored.join('・');
    return `${labels} は当てません。`;
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
