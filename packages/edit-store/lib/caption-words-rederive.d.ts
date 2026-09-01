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
export declare function applyCaptionTextEdit<T extends CaptionTextEditRecord>(record: T, newText: string): {
    record: T;
    rederive?: RederiveResult;
};
