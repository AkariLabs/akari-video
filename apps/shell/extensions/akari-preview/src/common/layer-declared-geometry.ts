export interface LayerDeclaredSize {
    width: number;
    height: number;
}

/** Metadata is optional for engine ledger media. Keep each source size pair coherent. */
export function resolveLayerDeclaredSize(
    videoWidth: number,
    videoHeight: number,
    output: LayerDeclaredSize
): LayerDeclaredSize {
    if (videoWidth > 0 && videoHeight > 0) return { width: videoWidth, height: videoHeight };
    return { width: output.width, height: output.height };
}

/** Stage-local output pixels -> source pixels, around the crop centre (rotation in degrees).
 * Self-contained so the webview can inject this function with toString().
 */
export function layerDeclaredGeometryHitAt(
    size: LayerDeclaredSize,
    output: LayerDeclaredSize,
    transform: { x: number; y: number; scale: number; rotate: number },
    crop: { x: number; y: number; w: number; h: number },
    point: { x: number; y: number } | null
): boolean {
    if (!point || !(size.width > 0) || !(size.height > 0)) return false;
    const dx = point.x - (output.width / 2 + transform.x);
    const dy = point.y - (output.height / 2 + transform.y);
    const rad = -transform.rotate * Math.PI / 180;
    const x = (dx * Math.cos(rad) - dy * Math.sin(rad)) / (transform.scale || 1)
        + (crop.x + crop.w / 2) * size.width;
    const y = (dx * Math.sin(rad) + dy * Math.cos(rad)) / (transform.scale || 1)
        + (crop.y + crop.h / 2) * size.height;
    return x >= crop.x * size.width && x < (crop.x + crop.w) * size.width
        && y >= crop.y * size.height && y < (crop.y + crop.h) * size.height;
}
