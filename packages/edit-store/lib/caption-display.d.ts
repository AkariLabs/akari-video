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
/**
 * zone 方式の px 系フィールドに掛ける scale（issue #40 §2）。`reference_height_px` が無ければ 1
 * （既存出力はバイト同一）。あれば output.height / reference_height_px — 基準は高さ（文字サイズは
 * 縦方向の量。縦型出力でも自然）。`layout`（reference-pixel）との併用は禁止。output.height が無いと
 * layout 経路の INVALID_OUTPUT_GEOMETRY と同型で fail する。render-cut の captionTextStyleVars と
 * gpu-export page-builder はこの単一定義を使い、GPU / OSR の両経路で同じ実効 px になる。
 */
export declare function resolveCaptionReferenceScale(style: unknown, output: {
    width?: number;
    height?: number;
} | undefined): number;
/**
 * 宣言 px × scale。scale === 1 なら値をそのまま返す（`${value}` の文字列が従来とバイト同一）。
 * それ以外は小数 6 桁へ丸めて浮動小数の端数（0.1 × 3 = 0.30000000000000004）を CSS に漏らさない。
 */
export declare function scaleCaptionPx(value: number, scale: number): number;
/**
 * text_anchor（9 点）+ position（0..1 相対）→ プレート配置の CSS 変数。単一定義
 * （プレビュー = shell captionTextStyleVars / 書き出し = render-cut captions.mjs の両消費者が
 * これを使う — 2026-08-26 akari-reel 実機: プレビュー側だけ text_anchor/position を落として
 * 明示位置付き字幕が既定の下段 7% に出る「出力とプレビューの位置不一致」の再発防止）。
 * position 未指定なら anchor は zone 相当の縁寄せとして効く。position.y 指定時は
 * b は下端、t は上端、m は中心をその座標へ合わせる。
 * 不正な anchor / vertical_align は未宣言として無視する（書き込み時検証済みが前提の防御）。
 */
export declare function captionAnchorPositionVars(anchorValue: unknown, positionValue: unknown, verticalAlignValue: unknown): Record<string, string>;
export declare function resolveCaptionStyleForOutput(style: UnknownRecord, output: {
    width: number;
    height: number;
} | undefined): {
    vars: Record<string, string>;
    layout?: ResolvedCaptionLayout;
};
export declare function formatCssNumber(value: number): string;
export {};
