import type { DaihonCaptionLike, DaihonRow } from './daihon-row-model';

export interface PlacedTextRange {
    captionId: string;
    text: string;
    start: number;
    end: number;
    first: number;
    last: number;
    colorIndex: number;
}

type OutputRow = Pick<DaihonRow, 'outStart' | 'outEnd'>;
export type PlacedTextAction = 'expand-start' | 'shrink-start' | 'expand-end' | 'shrink-end' | 'all';

function timed(row: OutputRow): boolean {
    return row.outStart !== null && row.outEnd !== null && row.outEnd > row.outStart;
}

/** Half-open output intervals; cut rows have no output and cannot anchor a label. */
export function placedTextRanges(captions: readonly DaihonCaptionLike[], rows: readonly OutputRow[]): PlacedTextRange[] {
    return captions.filter(caption => (caption.timeDomain ?? caption.time_domain) === 'output')
        .slice().sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
        .flatMap((caption, colorIndex) => {
            const overlapping = rows.flatMap((row, index) => timed(row)
                && row.outStart! < caption.end && caption.start < row.outEnd! ? [index] : []);
            const first = overlapping[0] ?? rows.findIndex(row => timed(row) && row.outStart! >= caption.start);
            if (first < 0) return [];
            return [{ captionId: caption.id, text: caption.text, start: caption.start, end: caption.end,
                first, last: overlapping[overlapping.length - 1] ?? first, colorIndex }];
        });
}

/** Inclusive row spans: adjacent, non-overlapping spans reuse the first free lane. */
export function placedTextLanes(ranges: readonly (Pick<PlacedTextRange, 'first' | 'last' | 'colorIndex'> & { id?: string; captionId?: string })[]): { lanes: Map<string, number>; count: number; width: number } {
    const ends: number[] = [];
    const lanes = new Map<string, number>();
    for (const range of ranges.filter(item => item.last > item.first).slice()
        .sort((a, b) => a.first - b.first || a.last - b.last || a.colorIndex - b.colorIndex)) {
        let lane = ends.findIndex(end => end < range.first);
        if (lane < 0) lane = ends.length;
        ends[lane] = range.last;
        const id = range.id ?? range.captionId;
        if (id) lanes.set(id, lane);
    }
    return { lanes, count: ends.length, width: ends.length ? ends.length * 4 + (ends.length - 1) * 2 : 0 };
}

/** Change only the requested edge; preserve the other edge's precise output time. */
export function placedTextTiming(range: PlacedTextRange, rows: readonly OutputRow[], action: PlacedTextAction): { start: number; end: number } | null {
    const indices = rows.flatMap((row, index) => timed(row) ? [index] : []);
    const first = indices.indexOf(range.first), last = indices.indexOf(range.last);
    if (first < 0 || last < 0) return null;
    let start = range.start, end = range.end;
    switch (action) {
        case 'expand-start': if (first === 0) return null; start = rows[indices[first - 1]].outStart!; break;
        case 'shrink-start': if (first >= last) return null; start = rows[indices[first + 1]].outStart!; break;
        case 'expand-end': if (last === indices.length - 1) return null; end = rows[indices[last + 1]].outEnd!; break;
        case 'shrink-end': if (first >= last) return null; end = rows[indices[last - 1]].outEnd!; break;
        case 'all': start = rows[indices[0]].outStart!; end = rows[indices[indices.length - 1]].outEnd!; break;
    }
    return end > start && (start !== range.start || end !== range.end) ? { start, end } : null;
}

/** Move a span by its number of output rows. Cut rows cannot be a drop target and do not count. */
export function placedTextDropTiming(range: PlacedTextRange, rows: readonly OutputRow[], targetIndex: number): { start: number; end: number } | null {
    if (targetIndex === range.first || !timed(rows[targetIndex] ?? { outStart: null, outEnd: null })) return null;
    const outputIndices = rows.flatMap((row, index) => timed(row) ? [index] : []);
    const span = outputIndices.filter(index => index >= range.first && index <= range.last).length;
    const target = outputIndices.indexOf(targetIndex);
    if (!span || target < 0 || target + span > outputIndices.length) return null;
    return { start: rows[targetIndex].outStart!, end: rows[outputIndices[target + span - 1]].outEnd! };
}

/** Snap one edge to an output row while retaining the other edge's exact time. */
export function placedTextEdgeTiming(range: PlacedTextRange, rows: readonly OutputRow[], edge: 'start' | 'end', targetIndex: number): { start: number; end: number } | null {
    const indices = rows.flatMap((row, index) => timed(row) ? [index] : []);
    if (!indices.includes(range.first) || !indices.includes(range.last) || !Number.isInteger(targetIndex)) return null;
    const nearest = indices.reduce<number | null>((nearest, index) => nearest === null
        || Math.abs(index - targetIndex) < Math.abs(nearest - targetIndex) ? index : nearest, null);
    if (nearest === null) return null;
    const target = edge === 'start' ? Math.min(nearest, range.last) : Math.max(nearest, range.first);
    if (target === (edge === 'start' ? range.first : range.last)) return null;
    const start = edge === 'start' ? rows[target].outStart! : range.start;
    const end = edge === 'end' ? rows[target].outEnd! : range.end;
    return end > start && (start !== range.start || end !== range.end) ? { start, end } : null;
}
