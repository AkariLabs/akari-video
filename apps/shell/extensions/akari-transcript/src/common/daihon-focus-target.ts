/** Targets accepted when opening the panel from outside. */
export type DaihonOpenSection =
    | 'display' | 'template' | 'history' | 'silenceBatch' | 'gear' | 'cutRange' | 'qc';

export interface DaihonWordIndexRange {
    /** Zero-based word indices, including both endpoints. */
    from: number;
    to: number;
}

export interface DaihonOpenTarget {
    captionId?: string;
    wordRange?: DaihonWordIndexRange;
    atSeconds?: number;
    open?: DaihonOpenSection;
    speaker?: string;
    pulse?: boolean;
}

export function resolveDaihonFocusRowId(
    rowIds: readonly string[], timeResolvedRowId: string | null,
    target: Pick<DaihonOpenTarget, 'captionId' | 'atSeconds'>
): string | undefined {
    if (target.captionId !== undefined) return rowIds.includes(target.captionId) ? target.captionId : undefined;
    if (target.atSeconds !== undefined) return timeResolvedRowId ?? undefined;
    return undefined;
}

export function isValidDaihonWordRange(
    wordsLength: number, wordRange: DaihonWordIndexRange | undefined
): wordRange is DaihonWordIndexRange {
    return !!wordRange && Number.isInteger(wordRange.from) && Number.isInteger(wordRange.to)
        && 0 <= wordRange.from && wordRange.from <= wordRange.to && wordRange.to < wordsLength;
}
