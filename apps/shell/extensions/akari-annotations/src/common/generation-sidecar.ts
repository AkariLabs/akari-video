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

/** 生成中の表示用に、元の枠の記録を保ったまま状態を一時的に進める。 */
export function markPlaceholderGenerating(meta: GenerationSidecarMeta, provider: string, at: string): GenerationSidecarMeta {
    return {
        ...meta,
        status: 'generating',
        job: { ...meta.job, provider, started_at: at, stale_after_s: 600 },
        history: [...(Array.isArray(meta.history) ? meta.history : []), { at, status: 'generating', reason: null }]
    };
}

/** 成功時は元の状態に戻し、処理した履歴を枠に残す。 */
export function finishPlaceholderGenerating(original: GenerationSidecarMeta,
    generating: GenerationSidecarMeta, at: string): GenerationSidecarMeta {
    return { ...original, history: [...(Array.isArray(generating.history) ? generating.history : []),
        { at, status: original.status, reason: null }] };
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
    state: GenerationState, meta?: GenerationSidecarMeta, nowMs = Date.now()
): GenerationChipDescription {
    const progress = state === 'generating' ? generationProgress(meta) : undefined;
    if (state === 'planned-video') {
        const draft = describeNextDraft(meta);
        const variety = { prompt: 'プロンプトだけ', first: '画像から', 'first-last': '最初→最後', references: '参照から' };
        return { badge: '▶ 動画予定', className: 'akari-generation-planned-video',
            title: `動画予定（${variety[draft?.variety ?? 'prompt']}）` };
    }
    if (state === 'planned') {
        if (meta?.kind === 'audio') {
            return { badge: '空の枠（音）', className: 'akari-generation-planned-audio', title: '音の空の枠' };
        }
        const prompt = meta?.inputs?.prompt;
        return { badge: typeof prompt === 'string' && prompt.trim() ? '予定' : '空の枠',
            className: 'akari-generation-planned', title: '生成予定（絵なし）' };
    }
    if (state === 'generating') {
        const startedMs = Date.parse(String(meta?.job?.started_at ?? ''));
        const elapsed = Number.isFinite(startedMs) ? Math.max(0, Math.floor((nowMs - startedMs) / 1000)) : undefined;
        const badge = progress === undefined ? elapsed === undefined ? '生成中' : `生成中 · ${elapsed} 秒`
            : `生成中 ${Math.round(progress)}%`;
        return { badge, progress, className: 'akari-generation-generating', title: badge };
    }
    if (state === 'stale') {
        return { badge: '応答なし・再取得', className: 'akari-generation-stale', title: '生成処理から応答がありません' };
    }
    if (state === 'failed') {
        return { badge: '失敗', className: 'akari-generation-failed', title: '生成に失敗しました · もう一度（右パネルで費用承認）' };
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
