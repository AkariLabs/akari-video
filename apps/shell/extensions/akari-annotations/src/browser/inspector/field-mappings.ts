export type TelopParamControlKind = 'text' | 'scrub-number' | 'boolean-select';

export function telopParamControlKind(value: unknown): TelopParamControlKind | undefined {
    if (typeof value === 'string') return 'text';
    if (typeof value === 'number') return 'scrub-number';
    if (typeof value === 'boolean') return 'boolean-select';
    return undefined;
}

export function chromaControlValue(
    chromaKey: { similarity?: number; blend?: number } | undefined,
    field: 'similarity' | 'blend',
    fallback: number
): number | undefined {
    return chromaKey ? chromaKey[field] ?? fallback : undefined;
}

export interface LayerSnapshotChromaKey {
    color: string;
    similarity?: number;
    blend?: number;
}

export function layerSnapshotChromaKey(
    projected: LayerSnapshotChromaKey | undefined,
    rawSourceChromaKey: unknown
): LayerSnapshotChromaKey | undefined {
    if (projected) return projected;
    return rawSourceChromaKey !== null && typeof rawSourceChromaKey === 'object'
        && !Array.isArray(rawSourceChromaKey)
        ? rawSourceChromaKey as LayerSnapshotChromaKey : undefined;
}

export type LegacyTransformTarget = 'cut' | 'layer';
export type LegacyTransformOperation = 'cut-scale' | 'cut-rotate' | 'layer-scale' | 'layer-rotate';

export function legacyTransformOpFor(
    path: string,
    target: LegacyTransformTarget
): LegacyTransformOperation | undefined {
    if (path === 'transform.scale') return target === 'cut' ? 'cut-scale' : 'layer-scale';
    if (path === 'transform.rotate') return target === 'cut' ? 'cut-rotate' : 'layer-rotate';
    return undefined;
}
