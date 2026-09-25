export interface PhotoHitSize { width: number; height: number }
export interface PhotoHitCrop { x: number; y: number; w: number; h: number; rotate?: number }

/** Inverse-map an output pixel to the visible source pixel. Kept self-contained for webview injection. */
export function previewPhotoSourcePoint(
    size: PhotoHitSize, output: PhotoHitSize,
    transform: { x: number; y: number; scale: number; scaleX?: number; scaleY?: number; rotate: number },
    crop: PhotoHitCrop, point: { x: number; y: number } | null,
    flip?: { h?: boolean; v?: boolean }, cornerRadius = 0
): { x: number; y: number } | null {
    if (!point || !(size.width > 0 && size.height > 0 && crop.w > 0 && crop.h > 0)) return null;
    const sx = transform.scaleX ?? transform.scale;
    const sy = transform.scaleY ?? transform.scale;
    if (!(sx > 0 && sy > 0)) return null;
    const dx = point.x - output.width / 2 - transform.x;
    const dy = point.y - output.height / 2 - transform.y;
    const rad = -transform.rotate * Math.PI / 180;
    const outerX = dx * Math.cos(rad) - dy * Math.sin(rad);
    const outerY = dx * Math.sin(rad) + dy * Math.cos(rad);
    const halfW = crop.w * size.width * sx / 2;
    const halfH = crop.h * size.height * sy / 2;
    if (Math.abs(outerX) >= halfW || Math.abs(outerY) >= halfH) return null;
    if (cornerRadius > 0) {
        const radius = Math.min(halfW, halfH) * Math.min(100, cornerRadius) / 100;
        const cornerX = Math.max(0, Math.abs(outerX) - (halfW - radius));
        const cornerY = Math.max(0, Math.abs(outerY) - (halfH - radius));
        if (cornerX * cornerX + cornerY * cornerY > radius * radius) return null;
    }
    const fx = flip?.h ? -outerX : outerX;
    const fy = flip?.v ? -outerY : outerY;
    const cropRad = -(crop.rotate || 0) * Math.PI / 180;
    const cx = fx * Math.cos(cropRad) - fy * Math.sin(cropRad) * sx / sy;
    const cy = fx * Math.sin(cropRad) * sy / sx + fy * Math.cos(cropRad);
    const x = cx / sx + (crop.x + crop.w / 2) * size.width;
    const y = cy / sy + (crop.y + crop.h / 2) * size.height;
    if (x < 0 || x >= size.width || y < 0 || y >= size.height) return null;
    if (x < crop.x * size.width || x >= (crop.x + crop.w) * size.width
        || y < crop.y * size.height || y >= (crop.y + crop.h) * size.height) return null;
    return { x: Math.floor(x), y: Math.floor(y) };
}

/** Largest visual stack index wins; transparent candidates are omitted before sorting. */
export function frontmostPreviewHit<T>(hits: readonly { element: T; z: number; order: number }[]): T | null {
    let winner: { element: T; z: number; order: number } | null = null;
    for (const hit of hits) {
        if (!winner || hit.z > winner.z || (hit.z === winner.z && hit.order > winner.order)) winner = hit;
    }
    return winner?.element ?? null;
}
