/** Keep visible clips stationary; otherwise reveal the nearest useful part without changing zoom. */
export function nearestTimelineViewStart(viewStart: number, viewDuration: number, start: number, end: number, focus: number): number {
    if (!(viewDuration > 0) || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) return viewStart;
    const viewEnd = viewStart + viewDuration;
    if (end - start > viewDuration) {
        if (start < viewEnd && end > viewStart) return viewStart;
        return Math.max(0, Math.min(end - viewDuration, Math.max(start, focus - viewDuration / 2)));
    }
    if (start < viewStart) return Math.max(0, start);
    if (end > viewEnd) return Math.max(0, end - viewDuration);
    return viewStart;
}
