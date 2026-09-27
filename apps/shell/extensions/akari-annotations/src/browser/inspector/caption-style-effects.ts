import type { CaptionTextStyle, CaptionTextStylePatch } from '../../common/caption-store';
import { TEXTSTYLE_CATALOG } from '@akari-video/edit-store';

export type CaptionEffect = 'none' | 'shadow' | 'raised' | 'neon' | 'outline' | CaptionEffectCardId;
export type CaptionEffectCardId = typeof CAPTION_EFFECT_GROUPS[number]['items'][number]['id'];

// 既存の text_style フィールドだけで描ける見本。グループ順は試作 v2 と同じ。
export const CAPTION_EFFECT_GROUPS = [
    { label: '影', items: [
        { id: 'sh-soft', label: 'ソフトシャドウ' }, { id: 'sh-hard', label: 'ハードシャドウ' },
        { id: 'sh-long', label: 'ロングシャドウ' }, { id: 'sh-diag', label: '斜め下シャドウ' },
        { id: 'sh-raised', label: '浮き出し' }, { id: 'sh-inset', label: 'くぼみ風' }
    ] },
    { label: '光', items: [
        { id: 'gl-white', label: '光彩 白' }, { id: 'gl-color', label: '光彩 橙' },
        { id: 'neon-blue', label: 'ネオン 青' }, { id: 'neon-pink', label: 'ネオン ピンク' },
        { id: 'neon-green', label: 'ネオン 緑' }, { id: 'neon-yellow', label: 'ネオン 黄' }
    ] },
    { label: '縁', items: [
        { id: 'ol-thin', label: '袋文字 細' }, { id: 'ol-thick', label: '袋文字 太' },
        { id: 'ol-color', label: '袋文字 色違い' }
    ] },
    { label: '帯', items: [
        { id: 'bg-band', label: '座布団 帯' }, { id: 'bg-round', label: '座布団 角丸' },
        { id: 'bg-trans', label: '座布団 半透明' }
    ] },
    { label: '組み合わせ', items: [
        { id: 'combo-neon-shadow', label: 'ネオン + 影' },
        { id: 'combo-outline-shadow', label: '袋文字 + 影' },
        { id: 'combo-band-outline', label: '座布団 + 袋文字' }
    ] }
] as const;

const shadow = (color: string, opacity: number, blurPx: number, distancePx: number, angleDeg: number) =>
    ({ color, opacity, blurPx, distancePx, angleDeg });
const glow = (color: string, density: number, spread: number) => ({ color, density, spread });
const background = (color: string, opacity: number, radiusPx: number, paddingPx: number) =>
    ({ color, opacity, radiusPx, paddingPx });

export const CAPTION_EFFECT_SPECS: Record<CaptionEffectCardId, CaptionTextStylePatch> = {
    'sh-soft': { shadow: shadow('#000000', .75, 2, 8.5, 45) },
    'sh-hard': { shadow: shadow('#000000', .85, 0, 4, 135) },
    'sh-long': { shadow: shadow('#000000', .55, 1, 16, 45) },
    'sh-diag': { shadow: shadow('#000000', .7, 3, 9, 60) },
    'sh-raised': { shadow: shadow('#000000', .6, 14, 4, 90) },
    'sh-inset': { shadow: shadow('#ffffff', .35, 2, 2, 270) },
    'gl-white': { glow: glow('#ffffff', 40, 8) },
    'gl-color': { glow: glow('#fb923c', 45, 9) },
    'neon-blue': { glow: glow('#39D5FF', 60, 12) },
    'neon-pink': { glow: glow('#ff3dae', 60, 14) },
    'neon-green': { glow: glow('#39ff7a', 55, 11) },
    'neon-yellow': { glow: glow('#ffe93d', 55, 10) },
    'ol-thin': { stroke: { color: '#000000', widthPx: 3 } },
    'ol-thick': { stroke: { color: '#000000', widthPx: 6 } },
    'ol-color': { stroke: { color: '#2563eb', widthPx: 6 }, color: '#fff59d' },
    'bg-band': { background: background('#000000', .6, 0, 8) },
    'bg-round': { background: background('#000000', .7, 14, 9) },
    'bg-trans': { background: background('#1d4ed8', .32, 8, 8) },
    'combo-neon-shadow': { glow: glow('#39d5ff', 50, 10), shadow: shadow('#000000', .5, 6, 6, 90) },
    'combo-outline-shadow': { stroke: { color: '#000000', widthPx: 5 }, shadow: shadow('#000000', .6, 4, 8, 60) },
    'combo-band-outline': { background: background('#000000', .55, 10, 8), stroke: { color: '#f97316', widthPx: 3 } }
};

export function captionEffectCard(id: string): id is CaptionEffectCardId {
    return Object.prototype.hasOwnProperty.call(CAPTION_EFFECT_SPECS, id);
}

export function captionEffectAdjustmentKeys(id: CaptionEffect): readonly string[] {
    if (id === 'none') return [];
    const spec = captionEffectCard(id) ? CAPTION_EFFECT_SPECS[id] : captionEffectPatch(id, '#ffffff');
    return [
        ...(spec.shadow ? ['shadow.color', 'shadow.opacity', 'shadow.distancePx', 'shadow.angleDeg', 'shadow.blurPx'] : []),
        ...(spec.glow ? ['glow.color', 'glow.density', 'glow.spread'] : []),
        ...(spec.stroke && ((spec.stroke.widthPx ?? 0) >= CAPTION_EFFECT_THRESHOLD_PX || id === 'ol-thin')
            ? ['stroke.color', 'stroke.widthPx'] : []),
        ...(spec.background ? ['background.color', 'background.opacity', 'background.radiusPx', 'background.paddingPx'] : [])
    ];
}

export function captionEffectAdjustmentValue(style: CaptionTextStyle, path: string): string {
    const [part, key] = path.split('.') as [keyof CaptionTextStyle, string];
    const value = style[part];
    if (!value || typeof value !== 'object') return '';
    const result = (value as unknown as Record<string, unknown>)[key];
    return result === undefined || result === null ? '' : String(result);
}

export function captionEffectAdjustmentPatch(style: CaptionTextStyle, path: string, input: string): CaptionTextStylePatch {
    const [part, key] = path.split('.') as ['shadow' | 'glow' | 'stroke' | 'background', string];
    const value = key === 'color' ? input : Number(input);
    if (key === 'color' && !/^#[0-9a-f]{6}$/iu.test(input)) throw new Error('色は #RRGGBB で入力してください。');
    if (key !== 'color' && (!Number.isFinite(value) || Number(value) < 0)) throw new Error('0 以上の数値を入力してください。');
    if (part === 'shadow') return { shadow: { color: style.shadow?.color ?? '#000000', [key]: value } };
    if (part === 'glow') return { glow: { color: style.glow?.color ?? '#ffffff', [key]: value } };
    if (part === 'stroke') return { stroke: { [key]: value } };
    return { background: { [key]: value } };
}

export const CAPTION_OUTLINE_WIDTH_PX = 6;
export const CAPTION_EFFECT_THRESHOLD_PX = 4;
export const CAPTION_BACKGROUND_ON_OPACITY = 0.6;
const DEFAULT_STROKE = { color: '#000000', widthPx: 1.5 } as const;

export function captionEffectFromWidth(widthPx: number): CaptionEffect {
    return widthPx >= CAPTION_EFFECT_THRESHOLD_PX ? 'outline' : 'none';
}

export function captionEffectFromStyle(style: CaptionTextStyle | undefined): CaptionEffect {
    const hasGlow = !!style?.glow && style.glow.density !== 0;
    const hasShadow = !!style?.shadow && style.shadow.opacity !== 0;
    const hasOutline = (style?.stroke?.widthPx ?? 0) >= CAPTION_EFFECT_THRESHOLD_PX;
    const hasBand = !!style?.background && (style.background.opacity ?? 0) > 0;
    const hasStroke = (style?.stroke?.widthPx ?? 0) >= 3;
    for (const group of CAPTION_EFFECT_GROUPS) for (const item of group.items) {
        const spec = CAPTION_EFFECT_SPECS[item.id];
        if (!!spec.shadow !== hasShadow || !!spec.glow !== hasGlow
            || !!spec.background !== hasBand || !!spec.stroke !== hasStroke) continue;
        if (['shadow', 'glow', 'stroke', 'background'].every(key => {
            const expected = spec[key as keyof typeof spec] as Record<string, unknown> | undefined;
            if (!expected) return true;
            const actual = style?.[key as 'shadow' | 'glow' | 'stroke' | 'background'] as Record<string, unknown> | undefined;
            return !!actual && Object.entries(expected).every(([field, value]) =>
                key === 'stroke' && item.id === 'ol-thick' && field === 'color'
                    ? actual[field] === contrastingStroke(style?.color ?? '#FFFFFF') : actual[field] === value);
        })) return item.id;
    }
    if (hasGlow && hasShadow) return 'neon-blue';
    if (hasGlow) {
        const color = style!.glow!.color.toLowerCase();
        return color === '#ffffff' ? 'gl-white' : color === '#fb923c' ? 'gl-color'
            : color === '#ff3dae' ? 'neon-pink' : color === '#39ff7a' ? 'neon-green'
                : color === '#ffe93d' ? 'neon-yellow' : 'neon-blue';
    }
    if (hasShadow) return (style!.shadow!.blurPx ?? 0) > (style!.shadow!.distancePx ?? 0)
        ? 'sh-raised' : 'sh-soft';
    if ((style?.stroke?.widthPx ?? 0) >= 3 && !hasOutline) return 'ol-thin';
    if (hasOutline && style?.stroke?.color?.toLowerCase() === '#2563eb') return 'ol-color';
    if (hasOutline && (style?.stroke?.widthPx ?? 0) >= 6) return 'ol-thick';
    if (hasBand) return (style!.background!.radiusPx ?? 0) >= 12 ? 'bg-round'
        : (style!.background!.opacity ?? 1) < .5 ? 'bg-trans' : 'bg-band';
    return captionEffectFromWidth(style?.stroke?.widthPx ?? DEFAULT_STROKE.widthPx) === 'outline'
        ? 'ol-thick' : 'none';
}

/** プリセット由来の効果だけ、cue 側で透明な値を重ねて無効化する。 */
export function captionPresetAwareStylePatch(
    patch: CaptionTextStylePatch,
    presetId: string | undefined
): CaptionTextStylePatch {
    const presetStyle = presetId ? TEXTSTYLE_CATALOG[presetId]?.style : undefined;
    return {
        ...patch,
        ...(patch.shadow === null && presetStyle?.shadow
            ? { shadow: { color: '#000000', opacity: 0 } } : {}),
        ...(patch.glow === null && presetStyle?.glow
            ? { glow: { color: '#000000', density: 0 } } : {})
    };
}

function record(value: unknown): Record<string, unknown> | undefined {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown> : undefined;
}

function captionCueFromSource(source: string, captionId: string): Record<string, unknown> {
    const root = JSON.parse(source) as unknown;
    const captions = Array.isArray(root) ? root : record(root)?.captions;
    const cue = Array.isArray(captions)
        ? captions.map(record).find(entry => entry?.id === captionId) : undefined;
    if (!cue) throw new Error(`字幕 ${captionId} が字幕データにありません。`);
    return cue;
}

export function captionCueStylePresetId(source: string, captionId: string): string | undefined {
    const preset = captionCueFromSource(source, captionId).style_preset;
    return typeof preset === 'string' ? preset : undefined;
}

/** undo は合成済みの CaptionRecord ではなく、ファイル上の cue 個別指定へ戻す。 */
export function captionCueOriginalStylePatch(
    source: string,
    captionId: string,
    patch: CaptionTextStylePatch
): CaptionTextStylePatch {
    const cue = captionCueFromSource(source, captionId);
    const style = record(cue.text_style) ?? {};
    const original: CaptionTextStylePatch = {};
    if (patch.color !== undefined) original.color = style.color as string | undefined ?? null;
    if (patch.sizePx !== undefined) original.sizePx = style.size_px as number | undefined ?? null;
    if (patch.wrapWidthPct !== undefined) original.wrapWidthPct = style.wrap_width_pct as number | undefined ?? null;
    if (patch.fontWeight !== undefined) original.fontWeight = style.font_weight as number | undefined ?? null;
    if (patch.weight !== undefined || patch.fontWeight !== undefined) {
        original.weight = style.weight as number | undefined ?? null;
    }
    if (patch.lineHeight !== undefined) original.lineHeight = style.line_height as number | undefined ?? null;
    if (patch.letterSpacingEm !== undefined) {
        original.letterSpacingEm = style.letter_spacing_em as number | undefined ?? null;
    }
    if (patch.fontFamily !== undefined) original.fontFamily = style.font_family as string | undefined ?? null;
    if (patch.zone !== undefined) original.zone = style.zone as CaptionTextStylePatch['zone'] ?? null;
    if (patch.stroke) {
        const stroke = record(style.stroke) ?? {};
        original.stroke = {
            ...(patch.stroke.color !== undefined ? { color: stroke.color as string | undefined ?? null } : {}),
            ...(patch.stroke.widthPx !== undefined ? { widthPx: stroke.width_px as number | undefined ?? null } : {})
        };
    }
    if (patch.background) {
        const background = record(style.background) ?? {};
        original.background = {
            ...(patch.background.color !== undefined
                ? { color: background.color as string | undefined ?? null } : {}),
            ...(patch.background.opacity !== undefined
                ? { opacity: background.opacity as number | undefined ?? null } : {}),
            ...(patch.background.radiusPx !== undefined
                ? { radiusPx: background.radius_px as number | undefined ?? null } : {}),
            ...(patch.background.paddingPx !== undefined
                ? { paddingPx: background.padding_px as number | undefined ?? null } : {}),
            ...(patch.background.mode !== undefined
                ? { mode: background.mode as NonNullable<CaptionTextStylePatch['background']>['mode'] ?? null } : {})
        };
    }
    if (patch.shadow !== undefined) {
        const shadow = record(style.shadow);
        original.shadow = shadow ? {
            color: shadow.color as string,
            ...(shadow.opacity !== undefined ? { opacity: shadow.opacity as number } : {}),
            ...(shadow.blur_px !== undefined ? { blurPx: shadow.blur_px as number } : {}),
            ...(shadow.distance_px !== undefined ? { distancePx: shadow.distance_px as number } : {}),
            ...(shadow.angle_deg !== undefined ? { angleDeg: shadow.angle_deg as number } : {})
        } : null;
    }
    if (patch.glow !== undefined) {
        const glow = record(style.glow);
        original.glow = glow ? {
            color: glow.color as string,
            ...(glow.density !== undefined ? { density: glow.density as number } : {}),
            ...(glow.spread !== undefined ? { spread: glow.spread as number } : {}),
            ...(glow.offset_x !== undefined ? { offsetX: glow.offset_x as number } : {}),
            ...(glow.offset_y !== undefined ? { offsetY: glow.offset_y as number } : {})
        } : null;
    }
    return original;
}

function contrastingStroke(textColor: string): string {
    const input = textColor.replace('#', '');
    const hex = input.length === 3 || input.length === 4
        ? input.slice(0, 3).split('').map(channel => channel + channel).join('')
        : input.slice(0, 6);
    const red = parseInt(hex.slice(0, 2), 16);
    const green = parseInt(hex.slice(2, 4), 16);
    const blue = parseInt(hex.slice(4, 6), 16);
    return (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255 > 0.5
        ? '#000000' : '#FFFFFF';
}

export function captionEffectPatch(effect: CaptionEffect, textColor: string): CaptionTextStylePatch {
    const reset = { shadow: null, glow: null } as const;
    if (captionEffectCard(effect)) return {
        ...reset, background: { opacity: 0 }, stroke: DEFAULT_STROKE, ...CAPTION_EFFECT_SPECS[effect],
        ...(effect === 'ol-thick' ? { stroke: { color: contrastingStroke(textColor), widthPx: 6 } } : {})
    };
    if (effect === 'shadow' || effect === 'raised' || effect === 'neon' || effect === 'outline') {
        const id = { shadow: 'sh-soft', raised: 'sh-raised', neon: 'neon-blue', outline: 'ol-thick' } as const;
        const patch = captionEffectPatch(id[effect], textColor);
        return { shadow: patch.shadow, glow: patch.glow, stroke: patch.stroke };
    }
    return { ...reset, stroke: DEFAULT_STROKE };
}

export function captionEffectColorPatch(style: CaptionTextStyle, color: string): CaptionTextStylePatch {
    const effect = captionEffectFromStyle(style);
    if (effect === 'shadow' || effect === 'raised' || effect === 'sh-soft' || effect === 'sh-raised') {
        return { shadow: { ...style.shadow!, color } };
    }
    if (effect === 'neon' || effect === 'neon-blue') return { glow: { ...style.glow!, color } };
    if (effect === 'outline' || effect === 'ol-thick') return { stroke: { color } };
    return {};
}

export function captionEffectStrength(style: CaptionTextStyle): number {
    const effect = captionEffectFromStyle(style);
    if (effect === 'shadow' || effect === 'sh-soft') return (style.shadow?.distancePx ?? 8.5) / 8.5;
    if (effect === 'raised' || effect === 'sh-raised') return (style.shadow?.distancePx ?? 4) / 4;
    if (effect === 'neon' || effect === 'neon-blue') return (style.glow?.spread ?? 12) / 12;
    return style.stroke?.widthPx ?? CAPTION_OUTLINE_WIDTH_PX;
}

export function captionEffectStrengthPatch(style: CaptionTextStyle, strength: number): CaptionTextStylePatch {
    const effect = captionEffectFromStyle(style);
    if (effect === 'shadow' || effect === 'raised' || effect === 'sh-soft' || effect === 'sh-raised') {
        const baseDistance = effect === 'shadow' || effect === 'sh-soft' ? 8.5 : 4;
        const baseBlur = effect === 'shadow' || effect === 'sh-soft' ? 2 : 14;
        return { shadow: { ...style.shadow!, distancePx: baseDistance * strength, blurPx: baseBlur * strength } };
    }
    if (effect === 'neon' || effect === 'neon-blue') return { glow: { ...style.glow!, spread: 12 * strength } };
    if (effect === 'outline' || effect === 'ol-thick') return { stroke: { widthPx: strength } };
    return {};
}

// 旧インスペクターテストと利用者向けの個別書き込み表現。
export function captionEffectWrites(effect: CaptionEffect, textColor: string): readonly {
    kind: 'caption-style-stroke-color' | 'caption-style-stroke-width'; value: string | number
}[] {
    const stroke = captionEffectPatch(effect, textColor).stroke!;
    return [
        { kind: 'caption-style-stroke-color', value: stroke.color! },
        { kind: 'caption-style-stroke-width', value: stroke.widthPx! }
    ];
}

export const CAPTION_REVEAL_FIELDS = [
    'caption-style-color', 'caption-style-stroke-color', 'caption-style-bg-color', 'caption-style'
] as const;

export function resolveCaptionRevealField(value: unknown): typeof CAPTION_REVEAL_FIELDS[number] {
    const field = value && typeof value === 'object' && 'field' in value ? value.field : undefined;
    return CAPTION_REVEAL_FIELDS.find(candidate => candidate === field) ?? 'caption-style';
}
