/** Fit an explicit text line without crossing the output frame width. */
export function captionWrapFitWidth(
    longestLinePx: number, paddingPx: number, outputWidth: number
): { widthPx: number; widthPct: number } {
    if (![longestLinePx, paddingPx, outputWidth].every(Number.isFinite)
        || longestLinePx < 0 || paddingPx < 0 || outputWidth <= 0) {
        throw new Error('折り返し幅の寸法が不正です');
    }
    const widthPx = Math.min(outputWidth, Math.max(8, Math.ceil(longestLinePx + paddingPx)));
    return { widthPx, widthPct: Math.round(widthPx / outputWidth * 10000) / 100 };
}

/** Compensate a width change so the visible glyph origin remains fixed. */
export function captionWrapFitPosition(
    layout: { left: number; top: number },
    beforeInk: { x: number; y: number }, afterInk: { x: number; y: number }
): { left: number; top: number } {
    return { left: layout.left + beforeInk.x - afterInk.x,
        top: layout.top + beforeInk.y - afterInk.y };
}
