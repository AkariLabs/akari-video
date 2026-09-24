/** Character-range caption styling. Offsets always count displayed graphemes. */
export interface CaptionRun {
    from: number;
    to: number;
    role?: string;
    style?: {
        color?: string;
        font_weight?: number;
        scale?: number;
        baseline_shift_em?: number;
        rotate_deg?: number;
        letter_spacing_em?: number;
        stroke?: {
            method?: 'webkit-outline';
            color?: string;
            width_px?: number;
        };
        italic?: boolean;
        underline?: boolean;
    };
    animation?: {
        in?: CaptionRunAnimationSlot;
        loop?: CaptionRunAnimationSlot;
        out?: CaptionRunAnimationSlot;
    };
}
export interface CaptionRunAnimationSlot {
    id: string;
    duration_sec?: number;
    ease?: string | null;
    amp?: number | null;
}
export interface ResolvedCaptionRunChar {
    text: string;
    index: number;
    role?: string;
    style?: CaptionRun['style'];
    animation?: CaptionRun['animation'];
}
export declare function captionGraphemes(text: string): string[];
export type CaptionRunStyle = NonNullable<CaptionRun['style']>;
export type CaptionRunStyleField = keyof CaptionRunStyle;
/** The last matching run owns edits to a range, preserving the order of overlapping runs. */
export declare function setCaptionRunStyle(text: string, runs: readonly CaptionRun[] | undefined, from: number, to: number, patch: CaptionRunStyle): CaptionRun[];
export declare function setCaptionRunRole(text: string, runs: readonly CaptionRun[] | undefined, from: number, to: number, role: string): CaptionRun[];
export declare function removeCaptionRun(runs: readonly CaptionRun[] | undefined, index: number): CaptionRun[];
/** Map only the nine v0 fields from a saved look. */
export declare function captionRunStyleFromLook(look: Record<string, unknown>, baseSizePx?: number): {
    style: CaptionRunStyle;
    omitted: string[];
};
export declare function resolveCaptionRuns(text: string, runs?: readonly CaptionRun[]): ResolvedCaptionRunChar[];
/** Project a displayed substring, including one side of a manual line split. */
export declare function sliceCaptionRuns(text: string, runs: readonly CaptionRun[] | undefined, start: number, end: number): CaptionRun[] | undefined;
/** Rebase a minimal grapheme diff; a deleted range removes its run. */
export declare function rebaseCaptionRuns(oldText: string, newText: string, runs: readonly CaptionRun[]): {
    runs: CaptionRun[];
    removed: CaptionRun[];
};
export declare function joinAdjacentCaptionRuns(runs: readonly CaptionRun[]): CaptionRun[];
/** Text-only notice for a caller that can present caption edit results to a user. */
export declare function captionRunsRemovedNotice(removedRuns: readonly CaptionRun[], oldDisplayText: string): string | undefined;
/** Self-contained because preview injects this function into its webview with toString(). */
export declare function applyCaptionRunsToHtml(html: string, displayText: string, runs?: readonly CaptionRun[]): string;
