export interface HoverPopupGeometryInput {
    naturalWidth?: number;
    naturalHeight?: number;
    width?: number;
    height?: number;
    bounds: { left: number; right: number; top: number; bottom: number };
    innerWidth: number;
    innerHeight: number;
    maxImageSize?: number;
    padding?: number;
    gap?: number;
    nameHeight?: number;
    borderWidth?: number;
}

export interface HoverPopupGeometry {
    imageWidth: number;
    imageHeight: number;
    left: number;
    top: number;
    placement: 'above' | 'below' | 'left' | 'right';
}

/** Fit the full image and its one-line name, then prefer above/below before the sides. */
export function hoverPopupGeometry(input: HoverPopupGeometryInput): HoverPopupGeometry {
    const { bounds, innerWidth, innerHeight, padding = 6, gap = 8, nameHeight = 16, borderWidth = 1 } = input;
    const positive = (value: number | undefined): boolean => Number.isFinite(value) && value > 0;
    const hasNaturalSize = positive(input.naturalWidth) && positive(input.naturalHeight);
    const hasOutputSize = positive(input.width) && positive(input.height);
    const width = hasNaturalSize ? input.naturalWidth : hasOutputSize ? input.width : 1920;
    const height = hasNaturalSize ? input.naturalHeight : hasOutputSize ? input.height : 1080;
    const frame = 2 * (padding + borderWidth);
    const limit = input.maxImageSize ?? Math.min(480, innerWidth * 0.4, innerHeight * 0.6);
    const scale = Math.max(0, Math.min(limit / Math.max(width, height),
        (innerWidth - frame) / width, (innerHeight - frame - nameHeight) / height));
    const imageWidth = width * scale;
    const imageHeight = height * scale;
    const popupWidth = imageWidth + frame;
    const popupHeight = imageHeight + frame + nameHeight;
    let placement: HoverPopupGeometry['placement'] = 'above';
    let left = bounds.left;
    let top = bounds.top - gap - popupHeight;
    if (top < 0) {
        placement = 'below';
        top = bounds.bottom + gap;
        if (top + popupHeight > innerHeight) {
            const leftSpace = bounds.left - gap;
            const rightSpace = innerWidth - bounds.right - gap;
            placement = leftSpace >= popupWidth || (rightSpace < popupWidth && leftSpace >= rightSpace) ? 'left' : 'right';
            left = placement === 'left' ? bounds.left - gap - popupWidth : bounds.right + gap;
            top = (bounds.top + bounds.bottom - popupHeight) / 2;
        }
    }
    return {
        imageWidth, imageHeight,
        left: Math.max(0, Math.min(left, innerWidth - popupWidth)),
        top: Math.max(0, Math.min(top, innerHeight - popupHeight)),
        placement
    };
}
