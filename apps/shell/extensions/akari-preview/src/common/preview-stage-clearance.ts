export interface PreviewBarRect { top: number; height: number }
export interface PreviewStageClearance {
    top: number;
    barHeight: number;
    holdUntil: number;
    retryAfter: number | null;
}

/** Serialized into the webview; keep this function independent of module state. */
export function computePreviewStageClearance(
    current: PreviewStageClearance, bar: PreviewBarRect | null, now: number, playing: boolean
): PreviewStageClearance {
    const visible = bar !== null && Number.isFinite(bar.top) && Number.isFinite(bar.height) && bar.height > 0;
    // A shorter replacement bar keeps the current space; only an absent bar releases it.
    const desiredTop = visible ? Math.max(current.top, 16, bar!.top + bar!.height + 8) : 16;
    const desiredHeight = visible ? Math.max(current.barHeight, bar!.height) : 0;
    // Infinity means the bar is still visible; start the grace period on its first null report.
    const holdUntil = visible ? Infinity : current.holdUntil === Infinity ? now + 1000 : current.holdUntil;
    if (playing) return { ...current, holdUntil,
        retryAfter: desiredTop !== current.top || desiredHeight !== current.barHeight ? 100 : null };
    if (!visible && now < holdUntil && (current.top > 16 || current.barHeight > 0)) {
        return { ...current, holdUntil, retryAfter: holdUntil - now };
    }
    return { top: desiredTop, barHeight: desiredHeight, holdUntil, retryAfter: null };
}

/** Pan remains possible at fit, with more travel for zoomed content. */
export function computePreviewPanLimits(
    paneWidth: number, paneHeight: number, stageWidth: number, stageHeight: number,
    zoom: number, barHeight: number
): { x: number; y: number } {
    const margin = Math.max(0, barHeight) + 16;
    if (zoom <= 1.05) return { x: margin, y: margin };
    return {
        x: Math.max(0, (stageWidth * zoom - paneWidth) / 2, stageWidth * (zoom - 1) / 2) + margin,
        y: Math.max(0, (stageHeight * zoom - paneHeight) / 2, stageHeight * (zoom - 1) / 2) + margin
    };
}

/** Cursor is measured from the zoom layer's 50% transform origin. */
export function pinchPreviewPan(
    pan: { x: number; y: number }, cursor: { x: number; y: number }, zoom: number, nextZoom: number
): { x: number; y: number } {
    const ratio = nextZoom / zoom;
    return { x: cursor.x - (cursor.x - pan.x) * ratio,
        y: cursor.y - (cursor.y - pan.y) * ratio };
}
