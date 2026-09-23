import type { AiImage, AiTargetKind, AiTileGroup } from '../../common/ai-action-catalog';

export type AiTabView = 'tiles' | 'still' | 'video' | 'transcribe' | 'narration';

/** The generation identity is the authority for whether a visual target can be generated. */
export function aiTargetKindFor(options: {
    hasIdentity: boolean; generationDone?: boolean; generationState?: string;
    audio?: boolean; audioPlanned?: boolean;
}): AiTargetKind {
    if (options.audio) return options.audioPlanned ? 'empty-audio-frame' : 'audio';
    if (!options.hasIdentity) return 'video';
    if (options.generationDone) return 'generated-video';
    return options.generationState === 'planned' ? 'empty-frame' : 'still';
}

export function aiTabAvailabilityFor(options: {
    kind: string; hasIdentity: boolean; groups: readonly AiTileGroup[];
}): { enabled: boolean; forcePanel: boolean } {
    const hasTiles = options.groups.length > 0;
    return {
        enabled: options.hasIdentity || (['cut', 'layer', 'item'].includes(options.kind) && hasTiles),
        forcePanel: options.hasIdentity && !hasTiles
    };
}

/** Preserve the current view only while the same clip remains selected. */
export function aiTabViewFor(options: {
    clipKey: string; previousClipKey?: string; previousView?: AiTabView;
    generationState?: string; generationDone?: boolean; forcePanel?: boolean;
}): AiTabView {
    if (options.forcePanel) return 'video';
    if (options.clipKey === options.previousClipKey && options.previousView) return options.previousView;
    return options.generationDone || ['generating', 'failed', 'stale'].includes(options.generationState ?? '')
        ? 'video' : 'tiles';
}

// The cropped originals are embedded as data URIs so the Theia browser bundle and
// electron-builder app.asar resolve them without a runtime filesystem path.
const images: Record<AiImage, string> = {
    video: 'data:image/webp;base64,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', still: 'data:image/webp;base64,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', transcribe: 'data:image/webp;base64,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', narration: 'data:image/webp;base64,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'
};

export function appendAiTiles(parent: HTMLElement, groups: readonly AiTileGroup[], open: (id: string) => void,
    transcriptDone = false): void {
    const list = document.createElement('div');
    list.className = 'akari-inspector-ai-list';
    for (const group of groups) {
        const section = document.createElement('section');
        section.className = 'akari-inspector-ai-group';
        const heading = document.createElement('h3');
        heading.className = 'akari-inspector-ai-heading';
        heading.textContent = group.group === 'make' ? '作る' : '直す';
        section.appendChild(heading);
        const grid = document.createElement('div');
        grid.className = 'akari-inspector-ai-grid';
        for (const tile of group.tiles) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = `akari-inspector-ai-tile${tile.enabled ? '' : ' akari-inspector-ai-disabled'}`;
            button.setAttribute('data-akari-inspector-ai-tile', tile.id);
            button.setAttribute('aria-disabled', String(!tile.enabled));
            const image = document.createElement('img');
            image.className = 'akari-inspector-ai-image';
            image.src = images[tile.image];
            image.alt = '';
            image.width = 320;
            image.height = 180;
            const title = document.createElement('span');
            title.className = 'akari-inspector-ai-title';
            title.textContent = tile.label;
            button.append(image, title);
            if (tile.id === 'transcribe' && transcriptDone && tile.enabled) {
                const badge = document.createElement('span');
                badge.className = 'akari-inspector-ai-done-badge';
                badge.textContent = '済み';
                button.appendChild(badge);
            }
            if (!tile.enabled && tile.reason) {
                const reason = document.createElement('span');
                reason.className = 'akari-inspector-ai-reason';
                reason.textContent = tile.reason;
                button.appendChild(reason);
            }
            button.addEventListener('click', () => { if (tile.enabled) open(tile.id); });
            grid.appendChild(button);
        }
        section.appendChild(grid);
        list.appendChild(section);
    }
    parent.appendChild(list);
}

export function appendAiBack(parent: HTMLElement, title: string, back: () => void): void {
    const header = document.createElement('div');
    header.className = 'akari-inspector-ai-panel-header';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'akari-inspector-ai-back';
    button.textContent = '← AI';
    button.addEventListener('click', back);
    const heading = document.createElement('h3');
    heading.className = 'akari-inspector-ai-panel-title';
    heading.textContent = title;
    header.append(button, heading);
    parent.appendChild(header);
}
