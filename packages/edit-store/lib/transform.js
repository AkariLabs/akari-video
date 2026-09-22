"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.effectiveScale = effectiveScale;
exports.normalizeTransform = normalizeTransform;
/** Axis overrides take precedence over the legacy uniform scale. */
function effectiveScale(transform) {
    return { x: transform?.scaleX ?? transform?.scale ?? 1, y: transform?.scaleY ?? transform?.scale ?? 1 };
}
/** Only explicit axis declarations are normalized; legacy documents stay byte-compatible. */
function normalizeTransform(transform) {
    const result = { ...transform };
    if (result.scaleX === undefined && result.scaleY === undefined)
        return result;
    const axes = effectiveScale(result);
    if (axes.x === axes.y) {
        result.scale = axes.x;
        delete result.scaleX;
        delete result.scaleY;
    }
    return result;
}
