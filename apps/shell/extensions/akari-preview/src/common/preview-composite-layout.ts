export interface PreviewCompositeRect {
    x: number;
    y: number;
    width: number;
    height: number;
}

/**
 * Fits a content rectangle into a CSS box without changing its aspect ratio.
 *
 * This function is also serialized into the preview webview. Keep it
 * self-contained: it must not close over module state or call other helpers.
 */
export function fitPreviewCompositeRect(
    boxWidth: number,
    boxHeight: number,
    contentWidth: number,
    contentHeight: number
): PreviewCompositeRect {
    const safeBoxWidth = Number.isFinite(boxWidth) && boxWidth > 0 ? boxWidth : 0;
    const safeBoxHeight = Number.isFinite(boxHeight) && boxHeight > 0 ? boxHeight : 0;
    if (!(safeBoxWidth > 0) || !(safeBoxHeight > 0)
        || !(Number.isFinite(contentWidth) && contentWidth > 0)
        || !(Number.isFinite(contentHeight) && contentHeight > 0)) {
        return { x: 0, y: 0, width: safeBoxWidth, height: safeBoxHeight };
    }

    const boxAspect = safeBoxWidth / safeBoxHeight;
    const contentAspect = contentWidth / contentHeight;
    const width = contentAspect > boxAspect
        ? safeBoxWidth
        : safeBoxHeight * contentAspect;
    const height = contentAspect > boxAspect
        ? safeBoxWidth / contentAspect
        : safeBoxHeight;
    return {
        x: (safeBoxWidth - width) / 2,
        y: (safeBoxHeight - height) / 2,
        width,
        height
    };
}
