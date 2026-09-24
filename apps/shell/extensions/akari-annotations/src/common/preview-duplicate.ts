export interface PreviewDuplicateRequest {
    itemId: string;
    transform: Record<string, number>;
}

type JsonRecord = Record<string, any>;

export function duplicatePreviewItem(source: string, request: PreviewDuplicateRequest): string {
    const doc = JSON.parse(source) as JsonRecord;
    const lists: JsonRecord[][] = [];
    if (doc.version === 2 && Array.isArray(doc.tracks)) {
        const collect = (items: JsonRecord[]): void => {
            lists.push(items);
            for (const item of items) {
                if (Array.isArray(item.items)) collect(item.items);
                if (Array.isArray(item.children)) collect(item.children);
            }
        };
        for (const track of doc.tracks) {
            if (track.lane === 'visual' && Array.isArray(track.items)) collect(track.items);
        }
    } else {
        for (const key of ['overlays', 'layers']) {
            if (Array.isArray(doc[key])) lists.push(doc[key]);
        }
    }
    const ids = new Set(lists.flatMap(list => list.map(item => item.id)));
    for (const list of lists) {
        const index = list.findIndex(item => item.id === request.itemId);
        if (index < 0) continue;
        const duplicate = structuredClone(list[index]);
        const freshIds = (item: JsonRecord): void => {
            let serial = 1;
            let id = `${item.id}-copy-${serial}`;
            while (ids.has(id)) id = `${item.id}-copy-${++serial}`;
            ids.add(id);
            item.id = id;
            for (const key of ['items', 'children']) {
                if (Array.isArray(item[key])) item[key].forEach(freshIds);
            }
        };
        freshIds(duplicate);
        duplicate.locked = false;
        duplicate.transform = { ...(duplicate.transform ?? {}), ...request.transform };
        list.splice(index + 1, 0, duplicate);
        return `${JSON.stringify(doc, undefined, 2)}\n`;
    }
    throw new Error(`複製する要素が見つかりません: ${request.itemId}`);
}
