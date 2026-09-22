import type { TimelineSelectionSnapshot } from '../timeline-selection-model';

function timestamp(value: number): string {
    const tenths = Math.max(0, Math.round(value * 10));
    return `${String(Math.floor(tenths / 600)).padStart(2, '0')}:${String(Math.floor(tenths / 10) % 60).padStart(2, '0')}.${tenths % 10}`;
}

/** A view of the current snapshot; no additional selection state or thumbnail cache. */
export function createSelectionHeader(
    snapshot: NonNullable<TimelineSelectionSnapshot>,
    thumbnail: (path: string) => Promise<string | undefined>
): HTMLElement {
    let name: string;
    let kind: string;
    let start: number | undefined;
    let end: number | undefined;
    let source: string | undefined;
    switch (snapshot.kind) {
        case 'multi': {
            name = `${snapshot.count} 個を選択中`;
            kind = '複数選択';
            const ranges = snapshot.items.flatMap(item => {
                const from = item.outputStart;
                const to = 'outputEnd' in item ? item.outputEnd
                    : 'duration' in item && from !== undefined ? from + item.duration : undefined;
                return from !== undefined && to !== undefined ? [[from, to]] : [];
            });
            if (ranges.length) {
                start = Math.min(...ranges.map(range => range[0]));
                end = Math.max(...ranges.map(range => range[1]));
            }
            break;
        }
        case 'world':
            name = snapshot.world.label;
            kind = 'ワールド';
            start = snapshot.stop?.at;
            end = snapshot.stop?.leave;
            break;
        case 'gap':
            name = 'クリップ間のすき間';
            kind = 'すき間';
            start = snapshot.startSeconds;
            end = snapshot.endSeconds;
            break;
        default:
            name = snapshot.kind === 'caption' ? snapshot.text : snapshot.clipName;
            kind = snapshot.kind === 'cut' ? 'カット'
                : snapshot.kind === 'caption' ? '字幕'
                    : snapshot.kind === 'audio' ? '音声'
                        : snapshot.kind === 'item' ? ({ group: 'グループ', bag: '袋', part: 'パート',
                            caption: '字幕', captions: '字幕', telop: 'テロップ', filter: 'フィルター',
                            media: '素材', item: '素材' }[snapshot.itemKind]) : '素材';
            start = snapshot.outputStart;
            end = 'outputEnd' in snapshot ? snapshot.outputEnd
                : 'duration' in snapshot && start !== undefined ? start + snapshot.duration : undefined;
            source = snapshot.kind === 'cut' ? snapshot.sourcePath ?? snapshot.src
                : snapshot.kind === 'layer' || snapshot.kind === 'item' ? snapshot.src
                    : snapshot.kind === 'overlay' && typeof snapshot.payload.src === 'string' ? snapshot.payload.src : undefined;
    }
    const header = document.createElement('div');
    header.className = 'akari-inspector-selection-header';
    header.setAttribute('data-akari-ui', 'inspector-selection-header');
    const swatch = document.createElement('div');
    swatch.className = 'akari-inspector-selection-thumbnail';
    swatch.setAttribute('data-kind', snapshot.kind);
    swatch.setAttribute('aria-hidden', 'true');
    const detail = document.createElement('div');
    const title = document.createElement('strong');
    title.textContent = name;
    title.title = name;
    const meta = document.createElement('span');
    meta.textContent = `${start !== undefined && end !== undefined ? `${timestamp(start)} – ${timestamp(end)} · ` : ''}${kind}`;
    meta.title = meta.textContent;
    detail.append(title, meta);
    header.append(swatch, detail);
    if (source) void thumbnail(source).then(uri => {
        if (!uri || !header.isConnected) return;
        const image = document.createElement('img');
        image.alt = '';
        image.src = uri;
        swatch.append(image);
    }).catch(() => { /* Keep the kind swatch when a thumbnail is unavailable. */ });
    return header;
}
