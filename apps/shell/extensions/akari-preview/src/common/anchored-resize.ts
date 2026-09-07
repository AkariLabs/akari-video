export interface ResizeTransform { x: number; y: number; scale: number; rotate: number }

/** Uniform resize with the opposite visible corner fixed, including crop and rotation. */
export function computeAnchoredResize(
    original: ResizeTransform, width: number, height: number, corner: string, scale: number,
    crop = { x: 0, y: 0, w: 1, h: 1 }
): { transform: ResizeTransform; anchor: { x: number; y: number }; dragged: { x: number; y: number }; bounds: { left: number; right: number; top: number; bottom: number; centerX: number; centerY: number } } {
    const east = corner.includes('e'), south = corner.includes('s');
    const ax = width * (crop.x + (east ? 0 : crop.w) - .5);
    const ay = height * (crop.y + (south ? 0 : crop.h) - .5);
    const dx = width * (crop.x + (east ? crop.w : 0) - .5);
    const dy = height * (crop.y + (south ? crop.h : 0) - .5);
    const radians = original.rotate * Math.PI / 180;
    const rotate = (x: number, y: number): { x: number; y: number } => ({
        x: x * Math.cos(radians) - y * Math.sin(radians), y: x * Math.sin(radians) + y * Math.cos(radians)
    });
    const oldOffset = rotate(ax * original.scale, ay * original.scale);
    const anchor = { x: original.x + oldOffset.x, y: original.y + oldOffset.y };
    const offset = rotate(ax * scale, ay * scale);
    const transform = { ...original, x: anchor.x - offset.x, y: anchor.y - offset.y, scale };
    const dragOffset = rotate(dx * scale, dy * scale);
    const points = [[ax, ay], [ax, dy], [dx, ay], [dx, dy]].map(([x, y]) => rotate(x * scale, y * scale));
    const left = transform.x + Math.min(...points.map(p => p.x)), right = transform.x + Math.max(...points.map(p => p.x));
    const top = transform.y + Math.min(...points.map(p => p.y)), bottom = transform.y + Math.max(...points.map(p => p.y));
    return { transform, anchor, dragged: { x: transform.x + dragOffset.x, y: transform.y + dragOffset.y },
        bounds: { left, right, top, bottom, centerX: (left + right) / 2, centerY: (top + bottom) / 2 } };
}
