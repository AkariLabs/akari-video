import { t } from '@akari-video/i18n';
export type ChatAttachment =
    | { kind: 'file'; path: string; label: string }
    | { kind: 'review'; label: string; review: ChatReviewMark };

export interface ChatReviewMark {
    id?: string;
    tool: 'pen' | 'pin' | 'range';
    source: string;
    sourceLabel: string;
    time: number;
    timeEnd?: number;
    sourceT?: number;
    sourceRange?: [number, number];
    cutIndex?: number | null;
    src?: string;
    points?: [number, number][];
    annotationId?: string;
    packet?: string;
    shape?: { x: number; y: number; w?: number; h?: number };
    elements?: string[];
    text: string;
    thumbnail?: string;
}

export const REVIEW_PENDING_PATH = '.akari/review/pending.json';

export class ReviewAnnotationFailureGate {
    private readonly failedRequests = new Map<string, string>();

    shouldAttempt(key: string, request: string, retry = false): boolean {
        return retry || this.failedRequests.get(key) !== request;
    }

    recordFailure(key: string, request: string): boolean {
        const firstForRequest = this.failedRequests.get(key) !== request;
        this.failedRequests.set(key, request);
        return firstForRequest;
    }

    clear(key: string): void {
        this.failedRequests.delete(key);
    }
}

export function reviewAnnotationRequest(projectRootUri: string, mark: ChatReviewMark): {
    projectRootUri: string; src?: string; sourceT: number; sourceRange?: [number, number]; point?: [number, number];
    strokes?: { tool: 'pen'; space: 'content-rect'; frame: { sourceT: number; cutIndex: number | null }; points: [number, number][] }[];
    text: string;
} {
    const sourceT = mark.sourceT ?? mark.time;
    return {
        projectRootUri,
        ...(mark.src ? { src: mark.src } : {}),
        sourceT,
        ...(mark.tool === 'range' && mark.sourceRange ? { sourceRange: mark.sourceRange } : {}),
        ...(mark.tool === 'pin' && mark.shape && Number.isFinite(mark.shape.x) && Number.isFinite(mark.shape.y)
            ? { point: [Math.max(0, Math.min(1, mark.shape.x)), Math.max(0, Math.min(1, mark.shape.y))] as [number, number] } : {}),
        ...(mark.tool === 'pen' && mark.points?.length ? { strokes: [{ tool: 'pen', space: 'content-rect',
            frame: { sourceT, cutIndex: mark.cutIndex ?? null }, points: mark.points }] } : {}),
        text: mark.text
    };
}

export function normalizeReviewPoint(clientX: number, clientY: number,
    rect: { left: number; top: number; width: number; height: number }): { x: number; y: number } {
    const clamp = (value: number): number => Math.max(0, Math.min(1, value));
    return { x: clamp((clientX - rect.left) / rect.width), y: clamp((clientY - rect.top) / rect.height) };
}

export function reviewBoxFromPoints(points: readonly { x: number; y: number }[]): ChatReviewMark['shape'] {
    if (!points.length) return undefined;
    const xs = points.map(point => point.x);
    const ys = points.map(point => point.y);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

export interface ReviewCaptionLine {
    text: string;
    rect: { left: number; top: number; right: number; bottom: number };
}

export type ReviewCaptionHit =
    | { kind: 'point'; x: number; y: number }
    | { kind: 'rect'; left: number; top: number; right: number; bottom: number };

export interface ReviewAttachmentUiText {
    caption: string;
    videoSourcePath: string;
    image: string;
    video: string;
}

export function reviewAttachmentUiText(): ReviewAttachmentUiText {
    return {
        caption: t('preview.chatReviewAttachments.ui.captionLabel'),
        videoSourcePath: t('preview.chatReviewAttachments.ui.videoSourcePathLabel'),
        image: t('preview.chatReviewAttachments.ui.imageLabel'),
        video: t('preview.chatReviewAttachments.ui.videoLabel')
    };
}

export function reviewCaptionLabelsAt(lines: readonly ReviewCaptionLine[], hit: ReviewCaptionHit,
    uiText: ReviewAttachmentUiText = reviewAttachmentUiText()): string[] {
    const labels: string[] = [];
    for (const line of lines) {
        const rect = line.rect;
        if (![rect.left, rect.top, rect.right, rect.bottom].every(Number.isFinite)
            || rect.right <= rect.left || rect.bottom <= rect.top) continue;
        const overlaps = hit.kind === 'point'
            ? hit.x >= rect.left && hit.x <= rect.right && hit.y >= rect.top && hit.y <= rect.bottom
            : hit.left < rect.right && hit.right > rect.left && hit.top < rect.bottom && hit.bottom > rect.top;
        if (!overlaps) continue;
        const value = line.text.replace(/\s+/gu, ' ').trim().slice(0, 80);
        if (!value) continue;
        const label = uiText.caption.split('{caption}').join(value);
        if (!labels.includes(label)) labels.push(label);
    }
    return labels;
}

export function reviewElementsAt(edit: any, time: number, point: { x: number; y: number },
    uiText: ReviewAttachmentUiText = reviewAttachmentUiText()): string[] {
    const result: string[] = [];
    const add = (value: string): void => { if (!result.includes(value)) result.push(value); };
    const active = (item: any): boolean => {
        const start = Number(item?.at ?? item?.t ?? item?.start ?? 0);
        const endDuration = Number(item?.end) - Number(item?.start);
        const duration = Number(item?.duration ?? (Number.isFinite(endDuration)
            ? endDuration : Number(item?.out) - Number(item?.in)));
        return Number.isFinite(start) && Number.isFinite(duration) && time >= start && time < start + duration;
    };
    const hits = (item: any): boolean => {
        const box = item?.box ?? item?.rect ?? item?.bounds;
        if (!box) return true;
        const x = Number(box.x); const y = Number(box.y);
        const w = Number(box.w ?? box.width); const h = Number(box.h ?? box.height);
        return [x, y, w, h].every(Number.isFinite) && point.x >= x && point.x <= x + w
            && point.y >= y && point.y <= y + h;
    };
    const captions = [ ...(Array.isArray(edit?.captions) ? edit.captions : []),
        ...(Array.isArray(edit?.text) ? edit.text : []) ];
    for (const caption of captions) {
        if (active(caption) && (caption.box || caption.rect || caption.bounds) && hits(caption)) {
            const value = caption.text ?? caption.plainText ?? caption.label;
            if (typeof value === 'string' && value.trim()) add(uiText.caption.split('{caption}').join(value.trim()));
        }
    }
    for (const cut of Array.isArray(edit?.cuts) ? edit.cuts : []) {
        if (active(cut) && hits(cut)) add(uiText.videoSourcePath.split('{sourcePath}').join(String(cut.sourcePath ?? cut.src ?? cut.id ?? '').trim()));
    }
    for (const layer of Array.isArray(edit?.layers) ? edit.layers : []) {
        if (active(layer) && hits(layer)) add(`${layer.isImage ? uiText.image : uiText.video} ${String(layer.sourcePath ?? layer.src ?? layer.id ?? '').trim()}`);
    }
    if (edit?.version === 2 && Array.isArray(edit?.tracks)) {
        const fps = Number(edit.output?.fps) || 30;
        const sources = new Map((Array.isArray(edit.sources) ? edit.sources : []).map((source: any) => [source.id, source.path]));
        for (const track of edit.tracks) {
            for (const item of Array.isArray(track?.items) ? track.items : []) {
                if (item?.source?.kind !== 'media' || !hits(item)) continue;
                if (time < Number(item.at) / fps || time >= (Number(item.at) + Number(item.duration)) / fps) continue;
                const path = String(sources.get(item.source.src) ?? item.source.src ?? item.id);
                add(`${/\.(png|jpe?g|webp|gif)$/i.test(path) ? uiText.image : uiText.video} ${path}`);
            }
        }
    }
    return result;
}

export function parseReviewPending(text: string | undefined): ChatAttachment[] {
    if (!text) return [];
    try {
        const data = JSON.parse(text);
        const entries = Array.isArray(data?.attachments) ? data.attachments : [];
        return entries.filter((item: any) => item?.kind === 'review' && typeof item.label === 'string'
            && ['pen', 'pin', 'range'].includes(item.review?.tool)
            && typeof item.review?.source === 'string' && Number.isFinite(item.review?.time)
            && typeof item.review?.text === 'string');
    } catch { return []; }
}

export function serializeReviewPending(attachments: readonly ChatAttachment[]): string {
    return JSON.stringify({ attachments }, null, 2) + '\n';
}

export function reviewEscapeStep(state: { noteOpen: boolean; trayOpen: boolean; tool: string | null;
    isComposing?: boolean; keyCode?: number }): 'note' | 'tray' | 'tool' | undefined {
    if (state.isComposing || state.keyCode === 229) return undefined;
    if (state.noteOpen) return 'note';
    if (state.trayOpen) return 'tray';
    if (state.tool) return 'tool';
    return undefined;
}

export function reviewMemoEnterAction(event: { key: string; shiftKey: boolean; isComposing: boolean; keyCode: number }): 'save' | 'newline' | 'ignore' {
    if (event.key !== 'Enter' || event.isComposing || event.keyCode === 229) return 'ignore';
    return event.shiftKey ? 'newline' : 'save';
}

export function updateReviewPending(attachments: ChatAttachment[], index: number, review: ChatReviewMark): ChatAttachment[] {
    if (!Number.isInteger(index) || index < 0 || index >= attachments.length || attachments[index].kind !== 'review'
        || !review || !['pen', 'pin', 'range'].includes(review.tool)
        || typeof review.source !== 'string' || typeof review.sourceLabel !== 'string'
        || !Number.isFinite(review.time) || typeof review.text !== 'string'
        || (review.id !== undefined && (typeof review.id !== 'string' || !review.id))
        || (review.timeEnd !== undefined && !Number.isFinite(review.timeEnd))
        || (review.elements !== undefined && (!Array.isArray(review.elements) || !review.elements.every(value => typeof value === 'string')))
        || (review.thumbnail !== undefined && typeof review.thumbnail !== 'string')
        || (review.shape !== undefined && (!review.shape || !Number.isFinite(review.shape.x)
            || !Number.isFinite(review.shape.y) || review.shape.x < 0 || review.shape.x > 1
            || review.shape.y < 0 || review.shape.y > 1
            || (review.shape.w !== undefined && (!Number.isFinite(review.shape.w) || review.shape.w < 0 || review.shape.w > 1))
            || (review.shape.h !== undefined && (!Number.isFinite(review.shape.h) || review.shape.h < 0 || review.shape.h > 1))))) return attachments;
    return attachments.map((item, position) => position === index ? { ...item, review } : item);
}

export function reviewAttachArgument(attachments: readonly ChatAttachment[]): { attachments: ChatAttachment[] } {
    return { attachments: attachments.map(item => ({ ...item,
        ...(item.kind === 'review' ? { review: { ...item.review } } : {}) })) };
}
