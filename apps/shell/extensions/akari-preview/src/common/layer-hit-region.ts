export interface LayerHitRegionRect {
    x: number;
    y: number;
    w: number;
    h: number;
}

/**
 * Resolves a source-pixel alpha footprint and normalized crop into one local CSS clip-path.
 * The returned inset clips both painting and native pointer hit-testing before layer transforms.
 */
export function resolveLayerHitRegionClip(
    videoWidth: number,
    videoHeight: number,
    crop: LayerHitRegionRect,
    opaqueBox?: LayerHitRegionRect
): string {
    if (!(videoWidth > 0) || !(videoHeight > 0)) return '';
    const cropBox = {
        x: Math.max(0, crop.x) * videoWidth,
        y: Math.max(0, crop.y) * videoHeight,
        w: Math.max(0, crop.w) * videoWidth,
        h: Math.max(0, crop.h) * videoHeight
    };
    const sourceBox = opaqueBox && opaqueBox.w > 0 && opaqueBox.h > 0 ? opaqueBox : cropBox;
    const left = Math.max(cropBox.x, sourceBox.x);
    const top = Math.max(cropBox.y, sourceBox.y);
    const right = Math.min(cropBox.x + cropBox.w, sourceBox.x + sourceBox.w);
    const bottom = Math.min(cropBox.y + cropBox.h, sourceBox.y + sourceBox.h);
    const resolved = right > left && bottom > top
        ? { left, top, right, bottom }
        : {
            left: cropBox.x,
            top: cropBox.y,
            right: cropBox.x + cropBox.w,
            bottom: cropBox.y + cropBox.h
        };
    const percentages = [
        resolved.top / videoHeight * 100,
        Math.max(0, videoWidth - resolved.right) / videoWidth * 100,
        Math.max(0, videoHeight - resolved.bottom) / videoHeight * 100,
        resolved.left / videoWidth * 100
    ];
    if (percentages.every(value => Math.abs(value) < 1e-9)) return '';
    return `inset(${percentages[0]}% ${percentages[1]}% ${percentages[2]}% ${percentages[3]}%)`;
}
