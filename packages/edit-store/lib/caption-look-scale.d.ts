export declare const CAPTION_LOOK_PX_FIELDS: Readonly<Record<string, readonly string[]>>;
export declare const CAPTION_LOOK_RATIO_TOLERANCE = 0.000001;
export declare function scaledCaptionLookPart(key: string, value: unknown, ratio: number): unknown;
export declare function captionLookHasPixels(key: string, value: unknown): boolean;
export declare function captionLookPartRatio(key: string, preset: unknown, override: unknown, compareNonPx?: boolean): number | undefined;
export declare function fillMissingCaptionLookPixels(key: string, preset: unknown, override: unknown, ratio: number): unknown | undefined;
/** Copy only visual components; the caller keeps the caption's own size and reference height. */
export declare function scaledCaptionLook(look: Record<string, unknown>, targetSize: number): Record<string, unknown>;
export declare function captionPresetDerivedParts(preset: Record<string, unknown>, override: Record<string, unknown>): Map<string, number>;
