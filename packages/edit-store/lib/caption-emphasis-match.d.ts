export interface CaptionEmphasisMatchWord {
    id: string;
    src?: string;
    t_start: number;
    t_end: number;
    word: string;
}
/** Visible substring matching used by the preview and untimed exports. */
export declare function captionEmphasisMatches<T extends CaptionEmphasisMatchWord>(text: string, start: number, end: number, words: readonly T[], src?: string): Array<{
    from: number;
    to: number;
    emphasis: T;
}>;
