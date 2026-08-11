export interface FirstRunOnboardingState {
    hasOpenProject: boolean;
    hasCreatorRootPointer: boolean;
    hasProjectHistory: boolean;
    markerSeen: boolean;
}

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
