/**
 * ブラウザ安全な生成サイドカーの型と純粋関数。
 * fs / crypto を使う読み取りは './generation-meta-node' を明示的に import すること
 * （ここへ Node 専用依存を戻すと browser バンドルに node builtins が混入するため分離している）。
 */
export type GenerationState = 'none' | 'planned' | 'generating' | 'stale' | 'done' | 'failed' | 'orphan';
export interface GenerationMetaV1 {
    version: 1;
    kind: 'still' | 'video' | 'frames';
    status: 'planned' | 'generating' | 'done' | 'failed';
    inputs?: {
        first_frame?: {
            sha256?: string;
        } | null;
        [key: string]: unknown;
    };
    job?: {
        started_at?: string;
        stale_after_s?: number;
        [key: string]: unknown;
    };
    result?: {
        sha256?: string;
        [key: string]: unknown;
    };
    [key: string]: unknown;
}
export interface GenerationBinding {
    expectedSha256: string;
    actualSha256: string | null;
    matches: boolean;
    source: 'result' | 'first_frame';
}
export interface ReadGenerationMetaResult {
    state: GenerationState;
    meta: GenerationMetaV1 | null;
    sidecarPath: string;
    binding: GenerationBinding | null;
}
export declare function sidecarPathFor(sourcePath: string): string;
export declare function bindingShaFor(meta: GenerationMetaV1 | null | undefined): {
    sha256: string;
    source: 'result' | 'first_frame';
} | null;
/**
 * fs に触れず、サイドカー自身が表す状態だけを解決する。
 * `job.stale_after_s` が未指定・不正な場合は既定 900 秒を使う。
 */
export declare function resolveGenerationState(meta: GenerationMetaV1 | null | undefined, now: Date | string | number): GenerationState;
