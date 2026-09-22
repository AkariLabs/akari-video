import type { TransformV2 } from './edit-v2';

/** Axis overrides take precedence over the legacy uniform scale. */
export function effectiveScale(transform?: TransformV2): { x: number; y: number } {
    return { x: transform?.scaleX ?? transform?.scale ?? 1, y: transform?.scaleY ?? transform?.scale ?? 1 };
}

/** Only explicit axis declarations are normalized; legacy documents stay byte-compatible. */
export function normalizeTransform(transform: TransformV2): TransformV2 {
    const result = { ...transform };
    if (result.scaleX === undefined && result.scaleY === undefined) return result;
    const axes = effectiveScale(result);
    if (axes.x === axes.y) {
        result.scale = axes.x;
        delete result.scaleX;
        delete result.scaleY;
    }
    return result;
}
