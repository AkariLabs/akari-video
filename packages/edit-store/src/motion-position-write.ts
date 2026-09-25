import type { ItemV2 } from './edit-v2';

/** A direct move writes only the requested position axes at the item-local frame. */
export function writeItemPositionAt(item: ItemV2, frame: number,
    position: { x?: number; y?: number }): ItemV2 {
    if (!Number.isInteger(frame) || frame < 0 || frame > item.duration
        || Object.keys(position).length === 0
        || Object.keys(position).some(axis => (axis !== 'x' && axis !== 'y')
            || !Number.isFinite(position[axis as 'x' | 'y']))) {
        throw new Error('位置または時刻が正しくありません');
    }
    const copy = structuredClone(item);
    if (Array.isArray(copy.keyframes) && copy.keyframes.length >= 2) {
        let point = copy.keyframes.find(entry => entry.t === frame);
        if (!point) {
            point = { t: frame };
            copy.keyframes.push(point);
            copy.keyframes.sort((left, right) => left.t - right.t);
        }
        point.transform = { ...point.transform, ...position };
    } else {
        copy.transform = { ...copy.transform, ...position };
    }
    return copy;
}
