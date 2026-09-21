export interface MaterialTrialWindow {
    token: string;
    start: number;
    end: number;
    started: boolean;
    seenStart: boolean;
    stopped: boolean;
}

/** 復元位置の古い tick を、今回のお試しの終端到達と取り違えない。 */
export function advanceMaterialTrialWindow(
    state: MaterialTrialWindow | undefined,
    activeToken: string | undefined,
    tick: { trialToken?: string; time: number; playing: boolean }
): { state: MaterialTrialWindow | undefined; pause: boolean } {
    if (!state || state.stopped || state.token !== activeToken || tick.trialToken !== state.token
        || !Number.isFinite(tick.time)) return { state, pause: false };
    const started = state.started || tick.playing;
    const seenStart = state.seenStart || (tick.time >= state.start - 0.25 && tick.time < state.end);
    const pause = started && seenStart && tick.time >= state.end;
    return { state: { ...state, started, seenStart, stopped: pause }, pause };
}
