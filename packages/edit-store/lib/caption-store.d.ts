export declare const CAPTION_ZONES: readonly ["top-left", "top", "top-right", "left", "center", "right", "bottom-left", "bottom", "bottom-right"];
export type CaptionZone = typeof CAPTION_ZONES[number];
export type CaptionBackgroundMode = 'per-line' | 'block';
export interface CaptionTextStyle {
    color?: string;
    sizePx?: number;
    stroke?: {
        color?: string;
        widthPx?: number;
    };
    background?: {
        color?: string;
        opacity?: number;
        radiusPx?: number;
        mode?: CaptionBackgroundMode;
    };
    zone?: CaptionZone;
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
    textStyle?: CaptionTextStyle;
}
export declare function parseCaptions(source: string): {
    captions: CaptionRecord[];
    defaultTextStyle?: CaptionTextStyle;
    warnings: string[];
};
export declare function mergeCaptionTextStyles(defaultStyle: CaptionTextStyle | undefined, captionStyle: CaptionTextStyle | undefined): CaptionTextStyle | undefined;
export declare function shiftCaptionLine(source: string, captionId: string, deltaStart: number, deltaEnd: number): string;
export declare function updateCaptionFieldsInSource(source: string, captionId: string, updates: {
    text?: string;
    speaker?: string | null;
}): string;
export declare function updateCaptionTextStyleInSource(source: string, captionId: string, updates: CaptionTextStylePatch): string;
export declare function insertCaptionLine(source: string, caption: CaptionRecord): string;
export declare function removeCaptionLine(source: string, captionId: string): string;
