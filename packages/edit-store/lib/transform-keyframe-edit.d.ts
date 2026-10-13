import type { ItemV2, TransformV2 } from './edit-v2';
export type TransformField = 'x' | 'y' | 'scale' | 'scaleX' | 'scaleY' | 'rotate';
/**
 * 3D モックアップの向き（three ランタイムの標準ツマミ。度）。3 本で 1 つのキーフレームグループ
 * `rotation3d` になる（内部契約 2026-10-11-3d-place §2.2）。静的値は source.vars の文字列、
 * キーは keyframes[].vars の数値、easing のキーは "vars.<名前>"。
 */
export declare const ROTATION_3D_VARS: readonly ["--akari-3d-rot-x", "--akari-3d-rot-y", "--akari-3d-rot-z"];
export type Rotation3dVar = typeof ROTATION_3D_VARS[number];
export type Rotation3dValues = Partial<Record<Rotation3dVar, number>>;
/** three 断片の html item か（scene3d 素材のパス、または 3D 回転の値・キーを持つ）。 */
export declare function isScene3dItem(item: Pick<ItemV2, 'source' | 'keyframes'>): boolean;
/** Effective local pose, in pixels, unitless scale factors, and degrees. */
export declare function evaluatedItemTransform(item: Pick<ItemV2, 'source' | 'transform' | 'keyframes' | 'duration'>, frame: number): Required<TransformV2>;
export type ItemKeyframeGroup = 'position' | 'size' | 'rotation' | 'opacity' | 'rotation3d';
export declare function hasItemKeyframeGroup(item: Pick<ItemV2, 'keyframes'>, group: ItemKeyframeGroup): boolean;
export declare function hasTransformKeyframe(item: Pick<ItemV2, 'keyframes'>, field: TransformField): boolean;
/** The same declared-point/hold/interpolation rule as the transform evaluator. */
export declare function evaluatedItemOpacity(item: Pick<ItemV2, 'opacity' | 'keyframes' | 'duration'>, frame: number): number;
/** 3D 回転 1 本の、その時刻に見えている値（度）。キーが無ければ source.vars、それも無ければ 0。 */
export declare function evaluatedItemVar(item: Pick<ItemV2, 'source' | 'keyframes' | 'duration'>, frame: number, name: Rotation3dVar): number;
/** Backfill old sparse points only when this group is written. Values are read before mutation. */
export declare function normalizeItemKeyframeGroup(item: ItemV2, group: ItemKeyframeGroup): ItemV2;
/** Add one visible-pose point. A lone group point also becomes its static value. */
export declare function activateItemKeyframeGroup(item: ItemV2, frame: number, group: ItemKeyframeGroup): ItemV2;
/** Item-wide diamond: all four groups share one playhead point and one item result.
 * A 3D item adds its rotation3d group to the same point. */
export declare function activateItemKeyframe(item: ItemV2, frame: number): ItemV2;
export declare function activateItemTransformKeyframe(item: ItemV2, frame: number, field: TransformField): ItemV2;
/** A gesture returns one updated item; every animated group auto-keys at the playhead. */
export declare function writeItemTransformAt(item: ItemV2, frame: number, input: TransformV2): ItemV2;
/** 3D 回転の書き込み（gizmo・インスペクタ共通）。グループにキーがあれば再生ヘッドに自動キー、無ければ静的値。 */
export declare function writeItemVarsAt(item: ItemV2, frame: number, values: Rotation3dValues): ItemV2;
export declare function writeItemOpacityAt(item: ItemV2, frame: number, opacity: number): ItemV2;
/** Removing the last group point freezes the pose visible immediately before deletion. */
export declare function removeItemKeyframeGroup(item: ItemV2, frame: number, group: ItemKeyframeGroup): ItemV2;
/** Timeline point deletion is deliberately whole-point, independent of the selected row. */
export declare function removeItemKeyframePoint(item: ItemV2, frame: number): ItemV2;
export declare function moveItemKeyframeGroup(item: ItemV2, fromFrame: number, toFrame: number, group: ItemKeyframeGroup): ItemV2;
