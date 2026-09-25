export interface PreviewDuplicateRequest {
    itemId: string;
    transform: Record<string, number>;
}

type JsonRecord = Record<string, any>;

export function duplicatePreviewItem(source: string, request: PreviewDuplicateRequest): string {
    const doc = JSON.parse(source) as JsonRecord;
    const lists: Array<{ items: JsonRecord[]; trackIndex?: number }> = [];
    if (doc.version === 2 && Array.isArray(doc.tracks)) {
        const collect = (items: JsonRecord[], trackIndex?: number): void => {
            lists.push({ items, trackIndex });
            for (const item of items) {
                if (Array.isArray(item.items)) collect(item.items);
                if (Array.isArray(item.children)) collect(item.children);
            }
        };
        for (const [trackIndex, track] of doc.tracks.entries()) {
            if (track.lane === 'visual' && Array.isArray(track.items)) collect(track.items, trackIndex);
        }
    } else {
        for (const key of ['overlays', 'layers']) {
            if (Array.isArray(doc[key])) lists.push({ items: doc[key] });
        }
    }
    const ids = new Set(lists.flatMap(({ items }) => items.map(item => item.id)));
    for (const { items: list, trackIndex } of lists) {
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
        if (trackIndex !== undefined) {
            const trackIds = new Set(doc.tracks.map((track: JsonRecord) => track.id));
            let serial = 1;
            while (trackIds.has(`v${serial}`)) serial++;
            doc.tracks.splice(trackIndex + 1, 0, { id: `v${serial}`, lane: 'visual', items: [duplicate] });
        } else {
            list.splice(index + 1, 0, duplicate);
        }
        return `${JSON.stringify(doc, undefined, 2)}\n`;
    }
    throw new Error(`複製する要素が見つかりません: ${request.itemId}`);
}
