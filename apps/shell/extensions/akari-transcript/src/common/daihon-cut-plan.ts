import type { DaihonRow } from './daihon-row-model';

export interface DaihonCutRange {
    in: number;
    out: number;
    kind: 'row' | 'filler' | 'silence' | 'unrecognized';
    captionId?: string;
    label?: string;
}

type RowBoundary = Pick<DaihonRow, 'id' | 'start' | 'end'>;

export function clampRowCutRange(
    row: RowBoundary,
    previous?: RowBoundary,
    next?: RowBoundary
): DaihonCutRange {
    return {
        in: Math.max(row.start - 0.04, previous?.end ?? Number.NEGATIVE_INFINITY, 0),
        out: Math.min(row.end + 0.04, next?.start ?? Number.POSITIVE_INFINITY),
        kind: 'row',
        captionId: row.id,
        label: '行',
    };
}

export function normalizeCutRanges(ranges: readonly DaihonCutRange[]): DaihonCutRange[] {
    const sorted = ranges.map(range => {
        if (!Number.isFinite(range.in) || !Number.isFinite(range.out) || range.in < 0 || range.out <= range.in) {
            throw new Error('カット範囲が不正です。');
        }
        return { ...range };
    }).sort((left, right) => left.in - right.in || left.out - right.out);
    const merged: DaihonCutRange[] = [];
    for (const range of sorted) {
        const previous = merged[merged.length - 1];
        if (previous && range.in <= previous.out && range.kind === previous.kind
            && range.captionId === previous.captionId && range.label === previous.label) {
            previous.out = Math.max(previous.out, range.out);
        } else {
            merged.push(range);
        }
    }
    return merged.sort((left, right) => right.in - left.in || right.out - left.out);
}
