/** Character-range caption styling. Offsets always count displayed graphemes. */
export interface CaptionRun {
    id?: string;
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
    look?: Record<string, unknown>;
    resolved_look?: {
        plate?: {
            color: string;
            opacity: number;
            padding_px: number;
            radius_px: number;
        };
        outside_effect?: boolean;
        text_shadow?: string;
        ink_outset_px?: number;
        rotate_deg?: number;
        wrappable?: boolean;
        gradient?: string;
        replace_stroke?: boolean;
        replace_shadow?: boolean;
    };
    motion?: {
        in?: CaptionRunAnimationSlot;
        loop?: CaptionRunAnimationSlot;
        out?: CaptionRunAnimationSlot;
    };
    dormant_animation?: CaptionRun['animation'];
    emotion?: string;
    anchor?: {
        src?: string;
        start: number;
        end: number;
        domain: 'source' | 'output';
    };
    fire?: 'shown' | 'spoken' | 'whole';
    fire_was?: 'shown' | 'spoken' | 'whole';
    style_sources?: Record<string, unknown>;
    needs_review?: boolean;
    split_from?: string;
    migrated_from?: string;
    migrated_emphasis?: {
        index: number;
        item: Record<string, unknown>;
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
/** 描画に渡す px 値の浮動小数点誤差をそろえる。 */
export declare function roundCaptionPixel(value: number): number;
/** 複数の差分区間を、書記素 LCS で対応付ける。 */
export declare function rebaseCaptionRuns(oldText: string, newText: string, runs: readonly CaptionRun[], options?: {
    mode?: 'edit' | 'project';
}): {
    runs: CaptionRun[];
    removed: CaptionRun[];
};
/** @deprecated 結合は明示操作だけで行う。 */
export declare function joinAdjacentCaptionRuns(runs: readonly CaptionRun[]): CaptionRun[];
export declare function nextCaptionRunId(runs: readonly CaptionRun[]): string;
export declare function clearCaptionRunRange(runs: readonly CaptionRun[], from: number, to: number, allRuns?: readonly CaptionRun[]): CaptionRun[];
export declare function splitCaptionRuns(text: string, runs: readonly CaptionRun[], splitUtf16: number, leftWindow: {
    start: number;
    end: number;
}, rightWindow: {
    start: number;
    end: number;
}, allRuns?: readonly CaptionRun[]): {
    left?: CaptionRun[];
    right?: CaptionRun[];
};
export interface UnresolvedCaptionRun {
    run: CaptionRun;
    old_caption_id: string;
    old_text: string;
    old_src: string | null;
    old_start: number;
    old_end: number;
    reason: string;
}
export declare function unresolvedRunsForDeletedCaption(caption: {
    id: string;
    text: string;
    src?: string;
    start: number;
    end: number;
    runs?: CaptionRun[];
}, reason?: string): UnresolvedCaptionRun[];
export declare function moveDeletedCaptionRunsToUnresolved<T extends {
    captions: Array<{
        id: string;
        text: string;
        src?: string;
        start: number;
        end: number;
        runs?: CaptionRun[];
    }>;
    unresolved_runs?: UnresolvedCaptionRun[];
}>(root: T, captionId: string, reason?: string): T;
/** Text-only notice for a caller that can present caption edit results to a user. */
export declare function captionRunsRemovedNotice(removedRuns: readonly CaptionRun[], oldDisplayText: string): string | undefined;
/** Self-contained because preview injects this function into its webview with toString(). */
export declare function applyCaptionRunsToHtml(html: string, displayText: string, runs?: readonly CaptionRun[], preserveLineRoot?: boolean, richLayers?: boolean): string;
