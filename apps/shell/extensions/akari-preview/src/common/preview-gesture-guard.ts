export interface PreviewGestureRefresh {
    seekTimeOverride?: number;
    forceRebuild: boolean;
    editSource?: string;
}

export interface PreviewGestureGuard {
    active: boolean;
    writeRevision?: number;
    pending?: PreviewGestureRefresh;
}

export type PreviewGestureEvent =
    | { type: 'begin' }
    | { type: 'saved' }
    | { type: 'end' }
    | { type: 'refresh'; request: PreviewGestureRefresh };

/** Gesture 中の要求を 1 件へ畳む。タイマーや Promise に依存しないキュー部分。 */
export function reducePreviewGesture(
    state: PreviewGestureGuard,
    event: PreviewGestureEvent
): { state: PreviewGestureGuard; refresh?: PreviewGestureRefresh } {
    if (event.type === 'begin') return { state: { ...state, active: true } };
    if (event.type === 'saved') {
        if (!state.active) return { state };
        // 保存応答以前の本文だけを失効させる。それ以降の通知本文は end まで保持する。
        return { state: {
            ...state,
            writeRevision: (state.writeRevision ?? 0) + 1,
            pending: state.pending ? { ...state.pending, editSource: undefined } : undefined
        } };
    }
    if (event.type === 'end') {
        if (!state.active) return { state };
        // end 自体は refresh の理由ではない。自己書き込みは従来の抑止経路を維持する。
        return {
            state: { active: false, writeRevision: state.writeRevision },
            refresh: state.pending
        };
    }
    if (!state.active) return { state, refresh: event.request };
    return {
        state: {
            ...state,
            active: true,
            pending: {
                ...event.request,
                seekTimeOverride: event.request.seekTimeOverride ?? state.pending?.seekTimeOverride,
                forceRebuild: event.request.forceRebuild || (state.pending?.forceRebuild ?? false)
            }
        }
    };
}
