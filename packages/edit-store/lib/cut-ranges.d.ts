export interface CutRange {
    in: number;
    out: number;
    kind: 'row' | 'filler' | 'silence' | 'unrecognized';
    captionId?: string;
    reason?: 'silence' | 'word';
    label?: string;
}
export interface ApplyCutRangesOptions {
    fps?: number;
}
export interface ApplyCutRangesResult {
    source: string;
    removedFrames: number;
    warnings: string[];
}
export interface RestoreCutRangeResult {
    source: string;
    restored: boolean;
    reason?: string;
}
export declare function detectEditVersion(source: string): 0 | 1 | 2;
export declare function applyCutRanges(source: string, ranges: readonly CutRange[], opts?: ApplyCutRangesOptions): ApplyCutRangesResult;
/** Inverts one source-time cut from the surviving media items, without a stored snapshot. */
export declare function restoreCutRange(source: string, range: Pick<CutRange, 'in' | 'out' | 'captionId' | 'reason' | 'label'>): RestoreCutRangeResult;
export declare function canRestoreCutRange(source: string, range: Pick<CutRange, 'in' | 'out' | 'captionId' | 'reason' | 'label'>): string | undefined;
