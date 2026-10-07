export interface CssRect { x: number; y: number; width: number; height: number }
export function cssRectToViewBounds(rect: CssRect, zoomFactor: number): CssRect {
    const zoom = Number.isFinite(zoomFactor) && zoomFactor > 0 && zoomFactor < 100 ? zoomFactor : 1;
    const scale = (value: number): number => Number.isFinite(value) ? Math.max(0, Math.floor(value * zoom)) : 0;
    return { x: scale(rect.x), y: scale(rect.y), width: scale(rect.width), height: scale(rect.height) };
}
