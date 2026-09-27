import type { CaptionTextStyle } from './caption-store';

export interface CaptionPanelPreviewState {
    active: { captionId: string; textStyle: CaptionTextStyle } | null;
}

export type CaptionPanelPreviewAction =
    | { type: 'enter'; captionId: string; textStyle: CaptionTextStyle }
    | { type: 'leave' | 'escape' }
    | { type: 'confirm'; captionId: string };

export interface CaptionPanelPreviewTransition {
    state: CaptionPanelPreviewState;
    detail?: { captionId: string; textStyle: CaptionTextStyle | null };
    commit: boolean;
    close: boolean;
}

export function shouldCaptureCaptionPanelPreviewEscape(state: CaptionPanelPreviewState, key: string): boolean {
    return key === 'Escape' && state.active !== null;
}

/** Produces UI effects as data; callers dispatch notifications and writes separately. */
export function advanceCaptionPanelPreview(state: CaptionPanelPreviewState,
    action: CaptionPanelPreviewAction): CaptionPanelPreviewTransition {
    if (action.type === 'enter') {
        if (state.active?.captionId === action.captionId && state.active.textStyle === action.textStyle) {
            return { state, commit: false, close: false };
        }
        return { state: { active: { captionId: action.captionId, textStyle: action.textStyle } },
            detail: { captionId: action.captionId, textStyle: action.textStyle }, commit: false, close: false };
    }
    const previous = state.active;
    if (action.type === 'escape' && !previous) return { state, commit: false, close: true };
    return { state: { active: null },
        detail: previous || action.type === 'confirm'
            ? { captionId: action.type === 'confirm' ? action.captionId : previous!.captionId, textStyle: null }
            : undefined,
        commit: action.type === 'confirm', close: false };
}
