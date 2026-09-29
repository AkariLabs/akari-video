import { isEditDataFileName } from './edit-data-file';

/** data の位置だけを定義順に並べ替える。他種別の位置・順序と、未知の data 同士の相対順は保つ。 */
export function orderDataEntries<T extends { kind: string; name: string }>(entries: T[], fileOrder: readonly string[]): T[] {
    const ranks = new Map(fileOrder.map((name, index) => [name, index]));
    const dataEntries = entries.filter(entry => entry.kind === 'data');
    dataEntries.sort((left, right) => {
        const leftRank = left.name !== 'edit.json' && isEditDataFileName(left.name) ? 0.5 : ranks.get(left.name) ?? fileOrder.length;
        const rightRank = right.name !== 'edit.json' && isEditDataFileName(right.name) ? 0.5 : ranks.get(right.name) ?? fileOrder.length;
        if (leftRank !== rightRank) return leftRank - rightRank;
        if (leftRank === 0.5) return left.name < right.name ? -1 : left.name > right.name ? 1 : 0;
        return 0;
    });
    let dataIndex = 0;
    return entries.map(entry => entry.kind === 'data' ? dataEntries[dataIndex++] : entry);
}

export function dataFileIcon(name: string): string {
    if (isEditDataFileName(name)) return 'codicon codicon-layers';
    switch (name) {
        case 'captions.json': return 'codicon codicon-symbol-string';
        case 'review.json': return 'codicon codicon-comment-discussion';
        default: return 'codicon codicon-json';
    }
}

export function editVariantDataFileLabel(name: string): string | undefined {
    return name !== 'edit.json' && isEditDataFileName(name) ? `編集データ（${name.slice(5, -5)}）` : undefined;
}
