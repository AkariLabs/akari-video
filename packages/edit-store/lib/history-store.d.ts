export declare const DEFAULT_HISTORY_FILES: readonly ["edit.json", "captions.json"];
export declare const DEFAULT_HISTORY_KEEP = 100;
export interface HistoryMeta {
    id: string;
    label: string;
    at: string;
    files: string[];
    sha256: Record<string, string>;
    legacy?: boolean;
    bytes?: number;
}
export interface SnapshotOptions {
    projectDir: string;
    label: string;
    files?: readonly string[];
    keep?: number;
    now?: Date;
}
export interface RestoreOptions {
    files?: readonly string[];
    write?: (files: Record<string, string>) => Promise<void>;
}
export interface RestoreResult {
    restored: HistoryMeta;
    snapshot: HistoryMeta | null;
}
export declare function snapshot(options: SnapshotOptions): Promise<HistoryMeta | null>;
export declare function list(projectDir: string): Promise<HistoryMeta[]>;
export declare function restore(projectDir: string, id: string, options?: RestoreOptions): Promise<RestoreResult>;
