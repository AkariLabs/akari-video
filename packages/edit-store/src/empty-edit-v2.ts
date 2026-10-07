import type { EditV2 } from './edit-v2';

/** 素材を追加する前の v2 編集。呼び出すたびに独立した値を返す。 */
export function createEmptyEditV2(options: { width?: number; height?: number; fps?: number } = {}): EditV2 {
    return {
        version: 2,
        output: {
            width: options.width ?? 1920,
            height: options.height ?? 1080,
            fps: options.fps ?? 30,
            geometry: 'source'
        },
        sources: [],
        tracks: []
    };
}
