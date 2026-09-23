export interface CaptionRowRect {
    left: number;
    right: number;
    top: number;
    bottom: number;
}

/** The available line width, which can be narrower than the layout plate. */
export function captionRowWrapRect(
    plate: CaptionRowRect,
    maxWidth: string,
    cssPixelScale: number,
    alignItems: string,
    textAlign: string
): CaptionRowRect {
    const plateWidth = Math.max(0, plate.right - plate.left);
    const match = /^([\d.]+)(%|px)$/.exec(maxWidth.trim());
    let width = plateWidth;
    if (match) {
        const value = Number(match[1]);
        if (Number.isFinite(value)) {
            const measured = match[2] === '%' ? plateWidth * value / 100 : value * cssPixelScale;
            width = Math.min(plateWidth, Math.max(0, measured));
        }
    }
    const leftAligned = alignItems === 'flex-start' || alignItems === 'start'
        || (alignItems === 'stretch' && textAlign === 'left');
    const rightAligned = alignItems === 'flex-end' || alignItems === 'end'
        || (alignItems === 'stretch' && textAlign === 'right');
    const left = leftAligned ? plate.left : rightAligned ? plate.right - width
        : plate.left + (plateWidth - width) / 2;
    return { left, right: left + width, top: plate.top, bottom: plate.bottom };
}
