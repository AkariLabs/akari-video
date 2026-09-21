/** Still images and frame-tool PNG cards have no source-time limit. */
export const MINIMUM_STILL_CUT_DURATION = 0.5;

/** Round on the frame grid without crossing a neighbour or the minimum duration. */
export function clampStillCutLength(seconds: number, fps: number, availableSeconds = Infinity): number | undefined {
    if (!Number.isFinite(seconds) || !Number.isFinite(fps) || fps <= 0
        || Number.isNaN(availableSeconds)) return undefined;
    const minimum = Math.ceil(MINIMUM_STILL_CUT_DURATION * fps);
    const maximum = Math.floor(availableSeconds * fps + 1e-7);
    if (maximum < minimum) return undefined;
    return Math.min(maximum, Math.max(minimum, Math.round(seconds * fps))) / fps;
}

/** Both edges operate in output time; a left trim never creates a source offset. */
export function planStillCutTrim(start: number, end: number, edge: 'left' | 'right', time: number, fps: number): {
    at: number; duration: number;
} | undefined {
    const fixed = Math.round((edge === 'left' ? end : start) * fps) / fps;
    const duration = clampStillCutLength(edge === 'left' ? fixed - time : time - fixed,
        fps, edge === 'left' ? fixed : Infinity);
    if (duration === undefined) return undefined;
    return { at: edge === 'left' ? fixed - duration : fixed, duration };
}
