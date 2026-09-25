import type { KeyframeV2 } from './edit-v2';
/** Replace X/Y only inside the drawn span, retaining every unrelated keyframe channel. */
export declare function replaceXYKeyframes(existing: readonly KeyframeV2[] | undefined, drawn: readonly {
    t: number;
    transform: {
        x: number;
        y: number;
    };
}[], duration: number): KeyframeV2[];
