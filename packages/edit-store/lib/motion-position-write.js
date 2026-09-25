"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.writeItemPositionAt = writeItemPositionAt;
const transform_keyframe_edit_1 = require("./transform-keyframe-edit");
/** A direct move writes only the requested position axes at the item-local frame. */
function writeItemPositionAt(item, frame, position) {
    if (!Number.isInteger(frame) || frame < 0 || frame > item.duration
        || Object.keys(position).length === 0
        || Object.keys(position).some(axis => (axis !== 'x' && axis !== 'y')
            || !Number.isFinite(position[axis]))) {
        throw new Error('位置または時刻が正しくありません');
    }
    return (0, transform_keyframe_edit_1.writeItemTransformAt)(item, frame, position);
}
