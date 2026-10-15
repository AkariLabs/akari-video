"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CAPTION_LOOK_RATIO_TOLERANCE = exports.CAPTION_LOOK_PX_FIELDS = void 0;
exports.scaledCaptionLookPart = scaledCaptionLookPart;
exports.captionLookHasPixels = captionLookHasPixels;
exports.captionLookPartRatio = captionLookPartRatio;
exports.fillMissingCaptionLookPixels = fillMissingCaptionLookPixels;
exports.scaledCaptionLook = scaledCaptionLook;
exports.captionPresetDerivedParts = captionPresetDerivedParts;
const PX_FIELDS = {
    stroke: ['width_px'], stroke_inner: ['width_px'], extrude: ['depth_px'],
    shadow: ['blur_px', 'distance_px'], glow: ['spread', 'offset_x', 'offset_y'],
    background: ['radius_px', 'padding_px', 'offset_x', 'offset_y'],
    strokes: ['width_px', 'offset_x', 'offset_y'], fill: ['pattern.scale']
};
exports.CAPTION_LOOK_PX_FIELDS = PX_FIELDS;
exports.CAPTION_LOOK_RATIO_TOLERANCE = 1e-6;
function object(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function scalePart(value, fields, ratio) {
    if (Array.isArray(value))
        return value.map(item => scalePart(item, fields, ratio));
    if (!object(value))
        return value;
    const copy = structuredClone(value);
    for (const field of fields) {
        const path = field.split('.');
        let target = copy;
        for (const segment of path.slice(0, -1))
            target = object(target?.[segment]) ? target[segment] : undefined;
        const last = path.at(-1);
        if (target && typeof target[last] === 'number')
            target[last] *= ratio;
    }
    return copy;
}
function scaledCaptionLookPart(key, value, ratio) {
    return scalePart(value, PX_FIELDS[key] ?? [], ratio);
}
function captionLookHasPixels(key, value) {
    const paths = PX_FIELDS[key] ?? [];
    const visit = (part, prefix = '') => {
        if (Array.isArray(part))
            return part.some(item => visit(item, prefix));
        if (object(part))
            return Object.entries(part).some(([field, entry]) => visit(entry, prefix ? `${prefix}.${field}` : field));
        return typeof part === 'number' && paths.includes(prefix);
    };
    return visit(value);
}
function captionLookPartRatio(key, preset, override, compareNonPx = true) {
    const paths = PX_FIELDS[key];
    return paths ? derivedRatio(preset, override, paths, compareNonPx) : undefined;
}
function fillMissingCaptionLookPixels(key, preset, override, ratio) {
    if (key === 'strokes' || key === 'fill' || !object(preset) || !object(override))
        return undefined;
    const copy = structuredClone(override);
    let added = false;
    for (const field of PX_FIELDS[key] ?? []) {
        const path = field.split('.');
        let source = preset;
        let target = copy;
        for (const segment of path.slice(0, -1)) {
            source = object(source?.[segment]) ? source[segment] : undefined;
            target = object(target?.[segment]) ? target[segment] : undefined;
        }
        const last = path.at(-1);
        if (source && target && typeof source[last] === 'number' && !(last in target)) {
            target[last] = source[last] * ratio;
            added = true;
        }
    }
    if (!added)
        return undefined;
    for (const [field, value] of Object.entries(preset)) {
        if (!(field in copy))
            copy[field] = structuredClone(value);
    }
    return copy;
}
/** Copy only visual components; the caller keeps the caption's own size and reference height. */
function scaledCaptionLook(look, targetSize) {
    const base = look.size_px;
    const ratio = typeof base === 'number' && Number.isFinite(base) && base > 0 ? targetSize / base : 1;
    const scaled = { ...look };
    for (const [key, fields] of Object.entries(PX_FIELDS)) {
        if (key in look)
            scaled[key] = scalePart(look[key], fields, ratio);
    }
    delete scaled.size_px;
    delete scaled.reference_height_px;
    return scaled;
}
function close(actual, expected) {
    return Math.abs(actual - expected) <= exports.CAPTION_LOOK_RATIO_TOLERANCE * Math.abs(expected);
}
function derivedRatio(base, value, paths, compareNonPx = true) {
    let ratio;
    const visit = (source, copy, prefix = '') => {
        if (Array.isArray(source) || Array.isArray(copy)) {
            return Array.isArray(source) && Array.isArray(copy) && source.length === copy.length
                && source.every((item, index) => visit(item, copy[index], prefix));
        }
        if (object(source) || object(copy)) {
            return object(source) && object(copy)
                && Object.keys(source).length === Object.keys(copy).length
                && Object.keys(source).every(key => Object.prototype.hasOwnProperty.call(copy, key)
                    && visit(source[key], copy[key], prefix ? `${prefix}.${key}` : key));
        }
        if (!paths.includes(prefix))
            return !compareNonPx || Object.is(source, copy);
        if (typeof source !== 'number' || typeof copy !== 'number' || !Number.isFinite(copy))
            return false;
        if (source === 0)
            return copy === 0;
        const candidate = copy / source;
        if (!(candidate > 0))
            return false;
        if (ratio === undefined)
            ratio = candidate;
        return close(copy, source * ratio);
    };
    return visit(base, value) ? ratio ?? 1 : undefined;
}
function captionPresetDerivedParts(preset, override) {
    const result = new Map();
    for (const [key, paths] of Object.entries(PX_FIELDS)) {
        if (!(key in preset) || !(key in override))
            continue;
        const ratio = derivedRatio(preset[key], override[key], paths);
        if (ratio !== undefined)
            result.set(key, ratio);
    }
    return result;
}
