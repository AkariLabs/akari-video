"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.evaluatedItemTransform = evaluatedItemTransform;
exports.hasTransformKeyframe = hasTransformKeyframe;
exports.activateItemTransformKeyframe = activateItemTransformKeyframe;
exports.writeItemTransformAt = writeItemTransformAt;
const FIELDS = ['x', 'y', 'scale', 'scaleX', 'scaleY', 'rotate'];
const DEFAULTS = { x: 0, y: 0, scale: 1, scaleX: 1, scaleY: 1, rotate: 0 };
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
        if (!finite(value) && media)
            value = DEFAULTS[field];
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
    if (points.length < 2 || !points.some(point => point.transform))
        return base;
    const at = frameOf(item, frame);
    return Object.fromEntries(FIELDS.map(field => [field,
        valueAt(points, at, field, media && field !== 'scaleX' && field !== 'scaleY'
            ? DEFAULTS[field] : base[field], media, staticValue)]));
}
function hasTransformKeyframe(item, field) {
    return pointsOf(item).some(point => finite(point.transform?.[field]));
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
function fullMediaPoint(item, point) {
    if (!point.transform)
        return { ...point };
    return { ...point, transform: evaluatedItemTransform(item, point.t) };
}
/** Toggle-on: seed the currently visible pose; media points are complete because the cut evaluator replaces a whole transform. */
function activateItemTransformKeyframe(item, frame, field) {
    const at = frameOf(item, frame), before = evaluatedItemTransform(item, at);
    const points = pointsOf(item);
    if (hasTransformKeyframe(item, field) && points.some(point => point.t === at && finite(point.transform?.[field])))
        return item;
    const next = points.map(point => isMedia(item) ? fullMediaPoint(item, point) : { ...point });
    const value = isMedia(item) ? { ...before } : field === 'scale'
        ? { scale: Math.sqrt(before.scaleX * before.scaleY), scaleX: before.scaleX, scaleY: before.scaleY }
        : { [field]: before[field] };
    const seat = next.find(point => point.t === at);
    if (seat)
        seat.transform = { ...seat.transform, ...value };
    else
        next.push({ t: at, transform: value });
    if (next.length === 1) {
        next.push({ t: at === 0 ? item.duration : 0, transform: { ...value } });
    }
    return { ...item, keyframes: next.sort((a, b) => a.t - b.t) };
}
/** One gesture produces one updated item; only animated coordinates receive a point at the playhead. */
function writeItemTransformAt(item, frame, input) {
    validPatch(input);
    const at = frameOf(item, frame), current = evaluatedItemTransform(item, at);
    const patch = normalizedAxisPatch(current, input);
    const animated = new Set(FIELDS.filter(field => hasTransformKeyframe(item, field)));
    if (patch.scale !== undefined && (animated.has('scaleX') || animated.has('scaleY')))
        animated.add('scale');
    if (animated.has('scale')) {
        animated.add('scaleX');
        animated.add('scaleY');
    }
    const base = { ...item.transform };
    const pointPatch = {};
    for (const field of FIELDS) {
        const value = patch[field];
        if (value === undefined)
            continue;
        if (animated.has(field))
            pointPatch[field] = value;
        else
            base[field] = value;
    }
    if (patch.scaleX !== undefined || patch.scaleY !== undefined) {
        if (animated.has('scale')) {
            pointPatch.scaleX ??= current.scaleX;
            pointPatch.scaleY ??= current.scaleY;
        }
        const x = pointPatch.scaleX ?? base.scaleX ?? base.scale ?? current.scaleX;
        const y = pointPatch.scaleY ?? base.scaleY ?? base.scale ?? current.scaleY;
        if (animated.has('scale'))
            pointPatch.scale = Math.sqrt(x * y);
        else if (base.scaleX !== undefined || base.scaleY !== undefined)
            base.scale = Math.sqrt(x * y);
    }
    let keyframes = pointsOf(item);
    if (Object.keys(pointPatch).length) {
        keyframes = keyframes.map(point => isMedia(item) ? fullMediaPoint(item, point) : { ...point });
        let seat = keyframes.find(point => point.t === at);
        if (!seat) {
            seat = { t: at };
            keyframes.push(seat);
        }
        seat.transform = { ...(isMedia(item) ? current : seat.transform), ...pointPatch };
        keyframes.sort((a, b) => a.t - b.t);
    }
    return { ...item, transform: base, ...(keyframes.length ? { keyframes } : {}) };
}
