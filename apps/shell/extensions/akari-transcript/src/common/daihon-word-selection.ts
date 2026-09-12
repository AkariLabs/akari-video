export interface DaihonWordRange { row: string; a: number; b: number }
export interface DaihonWordRow { id: string; words: readonly { text: string; start: number; end: number }[] }
export interface DaihonSelectedWord { row: string; index: number; text: string; start: number; end: number }

function valid(range: DaihonWordRange): boolean {
    return typeof range.row === 'string' && Number.isInteger(range.a) && Number.isInteger(range.b)
        && range.a >= 0 && range.b >= range.a;
}

export function normalizeWordRanges(
    ranges: readonly DaihonWordRange[], rowOrder?: readonly string[]
): DaihonWordRange[] {
    const firstSeen = new Map<string, number>();
    const order = new Map((rowOrder ?? []).map((row, index) => [row, index]));
    const grouped = new Map<string, DaihonWordRange[]>();
    for (const range of ranges) {
        if (!valid(range)) continue;
        if (!firstSeen.has(range.row)) firstSeen.set(range.row, firstSeen.size);
        const row = grouped.get(range.row) ?? [];
        row.push({ ...range });
        grouped.set(range.row, row);
    }
    const rows = [...grouped.keys()].sort((left, right) =>
        (order.get(left) ?? rowOrder?.length ?? firstSeen.get(left) ?? 0)
        - (order.get(right) ?? rowOrder?.length ?? firstSeen.get(right) ?? 0));
    return rows.flatMap(row => {
        const sorted = grouped.get(row)!.sort((left, right) => left.a - right.a || left.b - right.b);
        const merged: DaihonWordRange[] = [];
        for (const range of sorted) {
            const previous = merged[merged.length - 1];
            if (previous && previous.b + 1 >= range.a) previous.b = Math.max(previous.b, range.b);
            else merged.push({ ...range });
        }
        return merged;
    });
}

export function addWordRange(ranges: readonly DaihonWordRange[], range: DaihonWordRange,
    rowOrder?: readonly string[]): DaihonWordRange[] {
    return normalizeWordRanges([...ranges, range], rowOrder);
}

export function removeWordRange(ranges: readonly DaihonWordRange[], hit: { row: string; index: number },
    rowOrder?: readonly string[]): DaihonWordRange[] {
    return normalizeWordRanges(ranges.filter(range => !(range.row === hit.row && range.a <= hit.index && hit.index <= range.b)), rowOrder);
}

export function extendWordRange(ranges: readonly DaihonWordRange[], hit: { row: string; index: number },
    rowOrder?: readonly string[]): DaihonWordRange[] {
    const normalized = normalizeWordRanges(ranges, rowOrder);
    let last = -1;
    normalized.forEach((range, index) => { if (range.row === hit.row) last = index; });
    if (last < 0) return addWordRange(normalized, { row: hit.row, a: hit.index, b: hit.index }, rowOrder);
    const anchor = normalized[last];
    const next = normalized.filter((_range, index) => index !== last);
    next.push({ row: hit.row, a: Math.min(anchor.a, hit.index), b: Math.max(anchor.b, hit.index) });
    return normalizeWordRanges(next, rowOrder);
}

export function wordsOf(rows: readonly DaihonWordRow[], ranges: readonly DaihonWordRange[]): DaihonSelectedWord[] {
    const byId = new Map(rows.map(row => [row.id, row]));
    return ranges.flatMap(range => {
        const row = byId.get(range.row);
        if (!row) return [];
        const words: DaihonSelectedWord[] = [];
        for (let index = range.a; index <= range.b; index++) {
            const word = row.words[index];
            if (word) words.push({ row: range.row, index, ...word });
        }
        return words;
    });
}

export function wordRangeSummary(rows: readonly DaihonWordRow[], ranges: readonly DaihonWordRange[]): {
    rangeCount: number; wordCount: number; start: number | null; end: number | null; text: string
} {
    const selected = wordsOf(rows, ranges);
    const byId = new Map(rows.map(row => [row.id, row]));
    return {
        rangeCount: ranges.length,
        wordCount: selected.length,
        start: selected.length ? Math.min(...selected.map(word => word.start)) : null,
        end: selected.length ? Math.max(...selected.map(word => word.end)) : null,
        text: ranges.map(range => {
            const row = byId.get(range.row);
            return row ? row.words.slice(range.a, range.b + 1).map(word => word.text).join('') : '';
        }).filter(Boolean).join('・')
    };
}
