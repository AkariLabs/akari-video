export interface FirstRunOnboardingState {
    hasOpenProject: boolean;
    hasCreatorRootPointer: boolean;
    hasProjectHistory: boolean;
    markerSeen: boolean;
}

export type FirstRunSetupStep = 'tools' | 'workspace' | 'connection';
export type FirstRunSetupAction = 'next' | 'back' | 'workspace-created';
export type FirstRunSetupOpenMode = 'automatic' | 'manual';

/**
 * セットアップ面を自動表示するのは完全初回だけ。
 * どれか一つでも利用履歴があれば、明示コマンドからの再表示に限定する。
 */
export function shouldAutoOpenFirstRunSetup(state: FirstRunOnboardingState): boolean {
    return !state.hasOpenProject
        && !state.hasCreatorRootPointer
        && !state.hasProjectHistory
        && !state.markerSeen;
}

/** ダイアログの 3 ステップ遷移。UI から分離し、戻る／進むの境界を固定する。 */
export function nextFirstRunSetupStep(
    step: FirstRunSetupStep,
    action: FirstRunSetupAction
): FirstRunSetupStep {
    if (step === 'tools' && action === 'next') {
        return 'workspace';
    }
    if (step === 'workspace' && action === 'back') {
        return 'tools';
    }
    if (step === 'workspace' && action === 'workspace-created') {
        return 'connection';
    }
    return step;
}

/** 自動表示だけが first-run marker の書き手。明示再表示は既存 marker を更新しない。 */
export function shouldRecordFirstRunMarker(mode: FirstRunSetupOpenMode): boolean {
    return mode === 'automatic';
}
