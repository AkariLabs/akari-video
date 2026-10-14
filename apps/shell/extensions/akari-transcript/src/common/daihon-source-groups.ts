export interface SourceGroupRow {
    id: string;
    sourceId?: string | null;
    start: number;
    end: number;
}

export interface SourceGroup {
    key: string;
    sourceId: string | null;
    rowIds: string[];
    firstRowId: string;
    duration: number;
}

export interface SourceGroupState {
    openSourceIds: string[];
    chipsExpanded: boolean;
}

export function sourceGroupKey(sourceId: string | null | undefined): string {
    return sourceId == null ? 'unspecified' : `source:${sourceId}`;
}

export function groupSourceRows(rows: readonly SourceGroupRow[]): SourceGroup[] {
    const groups: SourceGroup[] = [];
    if (!rows.length) return groups;
    let first = 0;
    for (let index = 0; index <= rows.length; index++) {
        if (index < rows.length && (index === first || sourceGroupKey(rows[index].sourceId) === sourceGroupKey(rows[first].sourceId))) continue;
        const section = rows.slice(first, index);
        const sourceId = rows[first].sourceId ?? null;
        let start = Number.POSITIVE_INFINITY;
        let end = Number.NEGATIVE_INFINITY;
        for (const row of section) { start = Math.min(start, row.start); end = Math.max(end, row.end); }
        groups.push({
            key: sourceGroupKey(sourceId), sourceId,
            firstRowId: section[0].id, rowIds: section.map(row => row.id),
            duration: Math.max(0, end - start)
        });
        first = index;
    }
    return groups;
}

export function normalizeSourceGroupState(value: unknown): SourceGroupState {
    if (!value || typeof value !== 'object') return { openSourceIds: [], chipsExpanded: false };
    const state = value as { openSourceIds?: unknown; chipsExpanded?: unknown };
    return {
        openSourceIds: Array.isArray(state.openSourceIds)
            ? [...new Set(state.openSourceIds.filter((id): id is string => typeof id === 'string'))] : [],
        chipsExpanded: state.chipsExpanded === true
    };
}

export function sourceGroupStorageKey(editUri: string): string {
    return `akari.daihon.sourceGroups:${encodeURIComponent(editUri)}`;
}

export function shouldAutoExpandPlayback(previousRowId: string | null, rowId: string | null,
    wasPlaying: boolean, playing: boolean, initialized: boolean, pendingInitialRowId: string | null): boolean {
    return initialized && rowId !== null && (rowId !== previousRowId || (playing && !wasPlaying)
        || (playing && pendingInitialRowId === rowId));
}
