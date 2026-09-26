export interface PreviewChromeRect { left: number; top: number; width: number; height: number }

/** Refresh selection controls only when the transformed stage or its viewport moves. */
export function refreshPreviewChromeOnGeometryChange(
    previous: string | null, stage: PreviewChromeRect, viewport: PreviewChromeRect,
    refresh: { layer: () => void; cut: () => void; crop: () => void; caption: () => void }
): string {
    const signature = [stage.left, stage.top, stage.width, stage.height,
        viewport.left, viewport.top, viewport.width, viewport.height]
        .map(value => Number.isFinite(value) ? value.toFixed(2) : 'invalid').join('|');
    if (signature !== previous) {
        refresh.layer();
        refresh.cut();
        refresh.crop();
        refresh.caption();
    }
    return signature;
}

export function previewChromeRectClear(
    viewport: PreviewChromeRect, rect: PreviewChromeRect,
    avoid: readonly PreviewChromeRect[] = []
): boolean {
    const inset = 4;
    return rect.left >= viewport.left + inset && rect.top >= viewport.top + inset
        && rect.left + rect.width <= viewport.left + viewport.width - inset
        && rect.top + rect.height <= viewport.top + viewport.height - inset
        && avoid.every(other => rect.left >= other.left + other.width
            || rect.left + rect.width <= other.left || rect.top >= other.top + other.height
            || rect.top + rect.height <= other.top);
}

/** Keep a floating control in the visible preview pane, including at zoomed edges. */
export function previewChromeMenuOffset(
    viewport: PreviewChromeRect, anchor: PreviewChromeRect, menu: PreviewChromeRect, gap = 6
): { x: number; y: number } {
    const inset = 4;
    const clamp = (value: number, start: number, end: number): number =>
        Math.max(start, Math.min(value, Math.max(start, end)));
    let top = menu.top;
    if (top < viewport.top + inset) top = anchor.top + anchor.height + gap;
    if (top + menu.height > viewport.top + viewport.height - inset) {
        top = anchor.top - menu.height - gap;
    }
    return {
        x: clamp(menu.left, viewport.left + inset,
            viewport.left + viewport.width - menu.width - inset) - menu.left,
        y: clamp(top, viewport.top + inset,
            viewport.top + viewport.height - menu.height - inset) - menu.top
    };
}

/** Place a toolbar outside the selected frame and its action buttons. */
export function placePreviewChromeToolbar(
    viewport: PreviewChromeRect, anchor: PreviewChromeRect,
    size: { width: number; height: number }, avoid: readonly PreviewChromeRect[] = []
): PreviewChromeRect {
    const inset = 4;
    const gap = 10;
    const clamp = (value: number, min: number, max: number): number =>
        Math.max(min, Math.min(value, Math.max(min, max)));
    const left = clamp(anchor.left + (anchor.width - size.width) / 2,
        viewport.left + inset, viewport.left + viewport.width - size.width - inset);
    const top = clamp(anchor.top + (anchor.height - size.height) / 2,
        viewport.top + inset, viewport.top + viewport.height - size.height - inset);
    const candidates = [
        { left, top: anchor.top - size.height - gap },
        { left, top: anchor.top + anchor.height + gap },
        { left: anchor.left + anchor.width + gap, top },
        { left: anchor.left - size.width - gap, top }
    ];
    const expanded = { left: anchor.left - 6, top: anchor.top - 6,
        width: anchor.width + 12, height: anchor.height + 12 };
    const valid = (rect: PreviewChromeRect): boolean => {
        const clearOf = (other: PreviewChromeRect): boolean =>
            rect.left >= other.left + other.width || rect.left + rect.width <= other.left
            || rect.top >= other.top + other.height || rect.top + rect.height <= other.top;
        return rect.left >= viewport.left + inset && rect.top >= viewport.top + inset
            && rect.left + rect.width <= viewport.left + viewport.width - inset
            && rect.top + rect.height <= viewport.top + viewport.height - inset
            && [expanded, ...avoid].every(clearOf);
    };
    for (const candidate of candidates) {
        const rect = { ...candidate, width: size.width, height: size.height };
        if (valid(rect)) return rect;
    }
    // A selection may extend beyond every side of the viewport. Prefer the least obstructed edge.
    const edges = [
        { left: viewport.left + inset, top: viewport.top + inset },
        { left: viewport.left + viewport.width - size.width - inset, top: viewport.top + inset },
        { left: viewport.left + inset, top: viewport.top + viewport.height - size.height - inset },
        { left: viewport.left + viewport.width - size.width - inset,
            top: viewport.top + viewport.height - size.height - inset }
    ].map(candidate => ({ ...candidate, width: size.width, height: size.height }));
    const overlapArea = (a: PreviewChromeRect, b: PreviewChromeRect): number =>
        Math.max(0, Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left))
        * Math.max(0, Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top));
    return edges.sort((a, b) =>
        [expanded, ...avoid].reduce((sum, other) => sum + overlapArea(a, other), 0)
        - [expanded, ...avoid].reduce((sum, other) => sum + overlapArea(b, other), 0))[0];
}

/** Convert a viewport point into an unscaled, rotated selection frame. */
export function previewChromeLocalPoint(
    frame: PreviewChromeRect, localSize: { width: number; height: number },
    rotate: number, scale: number, point: { x: number; y: number }
): { x: number; y: number } {
    const angle = rotate * Math.PI / 180;
    const dx = (point.x - frame.left - frame.width / 2) / scale;
    const dy = (point.y - frame.top - frame.height / 2) / scale;
    return {
        x: localSize.width / 2 + dx * Math.cos(angle) + dy * Math.sin(angle),
        y: localSize.height / 2 - dx * Math.sin(angle) + dy * Math.cos(angle)
    };
}
