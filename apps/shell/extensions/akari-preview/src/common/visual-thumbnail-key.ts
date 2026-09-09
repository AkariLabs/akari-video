/** Include inherited declarations without invalidating a leaf when an unrelated sibling changes. */
export function visualDeclarationChain(document: { tracks?: unknown } | undefined, id: string): unknown[] {
    const visit = (items: unknown): unknown[] | undefined => {
        if (!Array.isArray(items)) return undefined;
        for (const item of items) {
            if (!item || typeof item !== 'object') continue;
            if (item.id === id) return [item];
            const nested = visit(item.items);
            if (nested) {
                const parent = { ...item };
                delete parent.items;
                return [parent, ...nested];
            }
            if (typeof item.id === 'string' && id.startsWith(`${item.id}#`)) return [item];
        }
        return undefined;
    };
    for (const track of Array.isArray(document?.tracks) ? document.tracks : []) {
        const chain = visit(track.items);
        if (chain) return chain;
    }
    return [];
}

/** Freeze the selected subtree and ancestor declarations, excluding unrelated siblings. */
export function visualThumbnailSnapshot(document: { tracks?: unknown } | undefined, id: string): string {
    const select = (items: unknown): unknown[] => {
        if (!Array.isArray(items)) return [];
        return items.flatMap(item => {
            if (!item || typeof item !== 'object') return [];
            if (item.id === id || (typeof item.id === 'string' && id.startsWith(`${item.id}#`))) return [item];
            const children = select(item.items);
            return children.length ? [{ ...item, items: children }] : [];
        });
    };
    const tracks = (Array.isArray(document?.tracks) ? document.tracks : [])
        .map(track => ({ ...track, items: select(track.items) })).filter(track => track.items.length);
    return JSON.stringify({ ...document, tracks });
}

/** Two independent 32-bit hashes keep queue/cache keys bounded even for inline HTML. */
export function visualThumbnailKey(project: string, id: string, inputs: unknown): string {
    const source = JSON.stringify(inputs);
    let a = 0x811c9dc5; let b = 0x9e3779b9;
    for (let index = 0; index < source.length; index++) {
        const code = source.charCodeAt(index);
        a = Math.imul(a ^ code, 0x01000193);
        b = Math.imul(b ^ code, 0x85ebca6b);
    }
    return `${JSON.stringify([project, id])}:${source.length}:${(a >>> 0).toString(16)}:${(b >>> 0).toString(16)}`;
}
