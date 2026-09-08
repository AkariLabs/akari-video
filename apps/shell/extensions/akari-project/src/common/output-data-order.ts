/** data の位置だけを定義順に並べ替える。他種別の位置・順序と、未知の data 同士の相対順は保つ。 */
export function orderDataEntries<T extends { kind: string; name: string }>(entries: T[], fileOrder: readonly string[]): T[] {
    const ranks = new Map(fileOrder.map((name, index) => [name, index]));
    const dataEntries = entries.filter(entry => entry.kind === 'data');
    dataEntries.sort((left, right) =>
        (ranks.get(left.name) ?? fileOrder.length) - (ranks.get(right.name) ?? fileOrder.length)
    );
    let dataIndex = 0;
    return entries.map(entry => entry.kind === 'data' ? dataEntries[dataIndex++] : entry);
}

export function dataFileIcon(name: string): string {
    switch (name) {
        case 'edit.json': return 'codicon codicon-layers';
        case 'captions.json': return 'codicon codicon-symbol-string';
        case 'review.json': return 'codicon codicon-comment-discussion';
        default: return 'codicon codicon-json';
    }
}
