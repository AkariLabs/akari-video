/** Build the same single-document duplicate as the annotations history command when it is unavailable. */
export function duplicatePreviewItemSource(source: string, itemId: string,
    transform: { x?: number; y?: number; scale?: number; rotate?: number; scaleX?: number; scaleY?: number }): string {
    const doc = JSON.parse(source) as Record<string, any>;
    const lists: Array<{ items: Array<Record<string, any>>; trackIndex?: number }> = [];
    if (doc.version === 2 && Array.isArray(doc.tracks)) {
        const collect = (items: Array<Record<string, any>>, trackIndex?: number): void => {
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
        const index = list.findIndex(item => item.id === itemId);
        if (index < 0) continue;
        const duplicate = structuredClone(list[index]);
        const freshIds = (item: Record<string, any>): void => {
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
        duplicate.transform = { ...(duplicate.transform ?? {}), ...transform };
        if (trackIndex !== undefined) {
            const trackIds = new Set(doc.tracks.map((track: Record<string, any>) => track.id));
            let serial = 1;
            while (trackIds.has(`v${serial}`)) serial++;
            doc.tracks.splice(trackIndex + 1, 0, { id: `v${serial}`, lane: 'visual', items: [duplicate] });
        } else {
            list.splice(index + 1, 0, duplicate);
        }
        return `${JSON.stringify(doc, undefined, 2)}\n`;
    }
    throw new Error(`複製する要素が見つかりません: ${itemId}`);
}

/** Duplicate one placed caption while retaining the source cue and assigning a fresh cue id. */
export function duplicatePreviewCaptionSource(source: string, captionId: string,
    value: { anchor: string; position: { x?: number; y: number } }): string {
    if (!/^[tmb][lcr]$/.test(value.anchor)
        || !Number.isFinite(value.position.x) || !Number.isFinite(value.position.y)) {
        throw new Error('複製先の位置が不正です');
    }
    const root = JSON.parse(source) as Record<string, any> | Array<Record<string, any>>;
    const captions = Array.isArray(root) ? root : root?.captions;
    if (!Array.isArray(captions)) throw new Error('字幕ファイルの形式が不正です');
    const index = captions.findIndex(item => item?.id === captionId);
    if (index < 0) throw new Error(`文字が見つかりません: ${captionId}`);
    const clone = structuredClone(captions[index]);
    const existing = new Set(captions.map(item => item?.id));
    let next = captions.reduce((max: number, item: Record<string, any>) => {
        const match = /^c-(\d+)$/.exec(String(item?.id ?? ''));
        return match ? Math.max(max, Number(match[1])) : max;
    }, 0) + 1;
    clone.id = `c-${String(next).padStart(4, '0')}`;
    while (existing.has(clone.id)) clone.id = `c-${String(++next).padStart(4, '0')}`;
    clone.text_style = { ...(clone.text_style ?? {}), text_anchor: value.anchor,
        position: { ...value.position } };
    delete clone.text_style.zone;
    captions.splice(index + 1, 0, clone);
    return `${JSON.stringify(root, undefined, 2)}\n`;
}
