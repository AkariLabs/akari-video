export type PreviewTransitionType =
    | 'dissolve' | 'fade-black' | 'fade-white' | 'reveal-down' | 'reveal-up';

export interface PreviewTransitionVisual {
    progress: number;
    outgoingOpacity: number;
    incomingOpacity: number;
    incomingClipPath: string;
    plateOpacity: number;
    plateColor: string;
}

/** Shell の「位置と動きを掴む」プレビュー用。ffmpeg xfade と画素一致は狙わない。 */
export function computeTransitionVisual(
    type: PreviewTransitionType,
    rawProgress: number
): PreviewTransitionVisual {
    const progress = Math.max(0, Math.min(1, Number.isFinite(rawProgress) ? rawProgress : 0));
    const base = {
        progress,
        outgoingOpacity: 1,
        incomingOpacity: 0,
        incomingClipPath: 'none',
        plateOpacity: 0,
        plateColor: 'transparent'
    };
    if (type === 'dissolve') {
        return { ...base, outgoingOpacity: 1 - progress, incomingOpacity: progress };
    }
    if (type === 'fade-black' || type === 'fade-white') {
        return {
            ...base,
            outgoingOpacity: 1 - progress,
            incomingOpacity: progress,
            plateOpacity: 1 - Math.abs(progress * 2 - 1),
            plateColor: type === 'fade-white' ? '#fff' : '#000'
        };
    }
    const hiddenPercent = (1 - progress) * 100;
    return {
        ...base,
        incomingOpacity: 1,
        incomingClipPath: type === 'reveal-down'
            ? `inset(0 0 ${hiddenPercent}% 0)`
            : `inset(${hiddenPercent}% 0 0 0)`
    };
}
