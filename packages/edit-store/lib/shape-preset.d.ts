import { ShapeParamsV0, ShapeSourceV2 } from './edit-v2';
export interface ShapePresetV1 {
    id: string;
    category: string;
    name: string;
    vb: [number, number];
    d: string;
    kind: 'fill' | 'stroke' | 'line' | 'bubble';
    rule?: 'nonzero' | 'evenodd';
    rounded_from?: {
        base: string;
        radius: number;
    };
    defaults: ShapeParamsV0;
}
/** Materialize a preset as an independent edit.json value; later catalog changes cannot change pixels. */
export declare function shapeSourceFromPreset(row: ShapePresetV1, byId: ReadonlyMap<string, ShapePresetV1>): ShapeSourceV2;
