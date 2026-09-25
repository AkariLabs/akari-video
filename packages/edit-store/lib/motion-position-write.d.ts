import type { ItemV2 } from './edit-v2';
/** A direct move writes only the requested position axes at the item-local frame. */
export declare function writeItemPositionAt(item: ItemV2, frame: number, position: {
    x?: number;
    y?: number;
}): ItemV2;
