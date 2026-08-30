import type { EditV2, ItemV2, KeyframeV2, TrackV2, TransformV2 } from './edit-v2';
export type JsonRecord = Record<string, unknown>;
export type ProjectItemV2 = Omit<ItemV2, 'items' | 'keyframes'> & {
    items?: ProjectItemV2[];
    keyframes?: KeyframeV2[] | {
        path: string;
        count: number;
    };
};
export type ProjectTrackV2 = Omit<TrackV2, 'items'> & {
    items?: ProjectItemV2[];
};
export type MutableItem = ProjectItemV2 & JsonRecord;
export type MutableTrack = ProjectTrackV2 & JsonRecord;
export interface MoveTarget {
    track?: string;
    parent?: string;
    index?: number;
}
export interface GroupResult {
    group: ProjectItemV2;
    changedOrderIds: string[];
}
export interface ProjectedItemTiming {
    at: number;
    duration: number;
}
export type KeyframeProperty = 'transform.x' | 'transform.y' | 'transform.scale' | 'transform.rotate' | 'opacity' | 'crop' | 'perspective';
export type SegmentEasing = string;
export interface ConvertCaptionToTelopOptions {
    preset?: string;
    text: string;
    at?: number;
    duration?: number;
}
export declare const DEFAULT_CAPTION_TELOP_PRESET = "ref3_particle_min";
export type EditableEditV2 = Omit<EditV2, 'tracks'> & {
    tracks: ProjectTrackV2[];
    find(id: string): ProjectItemV2 | undefined;
    walk(fn: (item: ProjectItemV2, parent: ProjectItemV2 | undefined, track: ProjectTrackV2) => void): void;
    parentOf(id: string): ProjectItemV2 | undefined;
    update(id: string, patch: Partial<ProjectItemV2> & JsonRecord): ProjectItemV2;
    move(id: string, target: MoveTarget): ProjectItemV2;
    insert(target: string, item: ProjectItemV2, index?: number): ProjectItemV2;
    remove(id: string): ProjectItemV2;
    detach(id: string, target: {
        track: 'above' | string;
    }): ProjectItemV2;
    group(ids: string[], options?: {
        name?: string;
    }): GroupResult;
    ungroup(id: string): ProjectItemV2[];
};
export interface ItemLocation {
    item: MutableItem;
    items: MutableItem[];
    index: number;
    parent?: MutableItem;
    ancestors: MutableItem[];
    track: MutableTrack;
    trackIndex: number;
}
export declare function attachEditHelpers(edit: EditableEditV2): void;
export declare function updateItem(edit: EditableEditV2, id: string, patch: JsonRecord): ProjectItemV2;
/** inline 点列へ値を打つ。最初の点では反対側の端にも同じ値を置き minItems:2 を守る。 */
export declare function setKeyframe(edit: EditableEditV2, id: string, property: KeyframeProperty, t: number, value: unknown): ProjectItemV2;
/** 指定プロパティの点だけを消し、空点を除去する。2 点未満なら点列自体を外す。 */
export declare function removeKeyframe(edit: EditableEditV2, id: string, property: KeyframeProperty, t: number): ProjectItemV2;
/** 1 プロパティの点を別時刻へ移す。同時刻の既存点があれば値をマージする。 */
export declare function moveKeyframe(edit: EditableEditV2, id: string, property: KeyframeProperty, fromT: number, toT: number): ProjectItemV2;
/** easing は「その点へ入る区間」に置く。プロパティ別指定は object 形へ正規化する。 */
export declare function setSegmentEasing(edit: EditableEditV2, id: string, property: KeyframeProperty, toT: number, easing: SegmentEasing): ProjectItemV2;
/** motion 袋を読んだ UI が参照形を inline へ戻すための純関数。 */
export declare function hydrateKeyframes(edit: EditableEditV2, id: string, points: readonly KeyframeV2[]): ProjectItemV2;
export declare function moveItem(edit: EditableEditV2, id: string, target: MoveTarget): ProjectItemV2;
export declare function insertItem(edit: EditableEditV2, target: string, item: MutableItem, index?: number): ProjectItemV2;
export declare function removeItem(edit: EditableEditV2, id: string): ProjectItemV2;
export declare function detachItem(edit: EditableEditV2, id: string, target: {
    track: 'above' | string;
}, projected?: ProjectedItemTiming): ProjectItemV2;
/** 袋 projection の写しを、木操作の直前にだけ明示子へ昇格する。 */
export declare function materializeProjectedPart(edit: EditableEditV2, id: string, projected?: ProjectedItemTiming): ItemLocation;
/** captions.json は不変のまま、参照行を独立した未ベイク telop へ置き換える。 */
export declare function convertCaptionToTelop(edit: EditableEditV2, id: string, options: ConvertCaptionToTelopOptions): ProjectItemV2;
/** tracks[].items[] / internal children のどちらからでも captions 袋の exclude を集める。 */
export declare function collectExcludedCaptionIds(edit: unknown): Set<string>;
/** captions.json の array / object root を保ったまま除外行だけを落とす。 */
export declare function filterCaptionRootByExcludedIds<T>(root: T, excluded: ReadonlySet<string>): T;
export declare function groupItems(edit: EditableEditV2, ids: string[], options?: {
    name?: string;
}): GroupResult;
export declare function ungroupItem(edit: EditableEditV2, id: string): ProjectItemV2[];
export declare function normalizeTracks(edit: EditableEditV2): void;
export declare function allLocations(edit: EditableEditV2): ItemLocation[];
export declare function locate(edit: EditableEditV2, id: string): ItemLocation | undefined;
export declare function createTrackAbove(edit: EditableEditV2, track: MutableTrack | string): MutableTrack;
/** 既存の段外 D&D 用。段の生成自体を shell へ漏らさない。 */
export declare function createTrackAt(edit: EditableEditV2, lane: string, index: number): MutableTrack;
export declare function nextTrackId(edit: EditableEditV2, lane: string): string;
export declare function nextGroupId(edit: EditableEditV2): string;
export declare function overlapsAny(item: MutableItem, items: MutableItem[]): boolean;
export declare function changedZOrderIds(edit: EditableEditV2, members: ItemLocation[], start: number, end: number): string[];
export declare function absoluteAt(location: ItemLocation): number;
export declare function worldTransformOfAncestors(ancestors: MutableItem[]): TransformV2 | undefined;
export declare function opacityOfAncestors(ancestors: MutableItem[]): number;
export declare function composeTransforms(parent?: TransformV2, child?: TransformV2): TransformV2 | undefined;
export declare function relativeTransform(parent: TransformV2 | undefined, world: TransformV2 | undefined): TransformV2 | undefined;
export declare function ensureChildren(item: MutableItem, create?: boolean): MutableItem[];
export declare function clone<T>(value: T): T;
