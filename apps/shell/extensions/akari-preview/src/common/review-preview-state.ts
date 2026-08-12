export interface ReviewPreviewContext {
    editUri?: string;
    relatedEditUri?: string;
}

export interface RawPreviewFocusState {
    activation: number;
    activeWidgetId?: string;
}

export interface RawPreviewFocusTransition extends RawPreviewFocusState {
    changed: boolean;
}

/**
 * output preview は editUri、raw preview は探索済みの relatedEditUri を録音セッションとの
 * 結合キーにする。raw 自体へ editUri を付与せず、従来の preview identity 契約を維持する。
 */
export function resolveReviewPreviewEditUri(context: ReviewPreviewContext): string | undefined {
    return context.editUri ?? context.relatedEditUri;
}

/** main-area の preview activate/deactivate を単調増加する世代へ変換する。 */
export function transitionRawPreviewFocus(
    current: RawPreviewFocusState,
    nextWidgetId: string | undefined
): RawPreviewFocusTransition {
    if (current.activeWidgetId === nextWidgetId) {
        return { ...current, changed: false };
    }
    return {
        activation: current.activation + 1,
        activeWidgetId: nextWidgetId,
        changed: true
    };
}
