/** A flattened preview layer can still belong to an item inside a canvas. */
export function isNestedPreviewLayer(editText: string, itemId: string): boolean {
    const edit = JSON.parse(editText) as { tracks?: Array<{ lane?: string; items?: unknown[] }> };
    const find = (items: unknown[], depth: number): boolean | undefined => {
        for (const candidate of items) {
            if (!candidate || typeof candidate !== 'object') continue;
            const item = candidate as { id?: unknown; items?: unknown[] };
            if (item.id === itemId) return depth > 0;
            if (Array.isArray(item.items)) {
                const nested = find(item.items, depth + 1);
                if (nested !== undefined) return nested;
            }
        }
        return undefined;
    };
    for (const track of edit.tracks ?? []) {
        if (track.lane !== 'visual') continue;
        const nested = find(track.items ?? [], 0);
        if (nested !== undefined) return nested;
    }
    return false;
}
