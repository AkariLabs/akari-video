export type GenerationState = 'none' | 'planned' | 'generating' | 'stale' | 'done' | 'failed';

export interface GenerationSidecarMeta {
    version?: number;
    kind?: 'still' | 'video' | 'frames' | string;
    status?: 'planned' | 'generating' | 'done' | 'failed' | string;
    progress?: number;
    job?: {
        started_at?: string;
        stale_after_s?: number;
        progress?: number;
        [key: string]: unknown;
    };
    [key: string]: unknown;
}

export interface GenerationChipDescription {
    badge: string;
    progress?: number;
    className: string;
    title: string;
}

export function sidecarPathFor(sourcePath: string): string {
    return `${sourcePath}.meta.json`;
}

export function resolveGenerationState(meta: GenerationSidecarMeta | undefined, nowMs: number): GenerationState {
    if (!meta) return 'none';
    if (meta.status === 'generating') {
        const startedAt = Date.parse(meta.job?.started_at ?? '');
        const staleAfterSeconds = typeof meta.job?.stale_after_s === 'number'
            && Number.isFinite(meta.job.stale_after_s) ? meta.job.stale_after_s : 900;
        if (Number.isFinite(startedAt) && nowMs - startedAt > staleAfterSeconds * 1000) return 'stale';
        return 'generating';
    }
    if (meta.status === 'planned' || meta.status === 'done' || meta.status === 'failed') return meta.status;
    return 'none';
}

function generationProgress(meta: GenerationSidecarMeta | undefined): number | undefined {
    const value = typeof meta?.progress === 'number' ? meta.progress
        : typeof meta?.job?.progress === 'number' ? meta.job.progress : undefined;
    return value !== undefined && Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : undefined;
}

export function describeGenerationChip(
    state: GenerationState, meta?: GenerationSidecarMeta
): GenerationChipDescription {
    const progress = state === 'generating' ? generationProgress(meta) : undefined;
    if (state === 'planned') {
        return { badge: 'planned', className: 'akari-generation-planned', title: '生成予定（絵なし）' };
    }
    if (state === 'generating') {
        const badge = progress === undefined ? '生成中' : `生成中 ${Math.round(progress)}%`;
        return { badge, progress, className: 'akari-generation-generating', title: badge };
    }
    if (state === 'stale') {
        return { badge: '応答なし・再取得', className: 'akari-generation-stale', title: '生成処理から応答がありません' };
    }
    if (state === 'failed') {
        return { badge: '失敗', className: 'akari-generation-failed', title: '生成に失敗しました' };
    }
    if (state === 'done' && meta?.kind === 'video') {
        return { badge: '生成', className: 'akari-generation-done', title: '生成された動画' };
    }
    return { badge: '静止画', className: 'akari-generation-none', title: '静止画（仮枠）' };
}
