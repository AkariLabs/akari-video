import { type CaptionRun } from './caption-runs';
import { type TextstyleCatalog } from './caption-style-preset';
type CaptionRow = Record<string, unknown> & {
    id?: string;
    start?: number;
    end?: number;
    text?: string;
    display_text?: string;
    src?: string;
    runs?: CaptionRun[];
    style_preset?: string;
};
type Emphasis = {
    id: string;
    src?: string;
    t_start: number;
    t_end: number;
    word: string;
    emotion: string;
    style_hint?: string;
    style_preset?: string;
    [key: string]: unknown;
};
type CaptionsRoot = {
    captions: CaptionRow[];
    emphasis_words?: Emphasis[];
    [key: string]: unknown;
};
/** 旧い強調の ID は移行済み run に残った出所 ID も予約済みとして扱う。 */
export declare function nextEmphasisWordId(root: CaptionsRoot | CaptionRow[]): string;
export declare const CAPTION_EMPHASIS_MOTION: Readonly<Record<string, string>>;
export declare function readCaptionLookV1(root: CaptionsRoot | CaptionRow[], catalog: TextstyleCatalog): {
    captions: CaptionRow[];
    notices: string[];
};
export declare function planCaptionLookMigration(captions: CaptionsRoot | CaptionRow[], catalog: TextstyleCatalog, _edit?: unknown): {
    next: CaptionsRoot | CaptionRow[];
    diff: Array<{
        path: string;
        before: unknown;
        after: unknown;
    }>;
    unresolved: Emphasis[];
    notices: string[];
};
/** Restore the renderer's legacy input without changing a legacy-only document. */
export declare function captionRenderInputFromV1<T extends CaptionsRoot | CaptionRow[]>(root: T): T;
export {};
