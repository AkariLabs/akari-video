export interface PreviewContextMenuRect {
    left: number;
    top: number;
    width: number;
    height: number;
}

export interface PreviewContextMenuMessage {
    type: 'akari-preview-context-menu';
    x: number;
    y: number;
    timelineT: number;
    selectedPrimary?: string;
}

export function buildPreviewContextMenuMessage(
    clientX: number,
    clientY: number,
    rect: PreviewContextMenuRect,
    timelineT: number,
    selectedPrimary?: string
): PreviewContextMenuMessage {
    const normalize = (value: number, origin: number, size: number): number => {
        if (!Number.isFinite(value) || !Number.isFinite(origin) || !Number.isFinite(size) || size <= 0) {
            return 0;
        }
        return Math.max(0, Math.min(1, (value - origin) / size));
    };
    return {
        type: 'akari-preview-context-menu',
        x: normalize(clientX, rect.left, rect.width),
        y: normalize(clientY, rect.top, rect.height),
        timelineT: Number.isFinite(timelineT) ? Math.max(0, timelineT) : 0,
        ...(typeof selectedPrimary === 'string' && selectedPrimary
            ? { selectedPrimary }
            : {})
    };
}
