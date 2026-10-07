import type { EditV2 } from './edit-v2';
/** 素材を追加する前の v2 編集。呼び出すたびに独立した値を返す。 */
export declare function createEmptyEditV2(options?: {
    width?: number;
    height?: number;
    fps?: number;
    geometry?: 'source' | 'omit';
}): EditV2;
