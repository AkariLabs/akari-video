import type { ItemV2 } from './edit-v2';
import { writeItemTransformAt } from './transform-keyframe-edit';

/** A direct move writes only the requested position axes at the item-local frame. */
export function writeItemPositionAt(item: ItemV2, frame: number,
    position: { x?: number; y?: number }): ItemV2 {
    if (!Number.isInteger(frame) || frame < 0 || frame > item.duration
        || Object.keys(position).length === 0
        || Object.keys(position).some(axis => (axis !== 'x' && axis !== 'y')
            || !Number.isFinite(position[axis as 'x' | 'y']))) {
        throw new Error('位置または時刻が正しくありません');
    }
    return writeItemTransformAt(item, frame, position);
}
