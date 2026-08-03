/**
 * Caption display policy v1.  This is the single pure implementation used by
 * render-cut, preview-server, and the shell backend.  It deliberately performs
 * no file IO and returns timeline-domain display cues; browser consumers only
 * select a resolved cue by output time.
 */
export declare const CAPTION_DISPLAY_SCHEMA: "caption-layout/v1";
export declare const CAPTION_DISPLAY_MODE: "single_line_sequential";
export declare const CAPTION_DISPLAY_ALGORITHM: "a4-ja-two-fragment-v1";
export declare const CAPTION_UNIT_METRIC: "ascii-half-other-one-v1";
export interface CaptionBreakHints {
    preferred_second_starts?: string[];
    preferred_first_ends?: string[];
    protected_terms?: string[];
}
export interface CaptionDisplayPolicy {
    mode: typeof CAPTION_DISPLAY_MODE;
    algorithm: typeof CAPTION_DISPLAY_ALGORITHM;
    unit_metric: typeof CAPTION_UNIT_METRIC;
    max_line_units: number;
    minimum_fragment_duration_seconds: number;
    locale: string;
    break_hints?: CaptionBreakHints;
}
export interface CaptionDisplayCue {
    id: string;
    source_cue_id: string;
    src: string | null;
    cut_index: number;
    occurrence_index: number;
    fragment_index: number;
    fragment_count: number;
    start: number;
    end: number;
    text: string;
    units: number;
    line_override: boolean;
    text_style?: Record<string, unknown>;
    style_vars?: Record<string, string>;
    layout?: ResolvedCaptionLayout;
}
export interface CaptionBoundaryProjection {
    source_cue_id: string;
    text: string;
    boundaries: number[];
}
export interface CaptionDisplayResult {
    schema: typeof CAPTION_DISPLAY_SCHEMA;
    policy: CaptionDisplayPolicy;
    source_cue_count: number;
    occurrence_count: number;
    display_cue_count: number;
    split_source_cue_count: number;
    boundary_projection: CaptionBoundaryProjection[];
    display_cues: CaptionDisplayCue[];
}
export interface ResolvedCaptionLayout {
    mode: 'reference-pixel';
    reference_width_px: number;
    reference_height_px: number;
    left_px: number;
    width_px: number;
    right_px: number;
    center_x_px: number;
    bottom_px: number;
    text_align: 'center';
    max_lines: 1;
    scale: number;
}
type UnknownRecord = Record<string, any>;
export declare class CaptionDisplayError extends Error {
    readonly code: string;
    constructor(code: string, message: string);
}
export declare function measureCaptionUnits(text: string): number;
export declare function validateCaptionDisplayPolicy(value: unknown): CaptionDisplayPolicy;
export declare function resolveCaptionDisplay(captionsRoot: unknown, edit: UnknownRecord, options?: {
    output?: {
        width: number;
        height: number;
    };
}): CaptionDisplayResult | null;
/**
 * Strict captions.schema textStyle validation for the opt-in display-policy kernel.
 * Validation happens on each source object before merge so a valid override can never
 * conceal an invalid default (or vice versa).
 */
export declare function validateCaptionTextStyle(value: unknown, label?: string): UnknownRecord;
export declare function splitCaptionFragments(text: string, policy: CaptionDisplayPolicy): {
    fragments: string[];
    boundaries: number[];
};
export declare function scheduleCaptionFragments(start: number, end: number, fragments: string[], minimumSeconds: number): Array<{
    start: number;
    end: number;
    text: string;
}>;
export declare function mergeCaptionDisplayStyles(base: unknown, override: unknown): UnknownRecord | undefined;
export declare function resolveCaptionStyleForOutput(style: UnknownRecord, output: {
    width: number;
    height: number;
} | undefined): {
    vars: Record<string, string>;
    layout?: ResolvedCaptionLayout;
};
export declare function formatCssNumber(value: number): string;
export {};
