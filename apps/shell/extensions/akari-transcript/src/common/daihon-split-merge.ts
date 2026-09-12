import type { DaihonRow } from './daihon-row-model';

export function canSplitRow(row: Pick<DaihonRow, 'words' | 'outStart'>): boolean {
    return row.outStart !== null && (row.words?.length ?? 0) >= 2;
}

export function splitWordBoundaries(row: Pick<DaihonRow, 'words'>): number[] {
    return Array.from({ length: Math.max(0, (row.words?.length ?? 0) - 1) }, (_value, index) => index + 1);
}

export function canMergeRows(
    rows: readonly Pick<DaihonRow, 'id' | 'outStart' | 'timeDomain'>[], selectedIds: readonly string[]
): { ok: true; orderedIds: string[] } | { ok: false; reason: string } {
    const selected = new Set(selectedIds);
    if (selected.size < 2) return { ok: false, reason: '隣接する行を 2 行以上選んでください。' };
    if (selected.size !== selectedIds.length) return { ok: false, reason: '同じ行が重複して選択されています。' };
    const indexes = rows.flatMap((row, index) => selected.has(row.id) ? [index] : []);
    if (indexes.length !== selected.size) return { ok: false, reason: '選択した行が見つかりません。' };
    if (indexes.some((index, offset) => offset > 0 && index !== indexes[offset - 1] + 1)) {
        return { ok: false, reason: '離れた行は結合できません。隣接する行を選んでください。' };
    }
    const selectedRows = indexes.map(index => rows[index]);
    if (selectedRows.some(row => row.outStart === null)) {
        return { ok: false, reason: 'カット中の行を含むため結合できません。' };
    }
    if (selectedRows.some(row => row.timeDomain !== selectedRows[0].timeDomain)) {
        return { ok: false, reason: 'タイムドメインが異なる行は結合できません。' };
    }
    return { ok: true, orderedIds: selectedRows.map(row => row.id) };
}
