// docs/contract-2026-07-22-render-basics.md #7 (cuts[].freeze) preview reproduction. The render
// side stretches the cut's own duration by freeze.duration_sec (a timeline-shape change), which
// the preview does not reproduce (contract-2026-08-02-preview-parity.md's disclosed
// approximation: static hold only, no timeline/duration-display extension -- see the caller in
// akari-preview-open-handler.ts for how the hold is realized as a real-time video+audio pause).
// This module only answers the pure question "has playback reached the freeze point yet".
//
// Serialized into the preview webview via Function.prototype.toString() -- see
// preview-composite-layout.ts's fitPreviewCompositeRect for the established pattern. Keep this
// self-contained: no closures over module state, no calls to sibling functions in this file.

export interface CutFreeze {
    at_sec: number;
    duration_sec: number;
}

export interface CutFreezeHoldCheck {
    /** True once played time has reached/passed at_sec. Pure/stateless: the caller owns
     * "already triggered this pass" bookkeeping (reset whenever the active segment changes) so
     * a single crossing engages the hold exactly once instead of every frame it stays true. */
    shouldHold: boolean;
    holdSeconds: number;
}

/**
 * Determines whether playback has reached a cut's freeze point. `cutLocalPlayedSeconds` must be
 * the same "played" (post-speed) clock as framing.keyframes[].t
 * (contract-2026-07-22-render-basics.md #6/#7) -- for a cut with no freeze, or an invalid
 * declaration (missing/non-finite at_sec, non-positive duration_sec), this always reports
 * shouldHold: false.
 */
export function checkCutFreezeCrossing(
    freeze: CutFreeze | null | undefined,
    cutLocalPlayedSeconds: number
): CutFreezeHoldCheck {
    const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
    const at = freeze && typeof freeze === 'object' && isFiniteNumber(freeze.at_sec) && freeze.at_sec >= 0
        ? freeze.at_sec : null;
    const holdSeconds = freeze && typeof freeze === 'object' && isFiniteNumber(freeze.duration_sec) && freeze.duration_sec > 0
        ? freeze.duration_sec : 0;
    if (at === null || holdSeconds <= 0) return { shouldHold: false, holdSeconds: 0 };
    const played = isFiniteNumber(cutLocalPlayedSeconds) ? cutLocalPlayedSeconds : 0;
    return { shouldHold: played >= at, holdSeconds };
}
