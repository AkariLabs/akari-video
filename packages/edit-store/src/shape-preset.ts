import { ShapeParamsV0, ShapeSourceV2 } from './edit-v2';

export interface ShapePresetV1 {
    id: string;
    category: string;
    name: string;
    vb: [number, number];
    d: string;
    kind: 'fill' | 'stroke' | 'line' | 'bubble';
    rule?: 'nonzero' | 'evenodd';
    rounded_from?: { base: string; radius: number };
    defaults: ShapeParamsV0;
}

/** Materialize a preset as an independent edit.json value; later catalog changes cannot change pixels. */
export function shapeSourceFromPreset(
    row: ShapePresetV1,
    byId: ReadonlyMap<string, ShapePresetV1>,
): ShapeSourceV2 {
    const defaults: ShapeParamsV0 = structuredClone(row.defaults);
    if (row.kind === 'line') return { kind: 'shape', shape: 'line', params: { ...defaults, preset: row.id } };
    if (row.kind === 'bubble') {
        return { kind: 'shape', shape: 'bubble', params: { ...defaults, preset: row.id } };
    }
    const base = row.rounded_from ? byId.get(row.rounded_from.base) : row;
    if (!base || base.kind === 'line' || base.kind === 'bubble') {
        throw new Error(`invalid shape base for ${row.id}`);
    }
    return {
        kind: 'shape',
        shape: 'path',
        params: {
            ...defaults,
            ...(row.rounded_from ? { cornerRadius: row.rounded_from.radius } : {}),
            preset: row.id,
            path: { d: base.d, vb: [...base.vb], ...(base.rule ? { rule: base.rule } : {}) },
        },
    };
}
