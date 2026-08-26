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
export declare function computeTransitionVisual(previewKind: TransitionPreviewKind | string, rawProgress: number, fallbackName?: string): PreviewTransitionVisual;
