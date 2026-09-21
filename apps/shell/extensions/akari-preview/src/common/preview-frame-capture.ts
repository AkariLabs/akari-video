import type { PreviewFrameExpectations, PreviewFrameInspection } from './preview-frame-check';

/** Coordinates are CSS pixels, relative to the main renderer viewport. */
export interface PreviewFrameRect { x: number; y: number; width: number; height: number }
export interface PreviewFrameCaptureRequest {
    rect: PreviewFrameRect;
    sentinel?: PreviewFrameRect;
    output: { width: number; height: number };
    expectations: PreviewFrameExpectations;
}
export interface PreviewFrameCaptureResult {
    image: string;
    inspection: PreviewFrameInspection;
    width: number;
    height: number;
    capturedWidth: number;
    capturedHeight: number;
    reduced: boolean;
}
export interface SavePreviewFrameRequest { editUri: string; time: number; image: string }
export interface PreviewFrameRequestMessage { type: 'akari-preview-capture-frame'; requestId: string; pageId: string }
export interface PreviewFrameCommand {
    type: 'akari-preview-capture-prepare' | 'akari-preview-capture-restore'; requestId: string; pageId: string;
    keepFrozen?: boolean; success?: boolean;
}
export interface PreviewFrameReadyMessage {
    type: 'akari-preview-capture-ready'; requestId: string; pageId: string;
    expectations?: PreviewFrameExpectations;
    sentinel?: PreviewFrameRect;
    time?: number; rect?: PreviewFrameRect; viewport?: { width: number; height: number }; error?: string;
}
export interface PreviewFrameRestoredMessage {
    type: 'akari-preview-capture-restored'; requestId: string; pageId: string;
}

export function previewFrameFilename(time: number, ordinal = 1): string {
    if (!Number.isFinite(time) || time < 0 || !Number.isSafeInteger(Math.round(time * 1000))) throw new Error('Invalid frame time');
    if (!Number.isSafeInteger(ordinal) || ordinal < 1) throw new Error('Invalid frame ordinal');
    const ms = Math.round(time * 1000);
    return `frame-${String(Math.floor(ms / 60000)).padStart(2, '0')}m${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}s${String(ms % 1000).padStart(3, '0')}${ordinal === 1 ? '' : `-${ordinal}`}.png`;
}

/** Round inward: never include an editor pixel just outside the stage. */
export function previewFrameCaptureRect(rect: PreviewFrameRect): PreviewFrameRect {
    if (!rect || ![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite)
        || rect.x < 0 || rect.y < 0 || rect.width < 1 || rect.height < 1) throw new Error('Invalid capture rectangle');
    const x = Math.ceil(rect.x), y = Math.ceil(rect.y);
    const width = Math.floor(rect.x + rect.width) - x, height = Math.floor(rect.y + rect.height) - y;
    if (width < 1 || height < 1) throw new Error('Capture rectangle is too small');
    return { x, y, width, height };
}

/** One DIP capture region for the stage and the optional transport sentinel. */
export function previewFrameCaptureGeometry(rect: PreviewFrameRect, sentinel: PreviewFrameRect | undefined,
    zoom: number, bounds: { width: number; height: number }): {
        region: PreviewFrameRect; stage: PreviewFrameRect; sentinel?: PreviewFrameRect; fallback?: string;
    } {
    const toDip = (value: PreviewFrameRect): PreviewFrameRect => {
        const rounded = previewFrameCaptureRect(value);
        return previewFrameCaptureRect({ x: rounded.x * zoom, y: rounded.y * zoom,
            width: rounded.width * zoom, height: rounded.height * zoom });
    };
    const inside = (value: PreviewFrameRect): boolean => value.x + value.width <= bounds.width && value.y + value.height <= bounds.height;
    const stage = toDip(rect);
    if (!inside(stage)) throw new Error('Preview stage is clipped by the window');
    try {
        if (!sentinel) throw new Error('Play button sentinel is unavailable');
        const button = toDip(sentinel);
        const x = Math.min(stage.x, button.x), y = Math.min(stage.y, button.y);
        const region = { x, y, width: Math.max(stage.x + stage.width, button.x + button.width) - x,
            height: Math.max(stage.y + stage.height, button.y + button.height) - y };
        if (!inside(region)) throw new Error('Play button sentinel is clipped by the window');
        return { region, stage, sentinel: button };
    } catch (error) {
        return { region: stage, stage, fallback: String(error) };
    }
}

/** Convert DIP subregions into inward-rounded pixels of the scale-1 union bitmap. */
export function previewFramePixelRect(rect: PreviewFrameRect, region: PreviewFrameRect,
    width: number, height: number): PreviewFrameRect {
    return previewFrameCaptureRect({ x: (rect.x - region.x) * width / region.width,
        y: (rect.y - region.y) * height / region.height,
        width: rect.width * width / region.width, height: rect.height * height / region.height });
}
