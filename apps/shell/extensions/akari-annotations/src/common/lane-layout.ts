export interface LaneItemSpan {
    start: number;
    end: number;
}

/**
 * Greedy interval partitioning: returns a sub-row index (0-based) per item,
 * in the same order as `items`. Items whose time ranges do not overlap can
 * share a sub-row; overlapping items are pushed to additional sub-rows.
 */
export function assignSubRows(items: readonly LaneItemSpan[]): number[] {
    const order = items
        .map((_, index) => index)
        .sort((a, b) => items[a].start - items[b].start || items[a].end - items[b].end);
    const rowEnds: number[] = [];
    const rows = new Array<number>(items.length);
    for (const index of order) {
        const item = items[index];
        let row = rowEnds.findIndex(end => end <= item.start);
        if (row === -1) {
            row = rowEnds.length;
            rowEnds.push(item.end);
        } else {
            rowEnds[row] = item.end;
        }
        rows[index] = row;
    }
    return rows;
}
