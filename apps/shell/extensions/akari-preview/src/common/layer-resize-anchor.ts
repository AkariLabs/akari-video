export type LayerResizeCorner = 'nw' | 'ne' | 'se' | 'sw';

/** Returns an actual rotated box corner in client coordinates, excluding resize-handle chrome. */
export function layerResizeCornerPoint(
    centerX: number,
    centerY: number,
    width: number,
    height: number,
    rotateDegrees: number,
    corner: LayerResizeCorner
): { x: number; y: number } {
    const localX = corner.includes('w') ? -width / 2 : width / 2;
    const localY = corner.includes('n') ? -height / 2 : height / 2;
    const radians = rotateDegrees * Math.PI / 180;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    return {
        x: centerX + localX * cos - localY * sin,
        y: centerY + localX * sin + localY * cos
    };
}
