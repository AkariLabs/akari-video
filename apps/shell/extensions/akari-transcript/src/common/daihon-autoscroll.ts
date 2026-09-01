export interface AutoScrollState {
    playing: boolean;
    currentRowVisible: boolean;
    userScrolledRecentlyMs: number;
}

export function shouldAutoScroll(state: AutoScrollState): boolean {
    return state.playing
        && !state.currentRowVisible
        && state.userScrolledRecentlyMs >= 2000;
}
