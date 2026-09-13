export const CAPTION_FRAGMENT_BREAKS_STORAGE_KEY = 'akari.captions.fragmentBreaks.visible';

export function readCaptionFragmentBreaksVisible(storage?: Pick<Storage, 'getItem'>): boolean {
    if (!storage) return true;
    try {
        return storage.getItem(CAPTION_FRAGMENT_BREAKS_STORAGE_KEY) !== 'false';
    } catch {
        return true;
    }
}

export interface CaptionDisplayCueLike {
    source_cue_id: string;
    start: number;
    end: number;
    text: string;
    occurrence_index?: number;
    fragment_index?: number;
    fragment_count?: number;
    display_lines?: string[];
}

export interface CaptionFragmentBlock {
    index: number;
    left: number;
    width: number;
    text: string;
    folded: boolean;
}

export function groupCaptionDisplayCues(
    cues: readonly CaptionDisplayCueLike[]
): Map<string, CaptionDisplayCueLike[]> {
    const grouped = new Map<string, CaptionDisplayCueLike[]>();
    for (const cue of cues) {
        if (!cue || typeof cue.source_cue_id !== 'string' || cue.source_cue_id.length === 0) continue;
        const group = grouped.get(cue.source_cue_id) ?? [];
        group.push(cue);
        grouped.set(cue.source_cue_id, group);
    }
    for (const group of grouped.values()) {
        group.sort((left, right) => left.start - right.start
            || (left.occurrence_index ?? 0) - (right.occurrence_index ?? 0)
            || (left.fragment_index ?? 0) - (right.fragment_index ?? 0));
    }
    return grouped;
}

export function captionFragmentBlocks(cues: readonly CaptionDisplayCueLike[]): CaptionFragmentBlock[] {
    if (cues.length <= 1) return [];
    const sorted = [...cues].sort((left, right) => left.start - right.start
        || (left.occurrence_index ?? 0) - (right.occurrence_index ?? 0)
        || (left.fragment_index ?? 0) - (right.fragment_index ?? 0));
    const start = sorted[0].start;
    const end = sorted[sorted.length - 1].end;
    const duration = end - start;
    if (!Number.isFinite(start) || !Number.isFinite(end) || duration <= 0) return [];
    return sorted.flatMap((cue, index) => {
        if (!Number.isFinite(cue.start) || !Number.isFinite(cue.end) || cue.end <= cue.start) return [];
        const left = (cue.start - start) / duration;
        const width = (cue.end - cue.start) / duration;
        if (!Number.isFinite(left) || !Number.isFinite(width) || width <= 0) return [];
        return [{
            index,
            left: Math.max(0, Math.min(1, left)),
            width: Math.max(0, Math.min(1 - left, width)),
            text: cue.text,
            folded: Array.isArray(cue.display_lines) && cue.display_lines.length >= 2
        }];
    });
}

export async function loadCaptionDisplayCueGroups(
    resolve: () => Promise<{ captions: CaptionDisplayCueLike[] } | null>,
    warn: (error: unknown) => void
): Promise<Map<string, CaptionDisplayCueLike[]>> {
    try {
        const resolved = await resolve();
        if (!resolved) throw new Error('resolveCaptionDisplay returned null');
        return groupCaptionDisplayCues(resolved.captions);
    } catch (error) {
        warn(error);
        return new Map();
    }
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
