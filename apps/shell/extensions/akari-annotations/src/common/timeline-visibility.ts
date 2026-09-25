export const TIMELINE_HIDDEN_STORAGE_KEY = 'akari.timeline.hidden.v1';

export function isOutputPreviewWidgetId(id: unknown): boolean {
    return typeof id === 'string' && id.includes('akari-output-preview-');
}

export function storedTimelineHidden(value: unknown): boolean {
    return value === true;
}

export function shouldRevealTimeline(hidden: boolean): boolean {
    return !hidden;
}

export function shouldShowTimelineGhost(hidden: boolean, attached: boolean, visible: boolean): boolean {
    return !hidden && attached && visible;
}
