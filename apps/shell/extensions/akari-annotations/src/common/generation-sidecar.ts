import {
    describeNextDraft,
    GenerationMetaV1,
    GenerationState as GenerationStateV1,
    resolveGenerationState as resolveGenerationStateV1,
    sidecarPathFor
} from '@akari-video/edit-store';

export { sidecarPathFor };
export type GenerationState = GenerationStateV1 | 'planned-video';
export type GenerationSidecarMeta = GenerationMetaV1;

export interface GenerationBindingView {
    expected: string;
    actual: string | null;
    matches: boolean;
    source: 'result' | 'first_frame' | 'placeholder';
}

export interface GenerationChipDescription {
    badge: string;
    progress?: number;
    className: string;
    title: string;
}

const TIMELINE_STATES = ['planned', 'generating', 'stale', 'done', 'failed'] as const;
export function resolveGenerationState(
    meta: GenerationSidecarMeta | undefined, nowMs: number, binding?: GenerationBindingView | null
): GenerationState {
    if (binding && binding.matches === false) return 'orphan';
    const state = resolveGenerationStateV1(meta, nowMs);
    if (!['generating', 'stale', 'failed'].includes(state) && describeNextDraft(meta)) return 'planned-video';
    // 契約外の status は 'none' に潰す＝従来の最小読み手と同じ見え方にする。
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
    if (state === 'planned-video') {
        const draft = describeNextDraft(meta);
        const variety = { prompt: 'プロンプトだけ', first: '画像から', 'first-last': '最初→最後', references: '参照から' };
        return { badge: '▶ 動画予定', className: 'akari-generation-planned-video',
            title: `動画予定（${variety[draft?.variety ?? 'prompt']}）` };
    }
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
    if (state === 'orphan') {
        return {
            badge: '孤児', className: 'akari-generation-orphan',
            title: '素材が変わりました（meta の sha256 と一致しません）'
        };
    }
    if (state === 'done' && meta?.kind === 'video') {
        return { badge: '生成', className: 'akari-generation-done', title: '生成された動画' };
    }
    // none と done の still は完成品の静止画として見せる。
    return { badge: '静止画', className: 'akari-generation-none', title: '静止画' };
}
