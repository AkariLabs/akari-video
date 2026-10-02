// Moved from akari-inspector-widget.ts (F-57): class-external inspector definitions.
import { CAPTION_PANEL_FONTS } from '../../../common/caption-panel-catalog';
import { CAPTION_FONT_FAMILY } from 'akari-preview/lib/common/caption-visual-contract';
import { TimelineAudioSelection, TimelineCaptionSelection } from '../../timeline-selection-model';
import { type CaptionTextStyle } from '../../../common/caption-store';
import type { InspectorFieldDef } from './types';

export function formatTimestamp(value: number): string {
    const milliseconds = Math.max(0, Math.round(value * 1000));
    const hours = Math.floor(milliseconds / 3_600_000);
    const minutes = Math.floor((milliseconds % 3_600_000) / 60_000);
    const seconds = Math.floor((milliseconds % 60_000) / 1000);
    const fraction = milliseconds % 1000;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:` +
        `${String(seconds).padStart(2, '0')}.${String(fraction).padStart(3, '0')}`;
}

export function formatDurationSeconds(value: number): string {
    return `${value.toFixed(2)} 秒`;
}

export function formatDecimal1(value: number): string {
    return value.toFixed(1);
}

export function formatDecimal2(value: number): string {
    return value.toFixed(2);
}

export function withDefaultNumber(
    raw: number | undefined,
    defaultValue: number,
    formatFn: (value: number) => string
): string {
    return raw === undefined ? `${formatFn(defaultValue)}（既定）` : formatFn(raw);
}

export function withDefaultBoolean(raw: boolean | undefined, defaultValue: boolean): string {
    const format = (value: boolean): string => value ? 'ON' : 'OFF';
    return raw === undefined ? `${format(defaultValue)}（既定）` : format(raw);
}

export function orDash<T>(raw: T | null | undefined, formatFn: (value: T) => string): string {
    return raw === null || raw === undefined ? '—' : formatFn(raw);
}

/** インスペクター「種別」フィールドの表示ラベル（sfx は音声クリップ語彙へ、2026-08-18）。 */
export function formatAudioKindLabel(audioKind: TimelineAudioSelection['audioKind']): string {
    return audioKind === 'sfx' ? '音声クリップ' : audioKind;
}

export const CAPTION_STYLE_DEFAULTS = {
    color: '#FFFFFF',
    sizePx: 38,
    fontWeight: 700,
    lineHeight: 1.42,
    letterSpacingEm: 0,
    strokeColor: '#000000',
    strokeWidthPx: 1.5,
    backgroundColor: '#000000',
    backgroundOpacity: 0,
    backgroundRadiusPx: 10,
    backgroundPaddingPx: 0,
    backgroundMode: 'per-line',
    zone: 'bottom'
} as const;

// 字幕描画の line-height 1.42 + 上下 padding 0.08em ずつの半分。
export const CAPTION_PLATE_CAPSULE_HALF_HEIGHT_EM = (1.42 + 0.08 * 2) / 2;

export type CaptionStyleFieldKey =
    | 'color'
    | 'size'
    | 'wrap-width'
    | 'font-weight'
    | 'line-height'
    | 'letter-spacing'
    | 'stroke-color'
    | 'stroke-width'
    | 'background-color'
    | 'background-opacity'
    | 'background-radius'
    | 'background-padding'
    | 'background-mode'
    | 'effect'
    | 'zone';

export function captionFontFamilyField(snapshot: TimelineCaptionSelection,
    openFontPanel: () => Promise<boolean>): InspectorFieldDef<TimelineCaptionSelection> {
    const rawFamily = snapshot.effectiveTextStyle?.fontFamily ?? snapshot.textStyle?.fontFamily;
    const family = rawFamily === CAPTION_FONT_FAMILY ? 'Noto Sans JP' : rawFamily ?? 'Noto Sans JP';
    return {
        name: 'caption-font-family', label: 'フォント',
        getValue: () => family,
        actionLabel: `${family}  \u203a`,
        action: async () => await openFontPanel() ? { ok: true }
            : { ok: false, message: 'フォントパネルを開けませんでした。' }
    };
}

export function captionRowFontFace(family: string, loadedFaces: ReadonlyMap<string, string>): string {
    if (family === 'Noto Sans JP' || family === CAPTION_FONT_FAMILY) return CAPTION_FONT_FAMILY;
    const font = CAPTION_PANEL_FONTS.find(entry => entry.family === family);
    return font ? loadedFaces.get(font.id) ?? family : family;
}

export function captionStyleDisplayValue<T>(
    raw: T | undefined,
    effective: T | undefined,
    fallback: T,
    format: (value: T) => string = String
): string {
    const value = effective ?? fallback;
    return raw === undefined ? `${format(value)}（既定）` : format(value);
}

export function isCaptionHexColor(value: string): boolean {
    return /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/iu.test(value);
}

export function effectiveCaptionBackgroundOpacity(style: CaptionTextStyle | undefined): number {
    if (style?.background?.opacity !== undefined) {
        return style.background.opacity;
    }
    const color = style?.background?.color;
    if (!color) {
        return CAPTION_STYLE_DEFAULTS.backgroundOpacity;
    }
    const hex = color.slice(1);
    if (hex.length !== 8) {
        return 1;
    }
    return Number((parseInt(hex.slice(6, 8), 16) / 255).toFixed(4));
}

export function formatPayloadValue(value: unknown): string {
    if (value === null || value === undefined) {
        return '—';
    }
    if (typeof value === 'object') {
        const json = JSON.stringify(value);
        return json.length > 120 ? `${json.slice(0, 117)}...` : json;
    }
    return String(value);
}

export function deriveOverlayType(payload: Record<string, unknown>): string {
    const html = payload.html;
    if (typeof html !== 'string' || html.length === 0) {
        return '—';
    }
    const segments = html.split('/').filter(Boolean);
    if (segments.length >= 3) {
        return segments[segments.length - 2];
    }
    const fileName = segments[segments.length - 1] ?? html;
    return fileName.replace(/\.[^./]+$/, '');
}
