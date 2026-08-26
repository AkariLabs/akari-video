import type { TransitionPreviewKind } from './transition-vocabulary';

export interface PreviewTransitionVisual {
    progress: number;
    engine: 'none' | 'directional-blur' | 'pixelize' | 'noise-dissolve';
    blurStdDeviationRatio: number;
    pixelBlockRatio: number;
    dissolveVisibleRatio: number;
    outgoingOpacity: number;
    incomingOpacity: number;
    incomingClipPath: string;
    outgoingTransform: string;
    incomingTransform: string;
    outgoingMask: string;
    incomingMask: string;
    outgoingFilter: string;
    incomingFilter: string;
    plateOpacity: number;
    plateColor: string;
    zSwap: boolean;
    fallbackLabel: string;
}

/** Shell の「位置と動きを掴む」プレビュー用。ffmpeg xfade と画素一致は狙わない。 */
export function computeTransitionVisual(
    previewKind: TransitionPreviewKind | string,
    rawProgress: number,
    fallbackName = ''
): PreviewTransitionVisual {
    const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));
    const progress = clamp01(Number.isFinite(rawProgress) ? rawProgress : 0);
    const mid = 1 - Math.abs(2 * progress - 1);
    const percent = (value: number): string => `${value * 100}%`;
    const translateX = (value: number): string => `translateX(${percent(value)})`;
    const translateY = (value: number): string => `translateY(${percent(value)})`;
    const base: PreviewTransitionVisual = {
        progress,
        engine: 'none',
        blurStdDeviationRatio: 0,
        pixelBlockRatio: 0,
        dissolveVisibleRatio: 0,
        outgoingOpacity: 1,
        incomingOpacity: 1,
        incomingClipPath: 'none',
        outgoingTransform: '',
        incomingTransform: '',
        outgoingMask: 'none',
        incomingMask: 'none',
        outgoingFilter: 'none',
        incomingFilter: 'none',
        plateOpacity: 0,
        plateColor: 'transparent',
        zSwap: false,
        fallbackLabel: ''
    };
    const cross = (): PreviewTransitionVisual => ({
        ...base,
        outgoingOpacity: 1 - progress,
        incomingOpacity: progress
    });

    if (previewKind === 'blur') {
        return { ...cross(), engine: 'directional-blur', blurStdDeviationRatio: mid * 0.075 };
    }
    if (previewKind === 'pixelize') {
        return { ...cross(), engine: 'pixelize', pixelBlockRatio: mid / 22 };
    }
    if (previewKind === 'dissolve') {
        return { ...base, engine: 'noise-dissolve', dissolveVisibleRatio: progress };
    }
    if (previewKind === 'fade') return cross();
    if (previewKind === 'fade-black' || previewKind === 'fade-white') {
        return {
            ...cross(),
            plateOpacity: clamp01(Math.min(progress / 0.18, (1 - progress) / 0.7)),
            plateColor: previewKind === 'fade-white' ? '#fff' : '#000'
        };
    }
    if (previewKind === 'fade-grays') {
        const filter = `grayscale(${mid})`;
        return { ...cross(), outgoingFilter: filter, incomingFilter: filter };
    }
    const hidden = 1 - progress;
    if (previewKind === 'wipe-left') return { ...base, incomingClipPath: `inset(0 0 0 ${percent(hidden)})` };
    if (previewKind === 'wipe-right') return { ...base, incomingClipPath: `inset(0 ${percent(hidden)} 0 0)` };
    if (previewKind === 'wipe-up') return { ...base, incomingClipPath: `inset(${percent(hidden)} 0 0 0)` };
    if (previewKind === 'wipe-down') return { ...base, incomingClipPath: `inset(0 0 ${percent(hidden)} 0)` };

    if (previewKind === 'slide-left') {
        return { ...base, outgoingTransform: translateX(-progress), incomingTransform: translateX(hidden) };
    }
    if (previewKind === 'slide-right') {
        return { ...base, outgoingTransform: translateX(progress), incomingTransform: translateX(-hidden) };
    }
    if (previewKind === 'slide-up') {
        return { ...base, outgoingTransform: translateY(-progress), incomingTransform: translateY(hidden) };
    }
    if (previewKind === 'slide-down') {
        return { ...base, outgoingTransform: translateY(progress), incomingTransform: translateY(-hidden) };
    }
    if (previewKind === 'cover-left') return { ...base, incomingTransform: translateX(hidden) };
    if (previewKind === 'cover-right') return { ...base, incomingTransform: translateX(-hidden) };
    if (previewKind === 'cover-up') return { ...base, incomingTransform: translateY(hidden) };
    if (previewKind === 'cover-down') return { ...base, incomingTransform: translateY(-hidden) };

    if (previewKind === 'reveal-left') {
        return { ...base, outgoingTransform: translateX(-progress), zSwap: true };
    }
    if (previewKind === 'reveal-right') {
        return { ...base, outgoingTransform: translateX(progress), zSwap: true };
    }
    if (previewKind === 'reveal-up') {
        return { ...base, outgoingTransform: translateY(-progress), zSwap: true };
    }
    if (previewKind === 'reveal-down') {
        return { ...base, outgoingTransform: translateY(progress), zSwap: true };
    }

    if (previewKind === 'circle-open') {
        const c = progress * 170 - 35;
        return {
            ...base,
            incomingMask: `radial-gradient(circle farthest-corner, #000 ${c - 35}%, transparent ${c + 35}%)`
        };
    }
    if (previewKind === 'circle-close') {
        const c = (1 - progress) * 170 - 35;
        return {
            ...base,
            outgoingMask: `radial-gradient(circle farthest-corner, #000 ${c - 35}%, transparent ${c + 35}%)`,
            zSwap: true
        };
    }
    if (previewKind === 'radial') {
        const c = progress * 424 - 32;
        return {
            ...base,
            incomingMask: `conic-gradient(from 0deg, #000 ${c - 16}deg, transparent ${c + 16}deg)`
        };
    }
    if (previewKind === 'zoom-in') {
        return {
            ...base,
            outgoingOpacity: progress < 0.6 ? 1 : 1 - (progress - 0.6) / 0.4,
            outgoingTransform: `scale(${1 + 1.5 * progress})`,
            outgoingFilter: `blur(${6 * progress}px)`,
            zSwap: true
        };
    }
    if (previewKind === 'squeeze-h') {
        return { ...base, outgoingTransform: `scaleY(${1 - progress})`, zSwap: true };
    }
    if (previewKind === 'squeeze-v') {
        return { ...base, outgoingTransform: `scaleX(${1 - progress})`, zSwap: true };
    }

    return {
        ...cross(),
        fallbackLabel: `${fallbackName || previewKind} — プレビュー近似なし`
    };
}
