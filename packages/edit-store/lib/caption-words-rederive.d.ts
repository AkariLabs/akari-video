export declare const KARAOKE_MIN_WORD_MATCH_RATIO = 0.5;
export interface CaptionWordTiming {
    start: number;
    end: number;
    text: string;
}
export interface RederiveResult {
    words: CaptionWordTiming[];
    keptCount: number;
    derivedCount: number;
    matchRatio: number;
    degraded: boolean;
    changedOldRange?: [number, number];
    changedNewRange?: [number, number];
}
export interface CaptionEmphasis {
    t_start: number;
    t_end: number;
    src?: string;
    [key: string]: unknown;
}
export interface CaptionTextEditRecord {
    text: string;
    start: number;
    end: number;
    words?: readonly CaptionWordTiming[];
    display_text?: string;
    display_fragments?: readonly string[];
    edited?: boolean;
    [key: string]: unknown;
}
export declare function rederiveCaptionWords(input: {
    oldText: string;
    newText: string;
    words: readonly CaptionWordTiming[];
    start: number;
    end: number;
}): RederiveResult;
/** Move only emphasis attached to replaced words; report entries that have no timed successor. */
export declare function rebaseCaptionEmphasis<T extends CaptionEmphasis>(input: {
    emphasis: readonly T[];
    oldWords: readonly CaptionWordTiming[];
    result: RederiveResult;
    oldText: string;
    newText: string;
    src?: string;
}): {
    emphasis: T[];
    removed: T[];
};
export declare function applyCaptionTextEdit<T extends CaptionTextEditRecord>(record: T, newText: string): {
    record: T;
    rederive?: RederiveResult;
};
