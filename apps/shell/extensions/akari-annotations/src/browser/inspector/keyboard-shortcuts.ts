export interface ShortcutTrack {
    id: string;
    lane?: unknown;
    name?: unknown;
    items?: unknown;
}

export interface AdjacentTrackMove {
    targetTrackId?: string;
    targetTrackLabel?: string;
    atFrames?: number;
    requiresNewTrack?: boolean;
}

export type ZOrderOperation = 'front' | 'forward' | 'backward' | 'back';
export type ZOrderMove =
    | { target: { track: string }; atFrames: number; blocked?: never }
    | { target: { parent: string; index: number }; atFrames?: never; blocked?: never }
    | { blocked: 'front' | 'back'; target?: never; atFrames?: never }
    | { target?: never; atFrames?: never; blocked?: never };

export function matchesPreviewZOrderSelection(
    currentId: string | undefined, selectedIds: readonly string[], hasMultiSelection: boolean
): boolean {
    return !hasMultiSelection && selectedIds.length === 1
        && !selectedIds[0].includes('#') && currentId === selectedIds[0];
}

function record(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function planAdjacentVisualTrackMove(
    tracks: readonly ShortcutTrack[],
    itemId: string,
    direction: -1 | 1
): AdjacentTrackMove {
    const visual = tracks.filter(track => track.lane === 'visual' && Array.isArray(track.items));
    const sourceIndex = visual.findIndex(track =>
        (track.items as unknown[]).some(item => record(item) && item.id === itemId));
    if (sourceIndex < 0) return {};
    const target = visual[sourceIndex + direction];
    if (!target) return {};
    const sourceItem = (visual[sourceIndex].items as unknown[])
        .find(item => record(item) && item.id === itemId) as Record<string, unknown> | undefined;
    if (!sourceItem || !Number.isInteger(sourceItem.at) || !Number.isInteger(sourceItem.duration)) return {};
    const at = sourceItem.at as number;
    const end = at + (sourceItem.duration as number);
    const overlap = (target.items as unknown[]).some(item => {
        if (!record(item) || !Number.isInteger(item.at) || !Number.isInteger(item.duration)) return false;
        const otherAt = item.at as number;
        return at < otherAt + (item.duration as number) && otherAt < end;
    });
    return {
        targetTrackId: target.id,
        targetTrackLabel: typeof target.name === 'string' && target.name ? target.name : target.id,
        atFrames: at,
        requiresNewTrack: overlap
    };
}

/** Tracks are ordered bottom to top; children of a group use their own item order. */
export function planZOrderMove(
    doc: { tracks?: readonly ShortcutTrack[] }, itemId: string, op: ZOrderOperation
): ZOrderMove {
    if (itemId.includes('#') || !Array.isArray(doc.tracks)) return {};
    const visual = doc.tracks.filter(track => track.lane === 'visual' && Array.isArray(track.items));
    const findChild = (items: unknown[], parent?: Record<string, unknown>): { parent: string; index: number; length: number } | undefined => {
        for (let index = 0; index < items.length; index++) {
            const item = items[index];
            if (!record(item)) continue;
            if (item.id === itemId && parent && record(parent.source) && parent.source.kind === 'group') {
                return { parent: parent.id as string, index, length: items.length };
            }
            if (typeof item.id === 'string' && Array.isArray(item.items)) {
                const nested = findChild(item.items, item);
                if (nested) return nested;
            }
        }
        return undefined;
    };
    for (const track of visual) {
        const child = findChild(track.items as unknown[]);
        if (!child) continue;
        const direction = op === 'front' || op === 'forward' ? 1 : -1;
        if ((direction > 0 && child.index === child.length - 1) || (direction < 0 && child.index === 0)) {
            return { blocked: direction > 0 ? 'front' : 'back' };
        }
        const index = op === 'front' ? child.length - 1 : op === 'back' ? 0 : child.index + direction;
        return { target: { parent: child.parent, index } };
    }
    const sourceIndex = visual.findIndex(track =>
        (track.items as unknown[]).some(item => record(item) && item.id === itemId));
    if (sourceIndex < 0) return {};
    const direction = op === 'front' || op === 'forward' ? 1 : -1;
    const targetIndex = op === 'front' ? visual.length - 1
        : op === 'back' ? 0 : sourceIndex + direction;
    if (targetIndex < 0 || targetIndex >= visual.length || targetIndex === sourceIndex) {
        return { blocked: direction > 0 ? 'front' : 'back' };
    }
    const source = (visual[sourceIndex].items as unknown[])
        .find(item => record(item) && item.id === itemId) as Record<string, unknown> | undefined;
    if (!source || !Number.isInteger(source.at) || !Number.isInteger(source.duration)) return {};
    return { target: { track: visual[targetIndex].id }, atFrames: source.at as number };
}

export class NudgeCommitSession {
    protected current: { id: string; path: 'transform.x' | 'transform.y'; value: number } | undefined;

    apply(id: string, path: 'transform.x' | 'transform.y', value: number): void {
        this.current = { id, path, value };
    }

    release(commit: (value: { id: string; path: 'transform.x' | 'transform.y'; value: number }) => void): boolean {
        if (!this.current) return false;
        const current = this.current;
        this.current = undefined;
        commit(current);
        return true;
    }
}
