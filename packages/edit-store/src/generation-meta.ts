/**
 * ブラウザ安全な生成サイドカーの型と純粋関数。
 * fs / crypto を使う読み取りは './generation-meta-node' を明示的に import すること
 * （ここへ Node 専用依存を戻すと browser バンドルに node builtins が混入するため分離している）。
 */

export type GenerationState = 'none' | 'planned' | 'generating' | 'stale' | 'done' | 'failed' | 'orphan';

export interface GenerationFrameReference {
    sha256?: string;
    path?: string;
    source_id?: string | null;
}

export interface GenerationNextDraft {
    kind: 'video';
    status: 'planned';
    model: { id: string };
    inputs: {
        first_frame?: GenerationFrameReference | null;
        last_frame?: GenerationFrameReference | null;
        prompt?: string;
        frames_or_refs?: 'frames' | 'references';
        [key: string]: unknown;
    };
    output: { duration_s: number; [key: string]: unknown };
    updated_at: string;
}

export interface GenerationMetaV1 {
    version: 1;
    kind: 'still' | 'video' | 'frames';
    status: 'planned' | 'generating' | 'done' | 'failed';
    next?: GenerationNextDraft;
    placeholder?: { path: string; sha256: string; item_id: string };
    inputs?: {
        first_frame?: { sha256?: string; path?: string; source_id?: string | null } | null;
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
    source: 'result' | 'placeholder' | 'first_frame';
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

export function bindingShaFor(
    meta: GenerationMetaV1 | null | undefined
): { sha256: string; source: 'result' | 'placeholder' | 'first_frame' } | null {
    if (meta?.status === 'done' && typeof meta.result?.sha256 === 'string') {
        return { sha256: meta.result.sha256, source: 'result' };
    }
    if (meta?.status !== 'done' && typeof meta?.placeholder?.sha256 === 'string') {
        return { sha256: meta.placeholder.sha256, source: 'placeholder' };
    }
    if (typeof meta?.inputs?.first_frame?.sha256 === 'string') {
        return { sha256: meta.inputs.first_frame.sha256, source: 'first_frame' };
    }
    return null;
}

/**
 * fs に触れず、サイドカー自身が表す状態だけを解決する。
 * `job.stale_after_s` が未指定・不正な場合は既定 900 秒を使う。
 */
export function resolveGenerationState(meta: GenerationMetaV1 | null | undefined, now: Date | string | number): GenerationState {
    if (!meta) return 'none';
    if (meta.status === 'failed') return 'failed';
    if (meta.status === 'generating') {
        const nowMs = now instanceof Date ? now.getTime() : typeof now === 'number' ? now : Date.parse(now);
        const startedMs = Date.parse(String(meta.job?.started_at ?? ''));
        const declaredStaleAfterS = meta.job?.stale_after_s;
        const staleAfterS = typeof declaredStaleAfterS === 'number'
            && Number.isFinite(declaredStaleAfterS)
            && declaredStaleAfterS >= 0
            ? declaredStaleAfterS : 900;
        if (
            Number.isFinite(nowMs)
            && Number.isFinite(startedMs)
            && nowMs - startedMs > staleAfterS * 1000
        ) return 'stale';
    }
    return meta.status;
}

/**
 * item が現在指している素材へ、生成物側の video サイドカーを逆引きする。
 * 選択だけを行い、各 surface 固有の orphan / 契約外 status の解決は呼び出し側へ残す。
 */
export function selectGenerationSidecarForSource<T extends {
    sourcePath: string;
    meta?: GenerationMetaV1 | null;
    binding?: { matches?: boolean } | null;
}>(
    sourcePath: string | undefined,
    entries: readonly T[],
    now: Date | string | number
): T | undefined {
    if (typeof sourcePath !== 'string') return undefined;
    const normalizePath = (value: string): string => value.trim().replace(/\\/gu, '/').replace(/^(?:\.\/)+/u, '');
    const normalizedSourcePath = normalizePath(sourcePath);
    const direct = entries.find(entry => normalizePath(entry.sourcePath) === normalizedSourcePath);
    if (direct?.meta?.kind === 'video') return direct;

    let selected: T | undefined;
    let selectedStartedAt = Number.NEGATIVE_INFINITY;
    for (const entry of entries) {
        const meta = entry.meta;
        if (meta?.kind !== 'video' || entry.binding?.matches === false) continue;
        const firstFramePath = meta.placeholder?.path ?? meta.inputs?.first_frame?.path;
        if (typeof firstFramePath !== 'string' || normalizePath(firstFramePath) !== normalizedSourcePath) continue;
        const state = resolveGenerationState(meta, now);
        if (state !== 'generating' && state !== 'stale' && state !== 'failed') continue;
        const startedAt = Date.parse(String(meta.job?.started_at ?? ''));
        const sortableStartedAt = Number.isFinite(startedAt) ? startedAt : Number.NEGATIVE_INFINITY;
        if (!selected || sortableStartedAt > selectedStartedAt) {
            selected = entry;
            selectedStartedAt = sortableStartedAt;
        }
    }
    return selected ?? direct;
}

/** 動画予定の入力を、描画と右パネルで共用する種類へまとめる。 */
export function describeNextDraft(meta: GenerationMetaV1 | null | undefined): {
    variety: 'prompt' | 'first' | 'first-last' | 'references';
    firstFrame: GenerationFrameReference | null;
    lastFrame: GenerationFrameReference | null;
    prompt: string;
    modelId: string;
} | null {
    const next = meta?.next;
    if (next?.kind !== 'video' || next.status !== 'planned') return null;
    const firstFrame = next.inputs.first_frame ?? null;
    const lastFrame = next.inputs.last_frame ?? null;
    return {
        variety: next.inputs.frames_or_refs === 'references' ? 'references'
            : lastFrame ? 'first-last' : firstFrame ? 'first' : 'prompt',
        firstFrame,
        lastFrame,
        prompt: next.inputs.prompt ?? '',
        modelId: next.model.id,
    };
}
