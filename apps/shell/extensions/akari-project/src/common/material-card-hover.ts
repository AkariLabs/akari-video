/** Midpoints of equal duration slices; odd counts include the poster's exact midpoint. */
export function hoverFrameTimes(duration: number, count = 5): number[] {
    if (!Number.isFinite(duration) || duration <= 0 || !Number.isInteger(count) || count < 1 || count > 100) return [];
    return Array.from({ length: count }, (_, index) => duration * ((index + 0.5) / count));
}

export function hoverPopupPosition(
    cardRect: { left: number; right: number; top: number }, viewport: { width: number; height: number },
    size: { width: number; height: number }
): { left: number; top: number } {
    const gap = 8;
    const left = cardRect.right + gap + size.width <= viewport.width - gap
        ? cardRect.right + gap : cardRect.left - size.width - gap;
    return {
        left: Math.max(gap, Math.min(left, viewport.width - size.width - gap)),
        top: Math.max(gap, Math.min(cardRect.top, viewport.height - size.height - gap))
    };
}
