export interface ZoomMinimapLayoutInput {
    paneWidth: number;
    paneHeight: number;
    stageWidth: number;
    stageHeight: number;
    zoom: number;
    pan: { x: number; y: number };
    outputWidth: number;
    outputHeight: number;
    boxSize?: number;
}

export interface ZoomMinimapLayout {
    box: { width: number; height: number };
    viewport: { left: number; top: number; width: number; height: number };
}

/**
 * Maps the pane padding box's intersection with a centered, zoomed and panned stage
 * into normalized minimap coordinates. Pan is in unscaled CSS pixels.
 *
 * This function is also serialized into the preview webview. Keep it
 * self-contained: it must not close over module state or call other helpers.
 */
export function computeZoomMinimapLayout({
    paneWidth, paneHeight, stageWidth, stageHeight, zoom, pan,
    outputWidth, outputHeight, boxSize = 64
}: ZoomMinimapLayoutInput): ZoomMinimapLayout {
    const size = Number.isFinite(boxSize) && boxSize > 0 ? boxSize : 64;
    const aspect = Number.isFinite(outputWidth) && outputWidth > 0
        && Number.isFinite(outputHeight) && outputHeight > 0 ? outputWidth / outputHeight : 1;
    const box = {
        width: aspect >= 1 ? size : size * aspect,
        height: aspect >= 1 ? size / aspect : size
    };
    const scaledWidth = stageWidth * zoom;
    const scaledHeight = stageHeight * zoom;
    if (!(Number.isFinite(scaledWidth) && scaledWidth > 0)
        || !(Number.isFinite(scaledHeight) && scaledHeight > 0)
        || !(Number.isFinite(paneWidth) && paneWidth >= 0)
        || !(Number.isFinite(paneHeight) && paneHeight >= 0)) {
        return { box, viewport: { left: 0, top: 0, width: 1, height: 1 } };
    }
    const stageLeft = (paneWidth - scaledWidth) / 2 + (Number.isFinite(pan.x) ? pan.x : 0);
    const stageTop = (paneHeight - scaledHeight) / 2 + (Number.isFinite(pan.y) ? pan.y : 0);
    const left = Math.min(1, Math.max(0, -stageLeft / scaledWidth));
    const top = Math.min(1, Math.max(0, -stageTop / scaledHeight));
    const right = Math.min(1, Math.max(0, (paneWidth - stageLeft) / scaledWidth));
    const bottom = Math.min(1, Math.max(0, (paneHeight - stageTop) / scaledHeight));
    return { box, viewport: { left, top, width: right - left, height: bottom - top } };
}
