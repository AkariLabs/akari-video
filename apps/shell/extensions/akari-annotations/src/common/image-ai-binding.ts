function targetDeclaration(document: any, itemId: string): { item: any; sourceRow: any } | undefined {
    const visit = (items: any[]): any => {
        for (const item of items) {
            if (item.id === itemId) return item;
            const child = Array.isArray(item.items) ? visit(item.items) : undefined;
            if (child) return child;
        }
    };
    for (const track of document?.tracks ?? []) {
        const item = visit(track.items ?? []);
        if (!item) continue;
        if (item.source?.kind !== 'media') return undefined;
        const sourceRow = (document.sources ?? []).find((row: any) => row.id === item.source.src);
        return sourceRow ? { item, sourceRow } : undefined;
    }
    return undefined;
}

/** Only the selected item's id/source and its referenced source row form this version. */
export function imageAiEditVersion(document: unknown, itemId: string): string | undefined {
    const target = targetDeclaration(document, itemId);
    if (!target) return undefined;
    const text = JSON.stringify({ id: target.item.id, source: target.item.source, sourceRow: target.sourceRow });
    let value = 2166136261;
    for (let index = 0; index < text.length; index++) {
        value ^= text.charCodeAt(index);
        value = Math.imul(value, 16777619);
    }
    return (value >>> 0).toString(16).padStart(8, '0');
}

export interface ImageAiBinding {
    itemId: string;
    sourcePath: string;
    inputSha256: string;
    editVersion: string;
}

/** The item and its original source must still be the same when accepting an alternative. */
export function imageAiBindingMatches(document: any, binding: ImageAiBinding, currentSha256: string): boolean {
    const target = targetDeclaration(document, binding.itemId);
    return !!target && target.sourceRow.path === binding.sourcePath
        && imageAiEditVersion(document, binding.itemId) === binding.editVersion
        && currentSha256 === binding.inputSha256;
}
