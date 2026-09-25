export interface PhotoCropRect { x: number; y: number; w: number; h: number; rotate?: number }

export function photoCropTransformPatch(
    before: Record<string, number | undefined>, after: Record<string, number | undefined>
): Record<string, number> {
    const patch: Record<string, number> = {};
    for (const key of ['x', 'y', 'scale', 'scaleX', 'scaleY', 'rotate']) {
        const identity = key.startsWith('scale') ? 1 : 0;
        if (after[key] !== undefined && (before[key] ?? identity) !== after[key]) patch[key] = after[key];
    }
    return patch;
}

/** Inverse-rotate the clip polygon so the displayed window stays axis aligned. */
export function photoCropClipPolygon(crop: PhotoCropRect, sourceWidth: number, sourceHeight: number): string {
    const cx = crop.x + crop.w / 2, cy = crop.y + crop.h / 2;
    const angle = (crop.rotate ?? 0) * Math.PI / 180, c = Math.cos(angle), s = Math.sin(angle);
    const corners: [number, number][] = [[-.5, -.5], [.5, -.5], [.5, .5], [-.5, .5]];
    const points = corners.map(([u, v]) => {
        const dx = u * crop.w * sourceWidth, dy = v * crop.h * sourceHeight;
        const x = cx + (c * dx + s * dy) / sourceWidth;
        const y = cy + (-s * dx + c * dy) / sourceHeight;
        return `${x * 100}% ${y * 100}%`;
    });
    return `polygon(${points.join(', ')})`;
}

/** Fit a source-pixel aspect ratio around the current crop centre, including rotation clearance. */
export function photoCropForRatio(
    crop: PhotoCropRect, sourceWidth: number, sourceHeight: number, aspect: number
): PhotoCropRect {
    const sw = Math.max(1, sourceWidth), sh = Math.max(1, sourceHeight);
    const angle = (crop.rotate ?? 0) * Math.PI / 180;
    const c = Math.abs(Math.cos(angle)), s = Math.abs(Math.sin(angle));
    const ratio = Number.isFinite(aspect) && aspect > 0 ? aspect : sw / sh;
    const area = Math.max(1, crop.w * sw * crop.h * sh);
    let h = Math.sqrt(area / ratio);
    h = Math.min(h, sw / (ratio * c + s), sh / (ratio * s + c));
    const w = h * ratio;
    const ex = (w * c + h * s) / 2, ey = (w * s + h * c) / 2;
    const cx = Math.min(sw - ex, Math.max(ex, (crop.x + crop.w / 2) * sw));
    const cy = Math.min(sh - ey, Math.max(ey, (crop.y + crop.h / 2) * sh));
    return { x: (cx - w / 2) / sw, y: (cy - h / 2) / sh, w: w / sw, h: h / sh,
        ...(crop.rotate ? { rotate: crop.rotate } : {}) };
}

/** A photo dragged right moves its fixed crop window left in source coordinates. */
export function photoCropAfterPan(
    crop: PhotoCropRect, dx: number, dy: number, sourceWidth = 1, sourceHeight = 1
): PhotoCropRect {
    const angle = (crop.rotate ?? 0) * Math.PI / 180, c = Math.cos(angle), s = Math.sin(angle);
    const sourceDx = c * dx + s * dy * sourceHeight / sourceWidth;
    const sourceDy = -s * dx * sourceWidth / sourceHeight + c * dy;
    const ex = (crop.w * Math.abs(c) + crop.h * sourceHeight / sourceWidth * Math.abs(s)) / 2;
    const ey = (crop.w * sourceWidth / sourceHeight * Math.abs(s) + crop.h * Math.abs(c)) / 2;
    const centerX = Math.min(1 - ex, Math.max(ex, crop.x + crop.w / 2 - sourceDx));
    const centerY = Math.min(1 - ey, Math.max(ey, crop.y + crop.h / 2 - sourceDy));
    return { ...crop,
        x: Math.min(1 - crop.w, Math.max(0, centerX - crop.w / 2)),
        y: Math.min(1 - crop.h, Math.max(0, centerY - crop.h / 2)) };
}

/** Keep the opposite edge fixed while a ratio-constrained handle moves. */
export function photoCropConstrainRatioAfterEdge(
    before: PhotoCropRect, moved: PhotoCropRect, dir: string,
    sourceWidth: number, sourceHeight: number, aspect: number
): PhotoCropRect {
    const slope = aspect * sourceHeight / sourceWidth;
    let w = moved.w, h = moved.h;
    if (dir.includes('e') || dir.includes('w')) h = w / slope;
    else w = h * slope;
    const maxW = dir.includes('w') ? before.x + before.w : 1 - before.x;
    const maxH = dir.includes('n') ? before.y + before.h : 1 - before.y;
    const factor = Math.min(1, maxW / w, maxH / h);
    w = Math.max(.001, w * factor);
    h = Math.max(.001, h * factor);
    const x = dir.includes('w') ? before.x + before.w - w : before.x;
    const y = dir.includes('n') ? before.y + before.h - h : before.y;
    return { ...moved, x: Math.max(0, x), y: Math.max(0, y), w, h };
}

/** Keep the selected aspect ratio, fit as much of the subject as possible, then place its centroid on a third. */
export function smartPhotoCrop(
    crop: PhotoCropRect, focus: { x: number; y: number; w: number; h: number; cx?: number; cy?: number },
    sourceWidth = 1, sourceHeight = 1
): PhotoCropRect {
    const x = focus.cx ?? focus.x + focus.w / 2;
    const y = focus.cy ?? focus.y + Math.min(focus.h / 3, 0.15);
    const thirdsX = x < 0.5 ? 1 / 3 : 2 / 3;
    const full = crop.w > .95 && crop.h > .95;
    const angle = (crop.rotate ?? 0) * Math.PI / 180;
    const c = Math.abs(Math.cos(angle)), s = Math.abs(Math.sin(angle));
    const ex = (crop.w * c + crop.h * sourceHeight / sourceWidth * s) / 2;
    const ey = (crop.w * sourceWidth / sourceHeight * s + crop.h * c) / 2;
    const maxScale = Math.min(1 / (2 * ex), 1 / (2 * ey));
    const requested = Math.max(full ? .75 : 1, focus.w * 1.05 / crop.w, focus.h * 1.05 / crop.h);
    const scale = Math.min(maxScale, requested);
    const w = crop.w * scale, h = crop.h * scale;
    const rotatedEx = ex * scale, rotatedEy = ey * scale;
    const minX = rotatedEx - w / 2, maxX = 1 - rotatedEx - w / 2;
    const minY = rotatedEy - h / 2, maxY = 1 - rotatedEy - h / 2;
    const clamp = (value: number, low: number, high: number): number =>
        low > high ? (low + high) / 2 : Math.min(high, Math.max(low, value));
    let left = clamp(x - w * thirdsX, minX, maxX);
    const rightOverflow = focus.x + focus.w - (left + w);
    const leftOverflow = left - focus.x;
    if (rightOverflow > 0 && rightOverflow >= leftOverflow) left = clamp(left + Math.min(rightOverflow, w * .049), minX, maxX);
    else if (leftOverflow > 0) left = clamp(left - Math.min(leftOverflow, w * .049), minX, maxX);
    let top = y - h / 3;
    if (focus.h <= h) top = clamp(top, focus.y + focus.h - h, focus.y);
    else top = focus.y + (focus.h - h) / 2;
    top = clamp(top, minY, maxY);
    return { ...crop, w, h,
        x: left, y: top };
}
