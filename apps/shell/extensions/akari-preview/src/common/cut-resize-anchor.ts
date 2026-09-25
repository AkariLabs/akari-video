export interface CutResizeBox {
    centerX: number;
    centerY: number;
    width: number;
    height: number;
    rotate: number;
}

export interface CutResizePoint { x: number; y: number }

export function cutResizeCorners(box: CutResizeBox, corner: 'nw' | 'ne' | 'se' | 'sw'):
    { anchor: CutResizePoint; dragged: CutResizePoint } {
    const sx = corner.endsWith('w') ? -1 : 1;
    const sy = corner.startsWith('n') ? -1 : 1;
    const radians = box.rotate * Math.PI / 180;
    const c = Math.cos(radians), s = Math.sin(radians);
    const at = (x: number, y: number): CutResizePoint => ({
        x: box.centerX + c * x - s * y,
        y: box.centerY + s * x + c * y
    });
    return { anchor: at(-sx * box.width / 2, -sy * box.height / 2),
        dragged: at(sx * box.width / 2, sy * box.height / 2) };
}

export function cutResizeScale(
    startScale: number, anchor: CutResizePoint, dragged: CutResizePoint,
    startPointer: CutResizePoint, pointer: CutResizePoint
): number {
    const dx = dragged.x - anchor.x, dy = dragged.y - anchor.y;
    const px = pointer.x + dragged.x - startPointer.x - anchor.x;
    const py = pointer.y + dragged.y - startPointer.y - anchor.y;
    const ratio = (px * dx + py * dy) / (dx * dx + dy * dy);
    return Math.max(0.01, startScale * (Number.isFinite(ratio) ? ratio : 1));
}
