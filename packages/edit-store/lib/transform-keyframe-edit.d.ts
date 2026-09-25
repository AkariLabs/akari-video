import type { ItemV2, TransformV2 } from './edit-v2';
export type TransformField = 'x' | 'y' | 'scale' | 'scaleX' | 'scaleY' | 'rotate';
/** Effective local pose, in pixels, unitless scale factors, and degrees. */
export declare function evaluatedItemTransform(item: Pick<ItemV2, 'source' | 'transform' | 'keyframes' | 'duration'>, frame: number): Required<TransformV2>;
export type ItemKeyframeGroup = 'position' | 'size' | 'rotation' | 'opacity';
export declare function hasItemKeyframeGroup(item: Pick<ItemV2, 'keyframes'>, group: ItemKeyframeGroup): boolean;
export declare function hasTransformKeyframe(item: Pick<ItemV2, 'keyframes'>, field: TransformField): boolean;
/** The same declared-point/hold/interpolation rule as the transform evaluator. */
export declare function evaluatedItemOpacity(item: Pick<ItemV2, 'opacity' | 'keyframes' | 'duration'>, frame: number): number;
/** Backfill old sparse points only when this group is written. Values are read before mutation. */
export declare function normalizeItemKeyframeGroup(item: ItemV2, group: ItemKeyframeGroup): ItemV2;
/** Add one visible-pose point. A lone group point also becomes its static value. */
export declare function activateItemKeyframeGroup(item: ItemV2, frame: number, group: ItemKeyframeGroup): ItemV2;
/** Item-wide diamond: all four groups share one playhead point and one item result. */
export declare function activateItemKeyframe(item: ItemV2, frame: number): ItemV2;
export declare function activateItemTransformKeyframe(item: ItemV2, frame: number, field: TransformField): ItemV2;
/** A gesture returns one updated item; every animated group auto-keys at the playhead. */
export declare function writeItemTransformAt(item: ItemV2, frame: number, input: TransformV2): ItemV2;
export declare function writeItemOpacityAt(item: ItemV2, frame: number, opacity: number): ItemV2;
/** Removing the last group point freezes the pose visible immediately before deletion. */
export declare function removeItemKeyframeGroup(item: ItemV2, frame: number, group: ItemKeyframeGroup): ItemV2;
/** Timeline point deletion is deliberately whole-point, independent of the selected row. */
export declare function removeItemKeyframePoint(item: ItemV2, frame: number): ItemV2;
export declare function moveItemKeyframeGroup(item: ItemV2, fromFrame: number, toFrame: number, group: ItemKeyframeGroup): ItemV2;
