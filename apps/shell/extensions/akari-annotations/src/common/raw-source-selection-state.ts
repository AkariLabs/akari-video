export interface RawPreviewAnnotationStateSnapshot {
    active: boolean;
    activation: number;
    mediaUri?: string;
    sourceT?: number;
    reason: 'focus' | 'playback';
}

export interface RawSourceSelectionSnapshot {
    activation: number;
    mediaUri: string;
    sourceT: number;
    src: string;
}

export interface RawSourceSelectionState {
    latest?: RawPreviewAnnotationStateSnapshot;
    selection?: RawSourceSelectionSnapshot;
    suppressedActivation?: number;
}

export interface RawSourceSelectionTransition {
    state: RawSourceSelectionState;
    needsResolution: boolean;
}

function isUsableRawPreviewState(
    state: RawPreviewAnnotationStateSnapshot | undefined
): state is RawPreviewAnnotationStateSnapshot & { mediaUri: string; sourceT: number } {
    return state?.active === true && Boolean(state.mediaUri) && Number.isFinite(state.sourceT);
}

export function sameRawPreviewIdentity(
    left: Pick<RawPreviewAnnotationStateSnapshot, 'activation' | 'mediaUri'> | undefined,
    right: Pick<RawPreviewAnnotationStateSnapshot, 'activation' | 'mediaUri'> | undefined
): boolean {
    return Boolean(left && right
        && left.activation === right.activation
        && left.mediaUri === right.mediaUri);
}

/**
 * preview の focus/playback 通知を composer の選択状態へ還元する。
 * 新しい activation の解決中に以前の selection を表示・送信しないことが重要。
 */
export function transitionRawSourceSelection(
    current: RawSourceSelectionState,
    incoming: RawPreviewAnnotationStateSnapshot | undefined
): RawSourceSelectionTransition {
    if (!isUsableRawPreviewState(incoming)) {
        return { state: {}, needsResolution: false };
    }
    const latest = { ...incoming, sourceT: Math.max(0, incoming.sourceT) };
    if (current.suppressedActivation === latest.activation) {
        return {
            state: { ...current, latest, selection: undefined },
            needsResolution: false
        };
    }
    if (sameRawPreviewIdentity(current.selection, latest)) {
        return {
            state: {
                ...current,
                latest,
                selection: { ...current.selection!, sourceT: latest.sourceT }
            },
            needsResolution: false
        };
    }
    return {
        state: { ...current, latest, selection: undefined },
        needsResolution: true
    };
}

export function applyResolvedRawSourceSelection(
    current: RawSourceSelectionState,
    resolvedFor: Pick<RawPreviewAnnotationStateSnapshot, 'activation' | 'mediaUri'>,
    src: string | undefined
): RawSourceSelectionState {
    const latest = current.latest;
    if (!src || !isUsableRawPreviewState(latest)
        || !sameRawPreviewIdentity(latest, resolvedFor)
        || current.suppressedActivation === latest.activation) {
        return { ...current, selection: undefined };
    }
    return {
        ...current,
        selection: {
            activation: latest.activation,
            mediaUri: latest.mediaUri,
            sourceT: latest.sourceT,
            src
        }
    };
}

export function suppressRawSourceSelection(current: RawSourceSelectionState): RawSourceSelectionState {
    const activation = current.selection?.activation ?? current.latest?.activation;
    return {
        ...current,
        selection: undefined,
        ...(activation === undefined ? {} : { suppressedActivation: activation })
    };
}
