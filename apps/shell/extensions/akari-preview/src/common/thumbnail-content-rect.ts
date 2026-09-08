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
