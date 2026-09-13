import { captionFragmentWindows, type CaptionFragmentLike } from '@akari-video/edit-store';

export const CAPTION_FRAGMENT_BREAKS_STORAGE_KEY = 'akari.captions.fragmentBreaks.visible';

export function readCaptionFragmentBreaksVisible(storage?: Pick<Storage, 'getItem'>): boolean {
    if (!storage) return true;
    try {
        return storage.getItem(CAPTION_FRAGMENT_BREAKS_STORAGE_KEY) !== 'false';
    } catch {
        return true;
    }
}

export interface CaptionFragmentTick {
    index: number;
    position: number;
    seconds: number;
}

export function captionFragmentTicks(caption: CaptionFragmentLike): CaptionFragmentTick[] {
    const start = caption.start;
    const end = caption.end;
    if (typeof start !== 'number' || typeof end !== 'number'
        || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
        return [];
    }
    const windows = captionFragmentWindows(caption);
    if (!windows || windows.length <= 1) return [];
    const duration = end - start;
    const seen = new Set<number>();
    return windows.slice(0, -1).flatMap(window => {
        const seconds = window.end;
        const position = (seconds - start) / duration;
        if (!Number.isFinite(seconds) || !Number.isFinite(position)
            || position <= 0 || position >= 1 || seen.has(seconds)) {
            return [];
        }
        seen.add(seconds);
        return [{ index: window.index, position, seconds }];
    }).sort((left, right) => left.seconds - right.seconds);
}

export interface CaptionTimeSpan {
    id: string;
    start: number;
    end: number;
}

export function remapCaptionSelection(
    previous: readonly CaptionTimeSpan[],
    next: readonly CaptionTimeSpan[],
    selectedIds: readonly string[]
): string[] {
    const previousById = new Map(previous.map(caption => [caption.id, caption]));
    const nextIds = new Set(next.map(caption => caption.id));
    const result: string[] = [];
    const seen = new Set<string>();
    for (const selectedId of selectedIds) {
        let nextId: string | undefined;
        if (nextIds.has(selectedId)) {
            nextId = selectedId;
        } else {
            const oldCaption = previousById.get(selectedId);
            if (oldCaption) {
                let greatestOverlap = 0;
                for (const candidate of next) {
                    const overlap = Math.max(0,
                        Math.min(oldCaption.end, candidate.end) - Math.max(oldCaption.start, candidate.start));
                    if (overlap > greatestOverlap) {
                        greatestOverlap = overlap;
                        nextId = candidate.id;
                    }
                }
            }
        }
        if (nextId !== undefined && !seen.has(nextId)) {
            seen.add(nextId);
            result.push(nextId);
        }
    }
    return result;
}

export function shouldReloadCaptions(previous: string | undefined, next: string | undefined): boolean {
    return next === undefined || previous !== next;
}
