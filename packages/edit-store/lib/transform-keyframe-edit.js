"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.evaluatedItemTransform = evaluatedItemTransform;
exports.hasItemKeyframeGroup = hasItemKeyframeGroup;
exports.hasTransformKeyframe = hasTransformKeyframe;
exports.evaluatedItemOpacity = evaluatedItemOpacity;
exports.normalizeItemKeyframeGroup = normalizeItemKeyframeGroup;
exports.activateItemKeyframeGroup = activateItemKeyframeGroup;
exports.activateItemKeyframe = activateItemKeyframe;
exports.activateItemTransformKeyframe = activateItemTransformKeyframe;
exports.writeItemTransformAt = writeItemTransformAt;
exports.writeItemOpacityAt = writeItemOpacityAt;
exports.removeItemKeyframeGroup = removeItemKeyframeGroup;
exports.removeItemKeyframePoint = removeItemKeyframePoint;
exports.moveItemKeyframeGroup = moveItemKeyframeGroup;
const FIELDS = ['x', 'y', 'scale', 'scaleX', 'scaleY', 'rotate'];
const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const isMedia = (item) => item.source.kind === 'media';
const pointsOf = (item) => Array.isArray(item.keyframes) ? item.keyframes.slice().sort((a, b) => a.t - b.t) : [];
const frameOf = (item, frame) => Math.min(item.duration, Math.max(0, Math.round(frame)));
function eased(point, field, u, media) {
    const raw = point.easing;
    const name = typeof raw === 'string' ? raw : raw?.[`transform.${field}`] ?? raw?.transform ?? 'linear';
    if (media)
        return name === 'ease-in-out'
            ? u < .5 ? 4 * u ** 3 : 1 - (-2 * u + 2) ** 3 / 2 : u;
    if (name === 'hold')
        return 0;
    if (name === 'ease-in-out' || name === 'in-out-cubic')
        return u < .5 ? 4 * u ** 3 : 1 - (-2 * u + 2) ** 3 / 2;
    if (name === 'in-quad')
        return u * u;
    if (name === 'out-quad')
        return 1 - (1 - u) ** 2;
    if (name === 'in-out-quad')
        return u < .5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2;
    if (name === 'in-cubic')
        return u ** 3;
    if (name === 'out-cubic')
        return 1 - (1 - u) ** 3;
    if (name === 'in-quart')
        return u ** 4;
    if (name === 'out-quart')
        return 1 - (1 - u) ** 4;
    if (name === 'in-out-quart')
        return u < .5 ? 8 * u ** 4 : 1 - (-2 * u + 2) ** 4 / 2;
    if (name === 'in-expo')
        return u === 0 ? 0 : 2 ** (10 * u - 10);
    if (name === 'out-expo')
        return u === 1 ? 1 : 1 - 2 ** (-10 * u);
    if (name === 'in-out-expo')
        return u === 0 || u === 1 ? u
            : u < .5 ? 2 ** (20 * u - 10) / 2 : (2 - 2 ** (-20 * u + 10)) / 2;
    if (name === 'in-back')
        return 2.70158 * u ** 3 - 1.70158 * u ** 2;
    if (name === 'out-back')
        return 1 + 2.70158 * (u - 1) ** 3 + 1.70158 * (u - 1) ** 2;
    if (name === 'in-out-back') {
        const c = 1.70158 * 1.525;
        return u < .5 ? ((2 * u) ** 2 * ((c + 1) * 2 * u - c)) / 2
            : (((2 * u - 2) ** 2 * ((c + 1) * (2 * u - 2) + c)) + 2) / 2;
    }
    if (name === 'out-bounce') {
        const n = 7.5625, d = 2.75;
        if (u < 1 / d)
            return n * u * u;
        if (u < 2 / d)
            return n * (u - 1.5 / d) ** 2 + .75;
        if (u < 2.5 / d)
            return n * (u - 2.25 / d) ** 2 + .9375;
        return n * (u - 2.625 / d) ** 2 + .984375;
    }
    if (name === 'out-elastic')
        return u === 0 || u === 1 ? u
            : 2 ** (-10 * u) * Math.sin((u * 10 - .75) * (2 * Math.PI / 3)) + 1;
    const match = typeof name === 'string' ? name.match(/^cubic-bezier\(([^,]+),([^,]+),([^,]+),([^,]+)\)$/u) : null;
    if (match) {
        const [x1, y1, x2, y2] = match.slice(1).map(Number);
        if ([x1, y1, x2, y2].every(Number.isFinite) && x1 >= 0 && x1 <= 1 && x2 >= 0 && x2 <= 1) {
            const curve = (p, a, b) => 3 * (1 - p) ** 2 * p * a + 3 * (1 - p) * p ** 2 * b + p ** 3;
            let low = 0, high = 1;
            for (let i = 0; i < 32; i++) {
                const mid = (low + high) / 2;
                if (curve(mid, x1, x2) < u)
                    low = mid;
                else
                    high = mid;
            }
            return curve((low + high) / 2, y1, y2);
        }
    }
    return u;
}
function valueAt(points, frame, field, fallback, media, statics) {
    const declared = points.flatMap(point => {
        const transform = point.transform;
        if (!transform)
            return [];
        let value = transform[field];
        if (!finite(value) && (field === 'scaleX' || field === 'scaleY')) {
            value = transform.scale ?? (media ? statics[field] ?? statics.scale ?? 1 : fallback);
        }
        return finite(value) ? [{ point, value }] : [];
    });
    if (!declared.length)
        return fallback;
    if (frame <= declared[0].point.t)
        return declared[0].value;
    const last = declared[declared.length - 1];
    if (frame >= last.point.t)
        return last.value;
    for (let i = 1; i < declared.length; i++) {
        const right = declared[i], left = declared[i - 1];
        if (frame > right.point.t)
            continue;
        const span = right.point.t - left.point.t;
        const u = span > 0 ? eased(right.point, field, (frame - left.point.t) / span, media) : 1;
        return left.value + (right.value - left.value) * u;
    }
    return last.value;
}
/** Effective local pose, in pixels, unitless scale factors, and degrees. */
function evaluatedItemTransform(item, frame) {
    const staticValue = item.transform ?? {};
    const base = {
        x: staticValue.x ?? 0, y: staticValue.y ?? 0, scale: staticValue.scale ?? 1,
        scaleX: staticValue.scaleX ?? staticValue.scale ?? 1,
        scaleY: staticValue.scaleY ?? staticValue.scale ?? 1, rotate: staticValue.rotate ?? 0
    };
    const points = pointsOf(item), media = isMedia(item);
    if (!points.some(point => point.transform))
        return base;
    const at = frameOf(item, frame);
    return Object.fromEntries(FIELDS.map(field => [field,
        valueAt(points, at, field, base[field], media, staticValue)]));
}
const GROUP_FIELDS = {
    position: ['x', 'y'], size: ['scale', 'scaleX', 'scaleY'], rotation: ['rotate']
};
const groupOf = (field) => field === 'x' || field === 'y' ? 'position'
    : field === 'rotate' ? 'rotation' : 'size';
const declares = (point, group) => group === 'opacity'
    ? finite(point.opacity) : GROUP_FIELDS[group].some(field => finite(point.transform?.[field]));
const groupPoints = (item, group) => pointsOf(item).filter(point => declares(point, group));
const hasPointValue = (point) => Object.entries(point)
    .some(([key, value]) => key !== 't' && key !== 'easing' && value !== undefined);
function legalPointArray(item, points) {
    const meaningful = points.filter(hasPointValue).sort((a, b) => a.t - b.t);
    if (!meaningful.length)
        return undefined;
    if (meaningful.length > 1)
        return meaningful;
    // The existing file schema requires two array entries. This empty entry has no animated
    // property; every evaluator and diamond list ignores it.
    const t = meaningful[0].t < item.duration ? meaningful[0].t + 1 : meaningful[0].t - 1;
    return [...meaningful, { t }].sort((a, b) => a.t - b.t);
}
function hasItemKeyframeGroup(item, group) {
    return groupPoints(item, group).length > 0;
}
function hasTransformKeyframe(item, field) {
    return hasItemKeyframeGroup(item, groupOf(field));
}
/** The same declared-point/hold/interpolation rule as the transform evaluator. */
function evaluatedItemOpacity(item, frame) {
    const points = groupPoints(item, 'opacity');
    const fallback = item.opacity ?? 1;
    if (!points.length)
        return fallback;
    const at = frameOf(item, frame);
    if (at <= points[0].t)
        return points[0].opacity;
    const last = points[points.length - 1];
    if (at >= last.t)
        return last.opacity;
    for (let index = 1; index < points.length; index++) {
        const right = points[index], left = points[index - 1];
        if (at > right.t)
            continue;
        const u = eased(right, 'opacity', (at - left.t) / (right.t - left.t || 1), false);
        return left.opacity + (right.opacity - left.opacity) * u;
    }
    return fallback;
}
function validPatch(patch) {
    for (const [field, value] of Object.entries(patch)) {
        if (!FIELDS.includes(field) || !finite(value)
            || ((field === 'scale' || field === 'scaleX' || field === 'scaleY') && value <= 0)) {
            throw new Error(`Invalid transform.${field}`);
        }
    }
}
function normalizedAxisPatch(current, patch) {
    if (patch.scale === undefined || patch.scaleX !== undefined || patch.scaleY !== undefined)
        return patch;
    const previous = Math.sqrt(current.scaleX * current.scaleY);
    const ratio = previous > 0 ? patch.scale / previous : 1;
    return { ...patch, scaleX: current.scaleX * ratio, scaleY: current.scaleY * ratio };
}
function valuesAt(item, frame, group) {
    if (group === 'opacity')
        return evaluatedItemOpacity(item, frame);
    const pose = evaluatedItemTransform(item, frame);
    if (group === 'position')
        return { x: pose.x, y: pose.y };
    if (group === 'rotation')
        return { rotate: pose.rotate };
    return { scale: pose.scale, scaleX: pose.scaleX, scaleY: pose.scaleY };
}
function withStaticGroup(item, group, value) {
    if (group === 'opacity')
        return { ...item, opacity: value };
    return { ...item, transform: { ...item.transform, ...value } };
}
/** Backfill old sparse points only when this group is written. Values are read before mutation. */
function normalizeItemKeyframeGroup(item, group) {
    const keyframes = pointsOf(item).map(point => {
        const copy = structuredClone(point);
        if (!declares(point, group))
            return copy;
        const value = valuesAt(item, point.t, group);
        if (group === 'opacity')
            copy.opacity = value;
        else
            copy.transform = { ...copy.transform, ...value };
        return copy;
    });
    return keyframes.length ? { ...item, keyframes } : item;
}
function fullMediaPoint(item, point) {
    if (!point.transform)
        return { ...point };
    return { ...point, transform: evaluatedItemTransform(item, point.t) };
}
function addGroupPoint(item, frame, group, value) {
    const at = frameOf(item, frame);
    const normalized = normalizeItemKeyframeGroup(item, group);
    const keyframes = pointsOf(normalized).map(point => isMedia(item) ? fullMediaPoint(normalized, point) : structuredClone(point));
    let seat = keyframes.find(point => point.t === at);
    if (!seat) {
        seat = { t: at };
        keyframes.push(seat);
    }
    if (group === 'opacity') {
        seat.opacity = value;
        if (isMedia(item))
            seat.transform = evaluatedItemTransform(item, at);
    }
    else
        seat.transform = { ...(isMedia(item) ? evaluatedItemTransform(item, at) : seat.transform),
            ...value };
    return { ...normalized, keyframes: legalPointArray(item, keyframes) };
}
/** Add one visible-pose point. A lone group point also becomes its static value. */
function activateItemKeyframeGroup(item, frame, group) {
    const at = frameOf(item, frame);
    const hadGroup = hasItemKeyframeGroup(item, group);
    const value = valuesAt(item, at, group);
    if (groupPoints(item, group).some(point => point.t === at))
        return normalizeItemKeyframeGroup(item, group);
    const updated = addGroupPoint(item, at, group, value);
    return hadGroup ? updated : withStaticGroup(updated, group, value);
}
/** Item-wide diamond: all four groups share one playhead point and one item result. */
function activateItemKeyframe(item, frame) {
    return ['position', 'size', 'rotation', 'opacity']
        .reduce((current, group) => activateItemKeyframeGroup(current, frame, group), item);
}
function activateItemTransformKeyframe(item, frame, field) {
    return activateItemKeyframeGroup(item, frame, groupOf(field));
}
function patchedGroupValue(item, frame, group, patch) {
    const current = evaluatedItemTransform(item, frame);
    if (group === 'position')
        return { x: patch.x ?? current.x, y: patch.y ?? current.y };
    if (group === 'rotation')
        return { rotate: patch.rotate ?? current.rotate };
    const adjusted = normalizedAxisPatch(current, patch);
    const scaleX = adjusted.scaleX ?? current.scaleX, scaleY = adjusted.scaleY ?? current.scaleY;
    return { scale: Math.sqrt(scaleX * scaleY), scaleX, scaleY };
}
function writeGroup(item, frame, group, patch) {
    const value = patchedGroupValue(item, frame, group, patch);
    if (!hasItemKeyframeGroup(item, group))
        return withStaticGroup(item, group, value);
    const initialPoint = groupPoints(item, group)[0];
    const updated = addGroupPoint(item, frame, group, value);
    return groupPoints(item, group).length === 1
        ? withStaticGroup(updated, group, valuesAt(updated, initialPoint.t, group)) : updated;
}
/** A gesture returns one updated item; every animated group auto-keys at the playhead. */
function writeItemTransformAt(item, frame, input) {
    validPatch(input);
    return [...new Set(Object.keys(input).map(field => groupOf(field)))].reduce((current, group) => writeGroup(current, frame, group, input), item);
}
function writeItemOpacityAt(item, frame, opacity) {
    if (!finite(opacity) || opacity < 0 || opacity > 1)
        throw new Error('Invalid opacity');
    if (!hasItemKeyframeGroup(item, 'opacity'))
        return withStaticGroup(item, 'opacity', opacity);
    const initialPoint = groupPoints(item, 'opacity')[0];
    const updated = addGroupPoint(item, frame, 'opacity', opacity);
    return groupPoints(item, 'opacity').length === 1
        ? withStaticGroup(updated, 'opacity', valuesAt(updated, initialPoint.t, 'opacity')) : updated;
}
/** Removing the last group point freezes the pose visible immediately before deletion. */
function removeItemKeyframeGroup(item, frame, group) {
    const at = frameOf(item, frame);
    if (!groupPoints(item, group).some(point => point.t === at))
        return item;
    const before = valuesAt(item, at, group);
    const normalized = normalizeItemKeyframeGroup(item, group);
    const keyframes = pointsOf(normalized).map(point => {
        const copy = structuredClone(point);
        if (copy.t !== at)
            return copy;
        if (group === 'opacity')
            delete copy.opacity;
        else if (copy.transform) {
            for (const field of GROUP_FIELDS[group])
                delete copy.transform[field];
            if (!Object.keys(copy.transform).length)
                delete copy.transform;
        }
        return copy;
    }).filter(point => point.transform || point.opacity !== undefined || point.crop || point.perspective
        || point.animator || point.gain_db !== undefined);
    let updated = { ...normalized, keyframes: legalPointArray(item, keyframes) };
    const remaining = groupPoints(updated, group);
    if (!remaining.length)
        updated = withStaticGroup(updated, group, before);
    else if (remaining.length === 1)
        updated = withStaticGroup(updated, group, valuesAt(normalized, remaining[0].t, group));
    return updated;
}
/** Timeline point deletion is deliberately whole-point, independent of the selected row. */
function removeItemKeyframePoint(item, frame) {
    const at = frameOf(item, frame);
    const point = pointsOf(item).find(entry => entry.t === at);
    if (!point)
        return item;
    const values = ['position', 'size', 'rotation', 'opacity']
        .filter(group => declares(point, group)).map(group => [group, valuesAt(item, at, group)]);
    const keyframes = pointsOf(item).filter(entry => entry.t !== at).map(entry => structuredClone(entry));
    let updated = { ...item, keyframes: legalPointArray(item, keyframes) };
    for (const [group, value] of values)
        if (!hasItemKeyframeGroup(updated, group)) {
            updated = withStaticGroup(updated, group, value);
        }
    return updated;
}
function moveItemKeyframeGroup(item, fromFrame, toFrame, group) {
    const from = frameOf(item, fromFrame), to = frameOf(item, toFrame);
    if (from === to)
        return item;
    const point = groupPoints(item, group).find(entry => entry.t === from);
    if (!point)
        return item;
    const value = valuesAt(item, from, group);
    const removed = removeItemKeyframeGroup(item, from, group);
    return addGroupPoint(removed, to, group, value);
}
