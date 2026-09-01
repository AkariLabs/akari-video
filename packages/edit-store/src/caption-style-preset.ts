export type TextstylePreset = {
    id: string;
    name: string;
    category: string;
    style: Record<string, unknown>;
};

export type TextstyleCatalog =
    | ReadonlyMap<string, TextstylePreset>
    | Record<string, TextstylePreset>;

const NESTED_STYLE_FIELDS = [
    'stroke',
    'background',
    'shadow',
    'glow',
    'position',
    'animation'
] as const;

export function mergePresetTextStyle(
    presetStyle: Record<string, unknown>,
    recordStyle: unknown
): Record<string, unknown> {
    const override = isRecord(recordStyle) ? recordStyle : {};
    const merged: Record<string, unknown> = {
        ...presetStyle,
        ...override
    };
    for (const field of NESTED_STYLE_FIELDS) {
        const base = isRecord(presetStyle[field]) ? presetStyle[field] : undefined;
        const nestedOverride = isRecord(override[field]) ? override[field] : undefined;
        if (base || nestedOverride) {
            const nested = { ...base, ...nestedOverride };
            if (Object.keys(nested).length > 0) merged[field] = nested;
            else delete merged[field];
        }
    }
    return merged;
}

export function resolveCaptionStylePreset<T extends Record<string, unknown>>(
    record: T,
    catalog: TextstyleCatalog
): { record: T; resolved: boolean } {
    const presetId = record.style_preset;
    if (typeof presetId !== 'string') return { record, resolved: false };
    const preset = catalog instanceof Map
        ? catalog.get(presetId)
        : Object.prototype.hasOwnProperty.call(catalog, presetId)
            ? catalog[presetId]
            : undefined;
    if (!preset) return { record, resolved: false };
    return {
        record: {
            ...record,
            text_style: mergePresetTextStyle(preset.style, record.text_style)
        },
        resolved: true
    } as { record: T; resolved: boolean };
}

export function applyCaptionStylePresets<T>(
    root: T,
    catalog: TextstyleCatalog
): { root: T; unresolved: string[] } {
    const values = Array.isArray(root)
        ? root
        : isRecord(root) && Array.isArray(root.captions)
            ? root.captions
            : null;
    if (!values) return { root, unresolved: [] };

    let sawPreset = false;
    let changed = false;
    const unresolved = new Set<string>();
    const captions = values.map(value => {
        if (!isRecord(value) || !Object.prototype.hasOwnProperty.call(value, 'style_preset')) {
            return value;
        }
        sawPreset = true;
        const result = resolveCaptionStylePreset(value, catalog);
        if (result.resolved) changed = true;
        else if (typeof value.style_preset === 'string') unresolved.add(value.style_preset);
        return result.record;
    });

    if (!sawPreset || !changed) {
        return { root, unresolved: [...unresolved] };
    }
    return {
        root: (Array.isArray(root)
            ? captions
            : { ...root, captions }) as T,
        unresolved: [...unresolved]
    };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
