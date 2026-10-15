"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.cutMotionReferencePaths = cutMotionReferencePaths;
exports.hydrateCutMotionReferences = hydrateCutMotionReferences;
exports.restoreUncutMotionReferences = restoreUncutMotionReferences;
const MOTION_FILE_VERSION = 0;
function record(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function reference(value) {
    return record(value) && typeof value.path === 'string' && /^motion\/[^/\\]+\.json$/u.test(value.path)
        && Number.isInteger(value.count) && value.count >= 2;
}
function visit(edit, callback) {
    const items = (value) => {
        if (!Array.isArray(value))
            return;
        for (const item of value) {
            if (!record(item))
                continue;
            callback(item);
            items(item.items);
        }
    };
    if (Array.isArray(edit.tracks))
        for (const track of edit.tracks) {
            if (record(track))
                items(track.items);
        }
}
function cutMotionReferencePaths(edit) {
    const paths = new Set();
    visit(edit, item => {
        if (reference(item.keyframes))
            paths.add(item.keyframes.path);
    });
    return [...paths];
}
function pointsFor(item, bags) {
    if (!reference(item.keyframes) || typeof item.id !== 'string' || !Number.isInteger(item.duration))
        return undefined;
    const bag = bags.get(item.keyframes.path);
    const group = item.keyframes.path.slice('motion/'.length, -'.json'.length);
    if (!record(bag) || bag.version !== MOTION_FILE_VERSION || bag.group !== group || !record(bag.items))
        return undefined;
    const points = bag.items[item.id];
    if (!Array.isArray(points) || points.length !== item.keyframes.count)
        return undefined;
    let previous = -1;
    for (const point of points) {
        if (!record(point) || !Number.isInteger(point.t) || point.t <= previous
            || point.t < 0 || point.t > item.duration)
            return undefined;
        previous = point.t;
    }
    return structuredClone(points);
}
/** Hydrate valid bags for a synchronous cut. Unreadable unrelated references stay untouched. */
function hydrateCutMotionReferences(edit, bags) {
    const result = structuredClone(edit);
    visit(result, item => {
        const points = pointsFor(item, bags);
        if (points)
            item.keyframes = points;
    });
    return result;
}
/** A ripple may move an item without cutting it. Keep that item's original reference spelling. */
function restoreUncutMotionReferences(before, after, bags) {
    const originals = new Map();
    visit(before, item => {
        if (typeof item.id === 'string' && reference(item.keyframes))
            originals.set(item.id, item);
    });
    const result = structuredClone(after);
    visit(result, item => {
        if (typeof item.id !== 'string' || !Array.isArray(item.keyframes))
            return;
        const original = originals.get(item.id);
        if (!original || item.duration !== original.duration
            || JSON.stringify(item.source) !== JSON.stringify(original.source))
            return;
        const points = pointsFor(original, bags);
        if (points && JSON.stringify(item.keyframes) === JSON.stringify(points)) {
            item.keyframes = structuredClone(original.keyframes);
        }
    });
    return result;
}
