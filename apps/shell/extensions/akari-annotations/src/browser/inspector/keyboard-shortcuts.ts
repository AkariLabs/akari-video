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
    blockedByOverlap?: boolean;
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
        blockedByOverlap: overlap
    };
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
