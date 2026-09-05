export interface AdjustCssBasic {
    exposure?: number;
    contrast?: number;
    highlights?: number;
    shadows?: number;
    blacks?: number;
    whites?: number;
    temperature?: number;
    tint?: number;
    vibrance?: number;
    saturation?: number;
}
export interface AdjustCssInput {
    basic?: AdjustCssBasic | null;
    sections?: {
        basic?: boolean;
    } | null;
}
export interface AdjustCssVisual {
    filter: string;
    /** True when active basic controls contain values that CSS filters cannot reproduce. */
    hasApproximation: boolean;
}
/**
 * Resolves an item's basic colour adjustment and an optional transition filter into the single
 * CSS `filter` seat used by DOM preview media. Returns null only when neither input owns that
 * seat. A basic section with all-zero values deliberately returns `{ filter: '' }`, allowing an
 * edit refresh to clear a previously active adjustment without inventing a CSS no-op.
 */
export declare function computeAdjustCssVisual(adjust: AdjustCssInput | null | undefined, transitionFilter?: string | null): AdjustCssVisual | null;
