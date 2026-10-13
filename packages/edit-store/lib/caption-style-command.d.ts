import { type CaptionRun } from './caption-runs';
import { type TextstyleCatalog } from './caption-style-preset';
type Row = Record<string, unknown> & {
    id?: string;
    text?: string;
    display_text?: string;
    runs?: CaptionRun[];
};
export type CaptionRoot = Row[] | {
    captions: Row[];
    default_text_style?: Record<string, unknown>;
    unresolved_runs?: Array<{
        run?: CaptionRun;
    }>;
    [key: string]: unknown;
};
export type CaptionStyleSource = {
    kind: 'builtin' | 'library' | 'my';
    id: string;
    uid?: string;
    revision?: number;
};
/** caption_index は既存 CLI の index 指定との互換に限る。 */
export type CaptionStyleTarget = ({
    caption_id: string;
    caption_index?: never;
} | {
    caption_index: number;
    caption_id?: never;
}) & {
    range?: {
        from: number;
        to: number;
    } | {
        quote: string;
        occurrence?: number;
    };
    parts?: CaptionStyleParts;
} | {
    default: true;
};
export type CaptionStyleParts = {
    look?: Record<string, unknown>;
    motion?: Record<string, unknown>;
    sfx?: unknown;
    effect?: unknown;
};
/** 既存の入口の互換のためだけ。新しい画面・RPC・CLI には公開しない。 */
export type CaptionStyleLegacy = {
    merge?: 'deep';
    size?: 'style';
    preset?: 'drop';
};
export type CaptionStyleEditInput = {
    captions: CaptionRoot;
    edit?: unknown;
    assetReferences?: unknown;
    targets: CaptionStyleTarget[];
    parts: CaptionStyleParts;
    source?: CaptionStyleSource;
    catalog?: TextstyleCatalog;
    now?: string | Date;
    legacy?: CaptionStyleLegacy;
};
type Plan = {
    next: {
        captions: CaptionRoot;
        edit?: unknown;
        assetReferences?: unknown;
    };
    changed: string[];
    notices: string[];
};
export declare function planCaptionStyleEdit(input: CaptionStyleEditInput): Plan;
export type CaptionClearTarget = {
    caption_id: string;
    run_id?: string;
    range?: {
        from: number;
        to: number;
    } | {
        quote: string;
        occurrence?: number;
    };
};
export declare function planCaptionStyleClear(input: {
    captions: CaptionRoot;
    targets: CaptionClearTarget[];
    mode: 'run' | 'range';
}): Plan;
export type ReapplyItem = {
    target: CaptionStyleTarget;
    part: 'look' | 'motion';
    source: Record<string, unknown>;
    status: 'same' | 'updated' | 'missing';
    modified: boolean;
};
export declare function planCaptionStyleReapply(input: {
    captions: CaptionRoot;
    targets?: CaptionStyleTarget[];
    styles: {
        builtin?: TextstyleCatalog;
        lookup?: (source: Record<string, unknown>) => {
            look?: Record<string, unknown>;
            motion?: Record<string, unknown>;
            revision?: number;
        } | undefined;
    };
    apply?: Array<{
        target: CaptionStyleTarget;
        part: 'look' | 'motion';
    }>;
}): {
    items: ReapplyItem[];
    next?: {
        captions: CaptionRoot;
    };
    notices: string[];
};
export declare function planCaptionSizeEdit(input: {
    captions: CaptionRoot;
    targets: Array<{
        caption_id: string;
    }>;
    size_px: number;
}): Plan;
export {};
