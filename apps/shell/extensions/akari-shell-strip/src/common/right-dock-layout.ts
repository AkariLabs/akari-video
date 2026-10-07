export type DockState = 'closed' | 'open' | 'expanded';

export function nextDockStateOnDoubleClick(state: DockState): DockState {
    return state === 'expanded' ? 'open' : 'expanded';
}

export interface DockHeightInput {
    panelHeight: number;
    state: DockState;
    userHeight?: number;
}

export function computeDockHeight({ panelHeight, state, userHeight }: DockHeightInput):
    { height: number; state: DockState; reason?: 'too-small' } {
    const available = Math.max(0, Number.isFinite(panelHeight) ? panelHeight : 0);
    const maximum = Math.floor(available - 160);
    if (maximum < 56) {
        return { height: 56, state: 'closed', reason: 'too-small' };
    }
    if (state === 'closed') {
        return { height: 56, state };
    }
    const desired = state === 'expanded'
        ? Math.round(available * 2 / 3)
        : Number.isFinite(userHeight) ? Math.round(userHeight!) : Math.max(180, Math.round(available / 3));
    const minimum = state === 'open' && userHeight !== undefined ? 180 : 56;
    return { height: Math.max(56, Math.min(maximum, Math.max(minimum, desired))), state };
}
