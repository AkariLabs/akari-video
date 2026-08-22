export interface DeferredTelopPlaybackInput {
    active: boolean;
    bakePending: boolean;
    mediaReady: boolean;
    seekPending: boolean;
    mediaSeeking: boolean;
    currentTime: number;
    targetTime: number;
    playing: boolean;
}

export type DeferredTelopPlaybackAction =
    | { phase: 'inactive' }
    | { phase: 'baking' }
    | { phase: 'loading' }
    | { phase: 'syncing' }
    | { phase: 'seek'; targetTime: number }
    | { phase: 'ready'; playbackRate: number };

/**
 * Late deferred media must not chase a moving master clock with a new seek every frame.
 * Seek once when drift is large, keep the previously presented frame visible while that
 * seek is outstanding, then absorb the small seek latency with a bounded rate correction.
 * Only `baking` is a user-visible preparation state; loading/syncing happen after bake.
 */
export function resolveDeferredTelopPlayback(
    input: DeferredTelopPlaybackInput
): DeferredTelopPlaybackAction {
    if (!input.active) return { phase: 'inactive' };
    if (input.bakePending) return { phase: 'baking' };
    if (!input.mediaReady) return { phase: 'loading' };
    if (input.seekPending || input.mediaSeeking) return { phase: 'syncing' };
    const currentTime = Number.isFinite(input.currentTime) ? Math.max(0, input.currentTime) : 0;
    const targetTime = Number.isFinite(input.targetTime) ? Math.max(0, input.targetTime) : 0;
    const drift = targetTime - currentTime;
    const hardSeekTolerance = input.playing ? 0.25 : 0.001;
    if (Math.abs(drift) > hardSeekTolerance) {
        return { phase: 'seek', targetTime };
    }
    const playbackRate = input.playing
        ? Math.max(0.9, Math.min(1.1, 1 + drift * 0.5))
        : 1;
    return { phase: 'ready', playbackRate };
}
