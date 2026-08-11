// task.md 指示4 (rect tool): dragging inside the preview produces two normalized 0-1 points
// (the same content-rect normalization already used by the pen tool's normalizedPenPoint --
// see akari-preview-open-handler.ts). This module turns that drag into a box in the same
// [x, y, w, h] shape as review.json's region.box / analysis.schema.json's faceBox / crop.box
// (docs/contract-2026-07-20-review-json-v1-annotation-model.md §2: "x+w<=1 かつ y+h<=1"), so a
// future landing into an annotation record's region field needs no reshaping.
//
// Serialized into the preview webview via Function.prototype.toString() -- see
// cut-freeze-visual.ts's header comment for the established pattern. Keep this self-contained:
// no closures over module state, no calls to sibling functions in this file.

export type NormalizedRectBox = [number, number, number, number];

/**
 * Builds a normalized box from two normalized 0-1 drag points, in either drag direction.
 * Clamps both points into [0, 1] first (defensive -- callers already clamp, see
 * normalizedPenPoint), then clamps width/height so x+w<=1 and y+h<=1 hold exactly.
 */
export function normalizeRectFromPoints(
    start: readonly [number, number],
    end: readonly [number, number]
): NormalizedRectBox {
    const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));
    const startX = clamp01(start[0]);
    const startY = clamp01(start[1]);
    const endX = clamp01(end[0]);
    const endY = clamp01(end[1]);
    const x = Math.min(startX, endX);
    const y = Math.min(startY, endY);
    const w = Math.min(Math.max(startX, endX) - x, 1 - x);
    const h = Math.min(Math.max(startY, endY) - y, 1 - y);
    return [x, y, w, h];
}
