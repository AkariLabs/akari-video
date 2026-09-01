"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.mergePresetTextStyle = mergePresetTextStyle;
exports.resolveCaptionStylePreset = resolveCaptionStylePreset;
exports.applyCaptionStylePresets = applyCaptionStylePresets;
const NESTED_STYLE_FIELDS = [
    'stroke',
    'background',
    'shadow',
    'glow',
    'position',
    'animation'
];
function mergePresetTextStyle(presetStyle, recordStyle) {
    const override = isRecord(recordStyle) ? recordStyle : {};
    const merged = {
        ...presetStyle,
        ...override
    };
    for (const field of NESTED_STYLE_FIELDS) {
        const base = isRecord(presetStyle[field]) ? presetStyle[field] : undefined;
        const nestedOverride = isRecord(override[field]) ? override[field] : undefined;
        if (base || nestedOverride) {
            const nested = { ...base, ...nestedOverride };
            if (Object.keys(nested).length > 0)
                merged[field] = nested;
            else
                delete merged[field];
        }
    }
    return merged;
}
function resolveCaptionStylePreset(record, catalog) {
    const presetId = record.style_preset;
    if (typeof presetId !== 'string')
        return { record, resolved: false };
    const preset = catalog instanceof Map
        ? catalog.get(presetId)
        : Object.prototype.hasOwnProperty.call(catalog, presetId)
            ? catalog[presetId]
            : undefined;
    if (!preset)
        return { record, resolved: false };
    return {
        record: {
            ...record,
            text_style: mergePresetTextStyle(preset.style, record.text_style)
        },
        resolved: true
    };
}
function applyCaptionStylePresets(root, catalog) {
    const values = Array.isArray(root)
        ? root
        : isRecord(root) && Array.isArray(root.captions)
            ? root.captions
            : null;
    if (!values)
        return { root, unresolved: [] };
    let sawPreset = false;
    let changed = false;
    const unresolved = new Set();
    const captions = values.map(value => {
        if (!isRecord(value) || !Object.prototype.hasOwnProperty.call(value, 'style_preset')) {
            return value;
        }
        sawPreset = true;
        const result = resolveCaptionStylePreset(value, catalog);
        if (result.resolved)
            changed = true;
        else if (typeof value.style_preset === 'string')
            unresolved.add(value.style_preset);
        return result.record;
    });
    if (!sawPreset || !changed) {
        return { root, unresolved: [...unresolved] };
    }
    return {
        root: (Array.isArray(root)
            ? captions
            : { ...root, captions }),
        unresolved: [...unresolved]
    };
}
function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
