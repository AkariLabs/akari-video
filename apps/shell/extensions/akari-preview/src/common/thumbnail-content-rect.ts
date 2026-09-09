export interface ThumbnailContentRect { x: number; y: number; width: number; height: number; }

/** Bounds of alpha > threshold in a contiguous BGRA bitmap. */
export function alphaContentRect(
    pixels: ArrayLike<number>, width: number, height: number, threshold = 8
): ThumbnailContentRect | undefined {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1
        || pixels.length < width * height * 4) return undefined;
    let left = width, top = height, right = -1, bottom = -1;
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            if (pixels[(y * width + x) * 4 + 3] > threshold) {
                left = Math.min(left, x); top = Math.min(top, y);
                right = Math.max(right, x); bottom = Math.max(bottom, y);
            }
        }
    }
    return right < 0 ? undefined : { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
}

/**
 * Crop rectangle for the timeline band. Full-screen visuals keep their original framing.
 * Coordinates are the capture page's, and the result is integral and inside the page.
 */
export function thumbnailCropRect(
    rect: ThumbnailContentRect | undefined,
    page: { width: number; height: number },
    options: { minCoverage?: number; pad?: number } = {}
): ThumbnailContentRect | undefined {
    if (!rect || ![rect.x, rect.y, rect.width, rect.height, page.width, page.height].every(Number.isFinite)
        || rect.width <= 0 || rect.height <= 0 || page.width <= 0 || page.height <= 0
        || rect.x < 0 || rect.y < 0 || rect.x + rect.width > page.width || rect.y + rect.height > page.height) return undefined;
    const { minCoverage = 0.6, pad = 0.04 } = options;
    if (rect.width * rect.height >= minCoverage * page.width * page.height) return undefined;
    const x = Math.max(0, Math.floor(rect.x - pad * rect.width));
    const y = Math.max(0, Math.floor(rect.y - pad * rect.height));
    const right = Math.min(page.width, Math.ceil(rect.x + rect.width + pad * rect.width));
    const bottom = Math.min(page.height, Math.ceil(rect.y + rect.height + pad * rect.height));
    const width = right - x, height = bottom - y;
    if (width < 1 || height < 1 || ![x, y, width, height].every(Number.isInteger)
        || (x === 0 && y === 0 && width === page.width && height === page.height)) return undefined;
    return { x, y, width, height };
}
