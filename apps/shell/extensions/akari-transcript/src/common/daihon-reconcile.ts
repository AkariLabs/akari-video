import type { DaihonRow } from './daihon-row-model';
import type { DaihonHighlight } from './daihon-time-map';

export interface DaihonUpdatePlan {
    create: DaihonRow[];
    update: DaihonRow[];
    remove: string[];
    order: string[];
}

export interface DaihonHighlightWordChange {
    rowId: string;
    wordIndex: number;
}

export interface DaihonHighlightPlan {
    rowIds: string[];
    words: DaihonHighlightWordChange[];
}

function equalWords(left: DaihonRow['words'], right: DaihonRow['words']): boolean {
    if (left === right) return true;
    if (!left || !right || left.length !== right.length) return false;
    return left.every((word, index) => {
        const other = right[index];
        return word.text === other.text && word.start === other.start && word.end === other.end;
    });
}

function equalUnrecognized(left: DaihonRow['unrecognized'], right: DaihonRow['unrecognized']): boolean {
    return left.length === right.length && left.every((span, index) => {
        const other = right[index];
        return span.start === other.start && span.end === other.end;
    });
}

function needsUpdate(left: DaihonRow, right: DaihonRow): boolean {
    return left.text !== right.text
        || left.stylePreset !== right.stylePreset
        || left.style !== right.style
        || !equalWords(left.words, right.words)
        || !equalUnrecognized(left.unrecognized, right.unrecognized)
        || left.edited !== right.edited
        || left.outStart !== right.outStart
        || left.outEnd !== right.outEnd
        || left.fragmentBreakWordIndex !== right.fragmentBreakWordIndex
        || left.start !== right.start
        || left.end !== right.end
        || left.timeDomain !== right.timeDomain;
}

export function planDaihonUpdate(
    previous: readonly DaihonRow[], next: readonly DaihonRow[]
): DaihonUpdatePlan {
    const previousById = new Map(previous.map(row => [row.id, row]));
    const nextIds = new Set(next.map(row => row.id));
    return {
        create: next.filter(row => !previousById.has(row.id)),
        update: next.filter(row => {
            const old = previousById.get(row.id);
            return old !== undefined && needsUpdate(old, row);
        }),
        remove: previous.filter(row => !nextIds.has(row.id)).map(row => row.id),
        order: next.map(row => row.id)
    };
}

export function planHighlight(previous: DaihonHighlight, next: DaihonHighlight): DaihonHighlightPlan {
    if (previous.rowId === next.rowId && previous.wordIndex === next.wordIndex) {
        return { rowIds: [], words: [] };
    }
    const rowIds = [...new Set([previous.rowId, next.rowId].filter((id): id is string => id !== null))];
    const words: DaihonHighlightWordChange[] = [];
    if (previous.rowId !== null && previous.wordIndex !== null) {
        words.push({ rowId: previous.rowId, wordIndex: previous.wordIndex });
    }
    if (next.rowId !== null && next.wordIndex !== null
        && (previous.rowId !== next.rowId || previous.wordIndex !== next.wordIndex)) {
        words.push({ rowId: next.rowId, wordIndex: next.wordIndex });
    }
    return { rowIds, words };
}
