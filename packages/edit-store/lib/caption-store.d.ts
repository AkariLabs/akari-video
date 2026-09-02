import { type CaptionWordTiming } from './caption-words-rederive';
export declare const CAPTION_ZONES: readonly ["top-left", "top", "top-right", "left", "center", "right", "bottom-left", "bottom", "bottom-right"];
export type CaptionZone = typeof CAPTION_ZONES[number];
export type CaptionBackgroundMode = 'per-line' | 'block';
export type CaptionAlign = 'left' | 'center' | 'right';
export type CaptionVerticalAlign = 'top' | 'middle' | 'bottom';
export type CaptionTextTransform = 'upper' | 'uppercase' | 'lower' | 'lowercase' | 'title' | 'capitalize' | 'none';
export type CaptionTextAnchor = 'tl' | 'tc' | 'tr' | 'ml' | 'mc' | 'mr' | 'bl' | 'bc' | 'br';
export type CaptionStrokeMethod = 'webkit-outline';
export interface CaptionAnimationSlot {
    id: string;
    durationSec?: number;
    ease?: string;
    amp?: number;
}
export interface CaptionAnimation {
    in?: CaptionAnimationSlot;
    loop?: CaptionAnimationSlot;
    out?: CaptionAnimationSlot;
}
export interface CaptionShadow {
    color: string;
    opacity?: number;
    blurPx?: number;
    distancePx?: number;
    angleDeg?: number;
}
export interface CaptionGlow {
    color: string;
    density?: number;
    spread?: number;
    offsetX?: number;
    offsetY?: number;
}
export interface CaptionPosition {
    x?: number;
    y?: number;
}
export interface CaptionLayout {
    mode: 'reference-pixel';
    referenceWidthPx: number;
    referenceHeightPx: number;
    leftPx: number;
    widthPx: number;
    bottomPx: number;
    textAlign: 'center';
    maxLines: 1;
}
export interface CaptionTextStyle {
    color?: string;
    sizePx?: number;
    /** zone 方式の px 系フィールドの基準出力高さ（issue #40 §2）。integer ≥ 1。layout と排他。 */
    referenceHeightPx?: number;
    fontFamily?: string;
    fontWeight?: number;
    weight?: number;
    italic?: boolean;
    underline?: boolean;
    letterSpacingEm?: number;
    lineHeight?: number;
    align?: CaptionAlign;
    verticalAlign?: CaptionVerticalAlign;
    vertical?: boolean;
    textTransform?: CaptionTextTransform;
    maxWidthPct?: number;
    textAnchor?: CaptionTextAnchor;
    position?: CaptionPosition;
    shadow?: CaptionShadow;
    glow?: CaptionGlow;
    animation?: CaptionAnimation;
    stroke?: {
        method?: CaptionStrokeMethod;
        color?: string;
        widthPx?: number;
    };
    background?: {
        color?: string;
        opacity?: number;
        radiusPx?: number;
        paddingPx?: number;
        widthPct?: number;
        heightPct?: number;
        offsetX?: number;
        offsetY?: number;
        mode?: CaptionBackgroundMode;
    };
    zone?: CaptionZone;
    layout?: CaptionLayout;
}
export interface CaptionTextStylePatch {
    color?: string | null;
    sizePx?: number | null;
    stroke?: {
        color?: string | null;
        widthPx?: number | null;
    };
    background?: {
        color?: string | null;
        opacity?: number | null;
        radiusPx?: number | null;
        mode?: CaptionBackgroundMode | null;
    };
    zone?: CaptionZone | null;
}
export interface CaptionRecord {
    id: string;
    start: number;
    end: number;
    text: string;
    speaker: string | null;
    sourceRef: {
        segment: number;
    } | null;
    edited: boolean;
    src?: string;
    words?: CaptionWordTiming[];
    unrecognized?: {
        start: number;
        end: number;
    }[];
    style?: 'karaoke' | 'pop' | 'reveal' | 'reveal-word';
    displayText?: string;
    displayFragments?: string[];
    stylePreset?: string;
    /** 省略時は source。output は edit.json の出力時間軸を直接参照する。 */
    timeDomain?: 'source' | 'output';
    textStyle?: CaptionTextStyle;
    extra?: Record<string, unknown>;
}
export interface WordBookCaptionChange {
    id: string;
    text: string;
    words?: CaptionWordTiming[];
    display_text?: string;
    display_fragments?: string[];
}
export declare function parseCaptions(source: string): {
    captions: CaptionRecord[];
    defaultTextStyle?: CaptionTextStyle;
    warnings: string[];
};
export declare function mergeCaptionTextStyles(defaultStyle: CaptionTextStyle | undefined, captionStyle: CaptionTextStyle | undefined): CaptionTextStyle | undefined;
export declare function shiftCaptionLine(source: string, captionId: string, deltaStart: number, deltaEnd: number): string;
/** 字幕の時刻と domain を絶対値で更新する。undo は元値をそのまま渡して完全復元できる。 */
export declare function setCaptionTimingLine(source: string, captionId: string, start: number, end: number, timeDomain: 'source' | 'output' | null | undefined, edited: boolean): string;
export declare function updateCaptionFieldsInSource(source: string, captionId: string, updates: {
    text?: string;
    speaker?: string | null;
    unrecognized?: ReadonlyArray<{
        start: number;
        end: number;
    }> | null;
}): string;
export declare function applyWordBookToCaptionsInSource(source: string, changes: WordBookCaptionChange[]): string;
export declare function updateCaptionTextStyleInSource(source: string, captionId: string, updates: CaptionTextStylePatch): string;
export declare function insertCaptionLine(source: string, caption: CaptionRecord): string;
export declare function removeCaptionLine(source: string, captionId: string): string;
