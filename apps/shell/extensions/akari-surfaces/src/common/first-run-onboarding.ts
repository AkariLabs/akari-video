export interface FirstRunOnboardingState {
    hasOpenProject: boolean;
    hasCreatorRootPointer: boolean;
    hasProjectHistory: boolean;
    markerSeen: boolean;
}

export type FirstRunSetupStep = 'tools' | 'workspace' | 'library' | 'connection';
export type FirstRunSetupAction = 'next' | 'back' | 'workspace-created' | 'skip';
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

/** ダイアログの 4 ステップ遷移。 */
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
        return 'library';
    }
    if (step === 'library' && action === 'back') {
        return 'workspace';
    }
    if (step === 'library' && (action === 'next' || action === 'skip')) {
        return 'connection';
    }
    if (step === 'connection' && action === 'back') {
        return 'library';
    }
    return step;
}

/** 自動表示だけが first-run marker の書き手。明示再表示は既存 marker を更新しない。 */
export function shouldRecordFirstRunMarker(mode: FirstRunSetupOpenMode): boolean {
    return mode === 'automatic';
}
