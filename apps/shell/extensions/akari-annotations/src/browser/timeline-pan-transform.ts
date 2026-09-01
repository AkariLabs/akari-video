export function layoutPercent(
    value: number, layoutViewStart: number, layoutViewDuration: number,
    minimum = -60, maximum = 160
): number {
    if (!(layoutViewDuration > 0)) return 0;
    return Math.min(maximum, Math.max(
        minimum,
        (value - layoutViewStart) / layoutViewDuration * 100
    ));
}

export function panTranslatePx(
    viewStart: number, layoutViewStart: number, layoutViewDuration: number, widthPx: number
): number {
    return layoutViewDuration > 0
        ? -(viewStart - layoutViewStart) / layoutViewDuration * widthPx
        : 0;
}

export function shouldReanchorPan(drift: number, duration: number, ratio: number): boolean {
    return duration > 0 && Math.abs(drift) > ratio * duration;
}
