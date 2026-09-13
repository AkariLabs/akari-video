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
        first_frame?: { sha256?: string } | null;
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

export function sidecarPathFor(sourcePath: string): string {
    return `${sourcePath}.meta.json`;
}

/** fs に触れず、サイドカー自身が表す状態だけを解決する。 */
export function resolveGenerationState(meta: GenerationMetaV1 | null | undefined, now: Date | string | number): GenerationState {
    if (!meta) return 'none';
    if (meta.status === 'failed') return 'failed';
    if (meta.status === 'generating') {
        const nowMs = timeValue(now);
        const startedMs = Date.parse(String(meta.job?.started_at ?? ''));
        const staleAfterS = meta.job?.stale_after_s;
        if (
            Number.isFinite(nowMs)
            && Number.isFinite(startedMs)
            && typeof staleAfterS === 'number'
            && nowMs - startedMs > staleAfterS * 1000
        ) return 'stale';
    }
    return meta.status;
}

function timeValue(value: Date | string | number): number {
    return value instanceof Date ? value.getTime() : typeof value === 'number' ? value : Date.parse(value);
}
