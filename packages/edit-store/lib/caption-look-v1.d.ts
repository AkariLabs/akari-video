export declare const CAPTION_ROW_LOOK_FIELDS: Readonly<Record<string, true | readonly string[]>>;
export declare const CAPTION_RUN_LOOK_FIELDS: Set<string>;
export declare const CAPTION_DEFAULT_SIZE_PX = 38;
export declare function sanitizeMyStyleLook(value: unknown): Record<string, unknown>;
export declare function sanitizeCaptionRunLook(value: unknown): {
    look: Record<string, unknown>;
    omitted: string[];
    notices: string[];
};
/** 保存座標系で px 値だけを換算する。 */
export declare function scaleCaptionLookPixels(look: Record<string, unknown>, targetSize: number): Record<string, unknown>;
/** 旧 API の返り値は size と基準高さを含まない。 */
export declare function scaledLookForCaption(look: Record<string, unknown>, targetSize: number): Record<string, unknown>;
export declare function captionEffectiveSize(row: Record<string, unknown>, defaultStyle: Record<string, unknown>, catalog?: Record<string, {
    style: Record<string, unknown>;
}>): number;
export declare function lookForCaptionAtSize(look: Record<string, unknown>, targetSize: number, referenceHeight?: number, scope?: 'caption' | 'run'): {
    look: Record<string, unknown>;
    notices: string[];
};
export declare function lookForCaptionRow(row: Record<string, unknown>, defaultStyle: Record<string, unknown>, styleLook: Record<string, unknown>, options: {
    size: 'keep' | 'style';
    catalog?: Record<string, {
        style: Record<string, unknown>;
    }>;
}): {
    text_style?: Record<string, unknown>;
    notices: string[];
    reason?: string;
};
export declare function lookForCaptionRun(row: Record<string, unknown>, defaultStyle: Record<string, unknown>, styleLook: Record<string, unknown>, catalog?: Record<string, {
    style: Record<string, unknown>;
}>): {
    look: Record<string, unknown>;
    notices: string[];
};
