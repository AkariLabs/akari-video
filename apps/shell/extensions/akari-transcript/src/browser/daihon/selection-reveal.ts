/** Returns the scroll position needed to center a row outside the inspector, or null when fully visible. */
export function selectionScrollTop(
    rowTop: number, rowBottom: number, viewportTop: number, viewportBottom: number, scrollTop: number
): number | null {
    if (viewportBottom <= viewportTop) return null;
    if (rowTop >= viewportTop + 6 && rowBottom <= viewportBottom - 6) return null;
    return scrollTop + (rowTop + rowBottom - viewportTop - viewportBottom) / 2;
}
