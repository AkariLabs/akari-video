export interface PreviewActionRect { left: number; top: number; width: number; height: number }

export interface PreviewLayerActionPlacement {
    placement: 'below' | 'inside-bottom' | 'inside-top' | 'side-right' | 'side-left' | 'above';
    top: number;
    offsetX: number;
    rotate: PreviewActionRect;
    move: PreviewActionRect;
}

/** Keep both 25px controls inside the stage and clear of the host's floating menu. */
export function placePreviewLayerActions(
    stage: PreviewActionRect, selection: PreviewActionRect, menu: PreviewActionRect | null, scale = 1
): PreviewLayerActionPlacement | null {
    const radius = 12.5 * scale;
    const pairOffset = 14 * scale;
    const halfPair = pairOffset + radius;
    const right = (rect: PreviewActionRect): number => rect.left + rect.width;
    const bottom = (rect: PreviewActionRect): number => rect.top + rect.height;
    const overlaps = (a: PreviewActionRect, b: PreviewActionRect): boolean =>
        a.left < right(b) && right(a) > b.left && a.top < bottom(b) && bottom(a) > b.top;
    const centerX = selection.left + selection.width / 2;
    const centerY = selection.top + selection.height / 2;
    const safeX = Math.max(stage.left + halfPair + 2,
        Math.min(centerX, right(stage) - halfPair - 2));
    const safeY = Math.max(stage.top + radius + 2,
        Math.min(centerY, bottom(stage) - radius - 2));
    const sideRight = Math.max(right(selection), menu ? right(menu) : right(selection)) + halfPair + 4;
    const sideLeft = Math.min(selection.left, menu ? menu.left : selection.left) - halfPair - 4;
    const candidates: Array<{ placement: PreviewLayerActionPlacement['placement']; x: number; y: number }> = [
        { placement: 'below', x: safeX, y: bottom(selection) + 25 * scale },
        { placement: 'inside-bottom', x: safeX, y: bottom(selection) - radius },
        { placement: 'inside-top', x: safeX, y: selection.top + radius },
        { placement: 'side-right', x: sideRight, y: safeY },
        { placement: 'side-left', x: sideLeft, y: safeY },
        { placement: 'above', x: safeX, y: selection.top - 25 * scale }
    ];
    for (const candidate of candidates) {
        const rotate = { left: candidate.x - pairOffset - radius, top: candidate.y - radius,
            width: radius * 2, height: radius * 2 };
        const move = { left: candidate.x + pairOffset - radius, top: candidate.y - radius,
            width: radius * 2, height: radius * 2 };
        const fits = (button: PreviewActionRect): boolean => button.left >= stage.left + 2
            && button.top >= stage.top + 2 && right(button) <= right(stage) - 2
            && bottom(button) <= bottom(stage) - 2
            && (!menu || !overlaps(button, menu));
        if (fits(rotate) && fits(move)) return {
            placement: candidate.placement,
            top: candidate.y - selection.top,
            offsetX: candidate.x - centerX,
            rotate, move
        };
    }
    return null;
}
