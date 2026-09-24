"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.shapeSourceFromPreset = shapeSourceFromPreset;
/** Materialize a preset as an independent edit.json value; later catalog changes cannot change pixels. */
function shapeSourceFromPreset(row, byId) {
    const defaults = structuredClone(row.defaults);
    if (row.kind === 'line')
        return { kind: 'shape', shape: 'line', params: { ...defaults, preset: row.id } };
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
