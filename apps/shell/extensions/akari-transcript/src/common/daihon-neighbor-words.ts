import type { DaihonCutRangeWord } from './daihon-cut-range';
import type { DaihonCaptionWord } from './daihon-row-model';

/** 語の帯に使う行。`src` は行が属する素材 id（無ければ 1 素材前提の従来動作）。 */
export interface DaihonNeighborWordRow {
    id: string;
    start: number;
    end: number;
    text: string;
    words?: readonly DaihonCaptionWord[] | null;
    src?: string | null;
}

function rowWords(row: DaihonNeighborWordRow): DaihonCutRangeWord[] {
    return row.words?.length
        ? row.words.map(word => ({ ...word }))
        : [{ text: row.text.slice(0, 8) || '—', start: row.start, end: row.end }];
}

export function neighborWordsForRow(
    rows: readonly DaihonNeighborWordRow[], row: DaihonNeighborWordRow
): DaihonCutRangeWord[] {
    const src = row.src ?? null;
    return [...rows]
        .filter(candidate => (candidate.src ?? null) === src)
        .sort((left, right) => left.start - right.start || left.end - right.end)
        .flatMap(candidate => rowWords(candidate))
        .sort((left, right) => left.start - right.start || left.end - right.end);
}
