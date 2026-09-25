import type { InternalEdit, InternalItem, InternalTrack } from './internal-model';
export interface FlattenedVisualItem {
    item: InternalItem;
    track: InternalTrack;
    order: number;
    descendant: boolean;
}
/** 描画だけに使う投影。宣言木を変更せず、group の子を絶対時刻の葉へ写す。 */
export declare function flattenGroupDescendants(internal: InternalEdit): FlattenedVisualItem[];
