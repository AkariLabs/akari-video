export interface PhotoBrushGeometry {
    output: { width: number; height: number };
    image: { width: number; height: number };
    crop: { x: number; y: number; w: number; h: number };
    transform: { x?: number; y?: number; scale?: number; scaleX?: number; scaleY?: number; rotate?: number };
    flip?: { h?: boolean; v?: boolean };
}

/** Inverts the display transform, then the flip, and returns pre-crop source coordinates. */
export function photoBrushSourcePoint(stage: { x: number; y: number }, geometry: PhotoBrushGeometry): [number, number] | null {
    const { output, image, crop, transform, flip } = geometry;
    if (!(image.width > 0 && image.height > 0 && crop.w > 0 && crop.h > 0)) return null;
    const dx = stage.x - output.width / 2 - (transform.x ?? 0);
    const dy = stage.y - output.height / 2 - (transform.y ?? 0);
    const rad = -(transform.rotate ?? 0) * Math.PI / 180;
    const rx = dx * Math.cos(rad) - dy * Math.sin(rad);
    const ry = dx * Math.sin(rad) + dy * Math.cos(rad);
    const sx = transform.scaleX ?? transform.scale ?? 1;
    const sy = transform.scaleY ?? transform.scale ?? 1;
    if (!(sx > 0 && sy > 0)) return null;
    const x = rx / sx / image.width + crop.x + crop.w / 2;
    const y = ry / sy / image.height + crop.y + crop.h / 2;
    if (x < crop.x || x > crop.x + crop.w || y < crop.y || y > crop.y + crop.h) return null;
    return [flip?.h ? crop.x * 2 + crop.w - x : x,
        flip?.v ? crop.y * 2 + crop.h - y : y];
}
