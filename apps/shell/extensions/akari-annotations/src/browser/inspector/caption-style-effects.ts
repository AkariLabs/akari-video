import type { CaptionTextStyle, CaptionTextStylePatch } from '../../common/caption-store';
import { TEXTSTYLE_CATALOG } from '@akari-video/edit-store';

export type CaptionEffect = 'none' | 'shadow' | 'raised' | 'neon' | 'outline';

export const CAPTION_OUTLINE_WIDTH_PX = 6;
export const CAPTION_EFFECT_THRESHOLD_PX = 4;
export const CAPTION_BACKGROUND_ON_OPACITY = 0.6;
const DEFAULT_STROKE = { color: '#000000', widthPx: 1.5 } as const;

export function captionEffectFromWidth(widthPx: number): CaptionEffect {
    return widthPx >= CAPTION_EFFECT_THRESHOLD_PX ? 'outline' : 'none';
}

export function captionEffectFromStyle(style: CaptionTextStyle | undefined): CaptionEffect {
    if (style?.glow && style.glow.density !== 0) return 'neon';
    if (style?.shadow && style.shadow.opacity !== 0) return (style.shadow.blurPx ?? 0) > (style.shadow.distancePx ?? 0)
        ? 'raised' : 'shadow';
    return captionEffectFromWidth(style?.stroke?.widthPx ?? DEFAULT_STROKE.widthPx);
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
    if (effect === 'shadow') return { ...reset, stroke: DEFAULT_STROKE,
        shadow: { color: '#000000', opacity: 0.75, distancePx: 8.5, angleDeg: 45, blurPx: 2 } };
    if (effect === 'raised') return { ...reset, stroke: DEFAULT_STROKE,
        shadow: { color: '#000000', opacity: 0.6, distancePx: 4, angleDeg: 90, blurPx: 14 } };
    if (effect === 'neon') return { ...reset, stroke: DEFAULT_STROKE,
        glow: { color: '#39D5FF', density: 60, spread: 12 } };
    if (effect === 'outline') return { ...reset,
        stroke: { color: contrastingStroke(textColor), widthPx: CAPTION_OUTLINE_WIDTH_PX } };
    return { ...reset, stroke: DEFAULT_STROKE };
}

export function captionEffectColorPatch(style: CaptionTextStyle, color: string): CaptionTextStylePatch {
    const effect = captionEffectFromStyle(style);
    if (effect === 'shadow' || effect === 'raised') {
        return { shadow: { ...style.shadow!, color } };
    }
    if (effect === 'neon') return { glow: { ...style.glow!, color } };
    if (effect === 'outline') return { stroke: { color } };
    return {};
}

export function captionEffectStrength(style: CaptionTextStyle): number {
    const effect = captionEffectFromStyle(style);
    if (effect === 'shadow') return (style.shadow?.distancePx ?? 8.5) / 8.5;
    if (effect === 'raised') return (style.shadow?.distancePx ?? 4) / 4;
    if (effect === 'neon') return (style.glow?.spread ?? 12) / 12;
    return style.stroke?.widthPx ?? CAPTION_OUTLINE_WIDTH_PX;
}

export function captionEffectStrengthPatch(style: CaptionTextStyle, strength: number): CaptionTextStylePatch {
    const effect = captionEffectFromStyle(style);
    if (effect === 'shadow' || effect === 'raised') {
        const baseDistance = effect === 'shadow' ? 8.5 : 4;
        const baseBlur = effect === 'shadow' ? 2 : 14;
        return { shadow: { ...style.shadow!, distancePx: baseDistance * strength, blurPx: baseBlur * strength } };
    }
    if (effect === 'neon') return { glow: { ...style.glow!, spread: 12 * strength } };
    if (effect === 'outline') return { stroke: { widthPx: strength } };
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
