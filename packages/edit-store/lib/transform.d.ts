import type { TransformV2 } from './edit-v2';
/** Axis overrides take precedence over the legacy uniform scale. */
export declare function effectiveScale(transform?: TransformV2): {
    x: number;
    y: number;
};
/** Only explicit axis declarations are normalized; legacy documents stay byte-compatible. */
export declare function normalizeTransform(transform: TransformV2): TransformV2;
