export const PREVIEW_RATE_PRESETS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3] as const;

export function clampPreviewPlaybackRate(value: unknown): number {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
        return 1;
    }
    return Math.max(0.5, Math.min(3, value));
}

export function formatPreviewRateLabel(value: unknown): string {
    return `${clampPreviewPlaybackRate(value)}×`;
}

export function effectiveMediaRate(segmentSpeed: unknown, previewRate: unknown): number {
    const normalizedSegmentSpeed = typeof segmentSpeed === 'number'
        && Number.isFinite(segmentSpeed) && segmentSpeed > 0 ? segmentSpeed : 1;
    const normalizedPreviewRate = typeof previewRate === 'number'
        && Number.isFinite(previewRate) && previewRate > 0 ? previewRate : 1;
    return normalizedSegmentSpeed * normalizedPreviewRate;
}

export function freezeHoldMs(holdSeconds: unknown, previewRate: unknown): number {
    const seconds = typeof holdSeconds === 'number'
        && Number.isFinite(holdSeconds) && holdSeconds > 0 ? holdSeconds : 0;
    return seconds * 1000 / clampPreviewPlaybackRate(previewRate);
}

export function wallClockOutputTime(
    originSeconds: unknown,
    originMs: unknown,
    nowMs: unknown,
    previewRate: unknown
): number {
    const origin = typeof originSeconds === 'number' && Number.isFinite(originSeconds)
        ? originSeconds : 0;
    const startedAt = typeof originMs === 'number' && Number.isFinite(originMs) ? originMs : 0;
    const current = typeof nowMs === 'number' && Number.isFinite(nowMs) ? nowMs : startedAt;
    return origin + (current - startedAt) / 1000 * clampPreviewPlaybackRate(previewRate);
}
