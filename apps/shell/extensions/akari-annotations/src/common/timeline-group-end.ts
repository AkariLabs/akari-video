export interface TimedTreeItem {
    at: number;
    duration: number;
    source: { kind: string };
    children: TimedTreeItem[];
}

/** Return the last placed group end on the output timeline, including nested groups. */
export function timelineGroupEndSeconds(
    tracks: readonly { items: readonly TimedTreeItem[] }[]
): number {
    let end = 0;
    const visit = (item: TimedTreeItem): void => {
        if (item.source.kind === 'group' && Number.isFinite(item.at) && Number.isFinite(item.duration)) {
            end = Math.max(end, item.at + Math.max(0, item.duration));
        }
        for (const child of item.children) visit(child);
    };
    for (const track of tracks) for (const item of track.items) visit(item);
    return end;
}

export function contentEndWithTimelineGroups(
    currentEnd: number,
    tracks: readonly { items: readonly TimedTreeItem[] }[],
    hasCuts: boolean
): number {
    return hasCuts ? currentEnd : Math.max(currentEnd, timelineGroupEndSeconds(tracks));
}
