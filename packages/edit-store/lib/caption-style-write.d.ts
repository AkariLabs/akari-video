import { planCaptionStyleReapply, type CaptionStyleEditInput, type CaptionClearTarget, type CaptionStyleTarget } from './caption-style-command';
import { planCaptionLookMigration } from './caption-look-reader';
import type { TextstyleCatalog } from './caption-style-preset';
import { type TransactionOptions, type DeferredLintOptions } from './write-gate';
type FileVersion = {
    text: string | null;
    hash: string | null;
};
export type CaptionWriteOptions = {
    files?: {
        captions?: string;
        edit?: string;
    };
    expectedHashes?: Record<string, string | null>;
    appVersion?: string;
    onDidWrite?: (path: string, content: string) => void;
    onWillWrite?: TransactionOptions['onWillWrite'];
    onLintResult?: DeferredLintOptions['onLintResult'];
    debounceMs?: DeferredLintOptions['debounceMs'];
    lintRunner?: DeferredLintOptions['lintRunner'];
    catalog?: TextstyleCatalog;
    onRecovered?: (notice: string) => void;
    hooks?: TransactionOptions['hooks'];
    beforeCommit?: () => void | Promise<void>;
};
type WriteResult = {
    written: string[];
    notices: string[];
    notice_codes: Array<{
        code: string;
        params?: Record<string, string | number>;
    }>;
    changed: string[];
    recovered?: string;
    before: Record<string, FileVersion>;
    after: Record<string, FileVersion>;
};
export declare function applyCaptionStyle(projectRoot: string, input: Omit<CaptionStyleEditInput, 'captions'>, options?: CaptionWriteOptions): Promise<WriteResult>;
export declare function clearCaptionStyle(projectRoot: string, input: {
    targets: CaptionClearTarget[];
    mode: 'run' | 'range';
}, options?: CaptionWriteOptions): Promise<WriteResult>;
export declare function reapplyCaptionStyle(projectRoot: string, input: {
    targets?: CaptionStyleTarget[];
    styles: Parameters<typeof planCaptionStyleReapply>[0]['styles'];
    apply?: Parameters<typeof planCaptionStyleReapply>[0]['apply'];
}, options?: CaptionWriteOptions): Promise<WriteResult & {
    items: ReturnType<typeof planCaptionStyleReapply>['items'];
}>;
export declare function setCaptionSize(projectRoot: string, input: {
    targets: Array<{
        caption_id: string;
    }>;
    size_px: number;
}, options?: CaptionWriteOptions): Promise<WriteResult>;
export declare function applyCaptionLookMigration(projectRoot: string, options?: CaptionWriteOptions & {
    dryRun?: boolean;
}): Promise<WriteResult & {
    diff: ReturnType<typeof planCaptionLookMigration>['diff'];
}>;
export {};
