import type { DaihonRow } from './daihon-row-model';

export const DAIHON_SILENCE_DEFAULTS = Object.freeze({ minGapSec: 0.45, keepSec: 0.15 });

export interface DaihonRowGap {
    prevId: string;
    nextId: string;
    start: number;
    end: number;
    span: number;
}

export function findRowGaps(rows: readonly Pick<DaihonRow, 'id' | 'start' | 'end' | 'outStart'>[]): DaihonRowGap[] {
    const kept = rows.filter(row => row.outStart !== null);
    const gaps: DaihonRowGap[] = [];
    for (let index = 0; index + 1 < kept.length; index++) {
        const previous = kept[index];
        const next = kept[index + 1];
        const span = next.start - previous.end;
        if (!(span > 0)) continue;
        gaps.push({ prevId: previous.id, nextId: next.id, start: previous.end, end: next.start, span });
    }
    return gaps;
}
