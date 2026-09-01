export interface CutRange {
    in: number;
    out: number;
    kind: 'row' | 'filler' | 'silence';
    captionId?: string;
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
export declare function detectEditVersion(source: string): 0 | 1 | 2;
export declare function applyCutRanges(source: string, ranges: readonly CutRange[], opts?: ApplyCutRangesOptions): ApplyCutRangesResult;
