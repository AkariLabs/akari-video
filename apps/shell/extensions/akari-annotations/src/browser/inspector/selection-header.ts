import type { TimelineSelectionSnapshot } from '../timeline-selection-model';

function timestamp(value: number): string {
    const tenths = Math.max(0, Math.round(value * 10));
    return `${String(Math.floor(tenths / 600)).padStart(2, '0')}:${String(Math.floor(tenths / 10) % 60).padStart(2, '0')}.${tenths % 10}`;
}

/** A view of the current snapshot; no additional selection state or thumbnail cache. */
export function createSelectionHeader(
    snapshot: NonNullable<TimelineSelectionSnapshot>,
    thumbnail: (path: string) => Promise<string | undefined>,
    saveMyStyle?: () => void
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
    if (snapshot.kind === 'caption' && saveMyStyle) {
        header.style.gridTemplateColumns = '40px minmax(0, 1fr) 24px';
        const actions = document.createElement('div');
        actions.style.position = 'relative';
        actions.style.width = '24px';
        actions.style.height = '24px';
        const menuButton = document.createElement('button');
        menuButton.type = 'button';
        menuButton.setAttribute('data-akari-my-style-inspector-menu', '');
        menuButton.setAttribute('aria-label', '字幕のその他の操作');
        menuButton.style.position = 'relative';
        menuButton.style.width = '24px';
        menuButton.style.height = '24px';
        menuButton.style.padding = '2px';
        menuButton.style.border = '0';
        menuButton.style.borderRadius = '4px';
        menuButton.style.background = 'transparent';
        menuButton.style.cursor = 'pointer';
        menuButton.setAttribute('aria-haspopup', 'menu');
        menuButton.setAttribute('aria-expanded', 'false');
        menuButton.innerHTML = '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="currentColor"><circle cx="3" cy="8" r="1.3"/><circle cx="8" cy="8" r="1.3"/><circle cx="13" cy="8" r="1.3"/></svg>';
        const tip = document.createElement('span');
        tip.textContent = '字幕のその他の操作';
        tip.setAttribute('data-akari-my-style-inspector-tip', '');
        Object.assign(tip.style, { display: 'none', position: 'absolute', bottom: '100%', right: '0',
            padding: '4px 6px', whiteSpace: 'nowrap', background: 'var(--theia-editor-background)',
            border: '1px solid var(--theia-widget-border)', overflow: 'visible', marginTop: '0', zIndex: '10' });
        menuButton.addEventListener('mouseenter', () => { if (save.hidden) tip.style.display = 'block'; });
        menuButton.addEventListener('mouseleave', () => { tip.style.display = 'none'; });
        menuButton.append(tip);
        const save = document.createElement('button');
        save.type = 'button';
        save.textContent = 'マイスタイルに保存…';
        save.setAttribute('data-akari-my-style-inspector-save', '');
        save.hidden = true;
        save.setAttribute('role', 'menuitem');
        save.style.position = 'absolute';
        save.style.right = '0';
        save.style.top = '100%';
        save.style.zIndex = '10';
        save.style.whiteSpace = 'nowrap';
        save.style.maxWidth = 'none';
        save.style.minWidth = '176px';
        save.style.padding = '7px 10px';
        save.style.textAlign = 'left';
        save.style.background = 'var(--theia-menu-background, var(--theia-editor-background))';
        save.style.color = 'var(--theia-menu-foreground, var(--theia-foreground))';
        save.style.border = '1px solid var(--theia-widget-border)';
        save.style.borderRadius = '5px';
        save.style.boxShadow = '0 6px 18px #0005';
        save.style.cursor = 'pointer';
        save.addEventListener('mouseenter', () => { save.style.background = 'var(--theia-list-hoverBackground)'; });
        save.addEventListener('mouseleave', () => { save.style.background = 'var(--theia-menu-background, var(--theia-editor-background))'; });
        const close = (): void => {
            save.hidden = true;
            menuButton.setAttribute('aria-expanded', 'false');
            document.removeEventListener('pointerdown', outside, true);
            document.removeEventListener('keydown', escape, true);
        };
        const outside = (event: PointerEvent): void => {
            if (!actions.contains(event.target as Node)) close();
        };
        const escape = (event: KeyboardEvent): void => {
            if (event.key === 'Escape') { event.preventDefault(); close(); menuButton.focus(); }
        };
        menuButton.addEventListener('click', () => {
            if (!save.hidden) { close(); return; }
            tip.style.display = 'none';
            save.hidden = false;
            menuButton.setAttribute('aria-expanded', 'true');
            document.addEventListener('pointerdown', outside, true);
            document.addEventListener('keydown', escape, true);
        });
        save.addEventListener('click', () => { close(); saveMyStyle(); });
        actions.append(menuButton, save);
        header.append(actions);
    }
    if (source) void thumbnail(source).then(uri => {
        if (!uri || !header.isConnected) return;
        const image = document.createElement('img');
        image.alt = '';
        image.src = uri;
        swatch.append(image);
    }).catch(() => { /* Keep the kind swatch when a thumbnail is unavailable. */ });
    return header;
}
