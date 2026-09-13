import {
    GenerationMetaV1,
    GenerationState as GenerationStateV1,
    resolveGenerationState as resolveGenerationStateV1,
    sidecarPathFor
} from '@akari-video/edit-store';

export { sidecarPathFor };
export type GenerationState = GenerationStateV1;
export type GenerationSidecarMeta = GenerationMetaV1;

export interface GenerationChipDescription {
    badge: string;
    progress?: number;
    className: string;
    title: string;
}

const TIMELINE_STATES = ['planned', 'generating', 'stale', 'done', 'failed'] as const;
export function resolveGenerationState(meta: GenerationSidecarMeta | undefined, nowMs: number): GenerationState {
    const state = resolveGenerationStateV1(meta, nowMs);
    // v1 のタイムラインは orphan を持たない（sha 結線は未導入）。
    // 契約外の status もここで 'none' に潰す＝従来の最小読み手と同じ見え方にする。
    return (TIMELINE_STATES as readonly string[]).includes(state) ? state : 'none';
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
    // none / orphan は同じ見た目（v1）。
    return { badge: '静止画', className: 'akari-generation-none', title: '静止画（仮枠）' };
}
