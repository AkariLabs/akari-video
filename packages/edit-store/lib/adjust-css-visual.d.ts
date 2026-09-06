import type { AdjustCurvesV1, AdjustWheelsV1, AdjustHueCurvesV1 } from './edit-v2';
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
    curves?: AdjustCurvesV1;
    wheels?: AdjustWheelsV1;
    hue?: AdjustHueCurvesV1;
    fx?: readonly {
        id: string;
        px?: number;
    }[] | null;
    sections?: {
        basic?: boolean;
        lut?: boolean;
        curves?: boolean;
        wheels?: boolean;
        hue?: boolean;
        fx?: boolean;
    } | null;
}
export interface AdjustCssVisual {
    filter: string;
    /** True when active controls contain values that CSS filters cannot reproduce. */
    hasApproximation: boolean;
}
/**
 * Resolves an item's basic colour adjustment and an optional transition filter into the single
 * CSS `filter` seat used by DOM preview media. Returns null only when neither input owns that
 * seat. A basic section with all-zero values deliberately returns `{ filter: '' }`, allowing an
 * edit refresh to clear a previously active adjustment without inventing a CSS no-op.
 * Active fx approximate only blur with CSS, after basic filters and before the transition.
 * Other fx are not applied and are disclosed through hasApproximation.
 */
export declare function computeAdjustCssVisual(adjust: AdjustCssInput | null | undefined, transitionFilter?: string | null, blurScale?: number): AdjustCssVisual | null;
