export interface VisualThumbnailCropStyle {
    objectPosition: string;
    scale: number;
    backgroundSize: string;
    backgroundPosition: string;
}

/** CSS focus percentages shared by the image and the repeated long-clip background. */
export function visualThumbnailCrop(
    rect: { x: number; y: number; width: number; height: number } | undefined,
    page: { width: number; height: number },
    options: { minCoverage?: number; pad?: number } = {}
): VisualThumbnailCropStyle | undefined {
    if (!rect || !page || ![rect.x, rect.y, rect.width, rect.height, page.width, page.height].every(Number.isFinite)
        || rect.width <= 0 || rect.height <= 0 || page.width <= 0 || page.height <= 0) return undefined;
    const { minCoverage = 0.6, pad = 0.04 } = options;
    if (rect.width * rect.height >= minCoverage * page.width * page.height) return undefined;
    const padX = pad * rect.width, padY = pad * rect.height;
    const x = Math.max(0, rect.x - padX), y = Math.max(0, rect.y - padY);
    const width = Math.min(page.width, rect.x + rect.width + padX) - x;
    const height = Math.min(page.height, rect.y + rect.height + padY) - y;
    if (width <= 0 || height <= 0) return undefined;
    const px = page.width - width > 0 ? 100 * x / (page.width - width) : 0;
    const py = page.height - height > 0 ? 100 * y / (page.height - height) : 0;
    const round = (value: number): number => Math.round(value * 100) / 100;
    const objectPosition = `${round(px)}% ${round(py)}%`;
    const scale = Math.max(page.width / width, page.height / height);
    // Rounding focus can move either edge inward. Round scale upward far enough
    // to preserve coverage at the actual CSS percentages, including narrow strips.
    const coverageScale = (start: number, extent: number, size: number, focus: number): number => Math.max(
        focus > 0 ? focus * size / (focus * size - start) : 0,
        focus < 1 ? (1 - focus) * size / (start + extent - focus * size) : 0
    );
    const roundedScale = Math.ceil(Math.max(scale,
        coverageScale(x, width, page.width, round(px) / 100),
        coverageScale(y, height, page.height, round(py) / 100)) * 1000) / 1000;
    return {
        objectPosition,
        scale: roundedScale,
        backgroundSize: `auto ${100 * page.height / height}%`,
        backgroundPosition: objectPosition
    };
}
