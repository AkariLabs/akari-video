"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createEmptyEditV2 = createEmptyEditV2;
/** 素材を追加する前の v2 編集。呼び出すたびに独立した値を返す。 */
function createEmptyEditV2(options = {}) {
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
