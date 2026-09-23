import type { ItemV2, TransformV2 } from './edit-v2';
export type TransformField = 'x' | 'y' | 'scale' | 'scaleX' | 'scaleY' | 'rotate';
/** Effective local pose, in pixels, unitless scale factors, and degrees. */
export declare function evaluatedItemTransform(item: Pick<ItemV2, 'source' | 'transform' | 'keyframes' | 'duration'>, frame: number): Required<TransformV2>;
export declare function hasTransformKeyframe(item: Pick<ItemV2, 'keyframes'>, field: TransformField): boolean;
/** Toggle-on: seed the currently visible pose; media points are complete because the cut evaluator replaces a whole transform. */
export declare function activateItemTransformKeyframe(item: ItemV2, frame: number, field: TransformField): ItemV2;
/** One gesture produces one updated item; only animated coordinates receive a point at the playhead. */
export declare function writeItemTransformAt(item: ItemV2, frame: number, input: TransformV2): ItemV2;
