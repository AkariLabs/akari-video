export interface TimelineViewRange { start: number; duration: number }

export function fitDuration(contentEnd: number): number {
    return contentEnd > 0 ? contentEnd * 1.05 : 1;
}

export function maximumViewDuration(contentEnd: number): number {
    return fitDuration(contentEnd) * 10;
}

export function minimumViewDuration(contentEnd: number, fps: number, minFrames: number): number {
    return Math.min(fitDuration(contentEnd), Math.max(minFrames / fps, 0));
}

export function clampViewRange(
    start: number, duration: number, contentEnd: number, fps: number, minFrames: number
): TimelineViewRange {
    const max = maximumViewDuration(contentEnd);
    if (max <= 0) return { start: 0, duration: 0 };
    const width = Math.min(max, Math.max(minimumViewDuration(contentEnd, fps, minFrames), duration));
    return { start: Math.min(Math.max(0, start), Math.max(0, max - width)), duration: width };
}

export function zoomPercent(contentEnd: number, duration: number): number {
    return duration > 0 ? fitDuration(contentEnd) / duration * 100 : 100;
}

export function snapFitDuration(contentEnd: number, duration: number): number {
    const fit = fitDuration(contentEnd);
    return fit > 0 && Math.abs(zoomPercent(contentEnd, duration) - 100) <= 6 ? fit : duration;
}

export function zoomBarExtent(contentEnd: number, start: number, duration: number): number {
    return Math.max(fitDuration(contentEnd), start + duration);
}

export function dragViewRange(
    original: TimelineViewRange, mode: 'start' | 'end' | 'thumb', delta: number,
    contentEnd: number, fps: number, minFrames: number
): TimelineViewRange {
    const end = original.start + original.duration;
    if (mode === 'thumb') return clampViewRange(original.start + delta, original.duration, contentEnd, fps, minFrames);
    if (mode === 'start') {
        const duration = Math.min(end, Math.max(minimumViewDuration(contentEnd, fps, minFrames),
            original.duration - delta));
        return { start: end - duration, duration };
    }
    const duration = Math.min(maximumViewDuration(contentEnd) - original.start,
        Math.max(minimumViewDuration(contentEnd, fps, minFrames), original.duration + delta));
    return { start: original.start, duration };
}

export function edgeAutoScrollDelta(pointer: number, left: number, right: number, duration: number): number {
    const edge = 48;
    if (right <= left || duration <= 0) return 0;
    const leftDepth = Math.min(1, Math.max(0, (left + edge - pointer) / edge));
    const rightDepth = Math.min(1, Math.max(0, (pointer - right + edge) / edge));
    return (rightDepth * rightDepth - leftDepth * leftDepth) * duration * 0.012;
}

export function clampTrackScale(value: number): number {
    return Math.max(0.6, Math.min(3, value));
}

export function trackScaleFromHandle(
    origin: number, delta: number, viewportHeight: number, edge: 'start' | 'end'
): number {
    const direction = edge === 'end' ? -1 : 1;
    return clampTrackScale(origin * Math.exp(direction * delta / Math.max(viewportHeight, 1) * 2));
}
