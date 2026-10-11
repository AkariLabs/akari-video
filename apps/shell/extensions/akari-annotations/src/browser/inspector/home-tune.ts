import { t } from '@akari-video/i18n';
import type { InspectorTabDef, InspectorTabKind } from './tab-model';
import { images } from './ai-tiles';

export interface HomeTuneTile {
    id: string;
    label: string;
    tabId: string;
    sectionId?: string;
    enabled: boolean;
    reason?: string;
}

export function homeTuneTiles(kind: InspectorTabKind, tabs: readonly InspectorTabDef[]): HomeTuneTile[] {
    if (!['cut', 'layer', 'overlay', 'item', 'audio'].includes(kind)) return [];
    const choices: Omit<HomeTuneTile, 'enabled' | 'reason'>[] = kind === 'audio'
        ? [{ id: 'volume', label: t('inspector.homeTune.label.volume'), tabId: 'audio' }]
        : [
            { id: 'position', label: t('inspector.homeTune.label.positionSize'), tabId: 'video', sectionId: 'transform' },
            { id: 'color', label: t('inspector.homeTune.label.color'), tabId: 'adjust' },
            { id: 'volume', label: t('inspector.homeTune.label.volume'), tabId: 'audio' },
            { id: 'motion', label: t('inspector.homeTune.label.motion'), tabId: 'motion' }
        ];
    return choices.map(choice => {
        const enabled = tabs.find(tab => tab.id === choice.tabId)?.enabled === true;
        return { ...choice, enabled, ...(!enabled ? { reason: t('inspector.homeTune.reason.availableVideoAssets') } : {}) };
    });
}

export function appendHomeTuneTiles(parent: HTMLElement, tiles: readonly HomeTuneTile[],
    open: (target: { tabId: string; sectionId?: string }) => void): void {
    if (tiles.length === 0) return;
    const section = document.createElement('section');
    section.className = 'akari-inspector-section akari-inspector-ai-group';
    section.setAttribute('data-akari-ui', 'section:inspector-home-tune');
    const heading = document.createElement('h3');
    heading.className = 'akari-inspector-section-header akari-inspector-ai-heading';
    heading.textContent = t('inspector.homeTune.text.adjust');
    const grid = document.createElement('div');
    grid.className = 'akari-inspector-section-body akari-inspector-ai-grid';
    for (const tile of tiles) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `akari-inspector-ai-tile akari-inspector-home-tune-tile${tile.enabled ? '' : ' akari-inspector-ai-disabled'}`;
        button.setAttribute('data-akari-home-tune', tile.id);
        button.setAttribute('aria-disabled', String(!tile.enabled));
        const image = document.createElement('img');
        image.className = 'akari-inspector-ai-image';
        image.src = images[tile.id as 'position' | 'color' | 'volume' | 'motion'];
        image.alt = '';
        image.width = 320;
        image.height = 180;
        const titleRow = document.createElement('span');
        titleRow.className = 'akari-inspector-ai-title-row';
        const label = document.createElement('span');
        label.className = 'akari-inspector-ai-title';
        label.textContent = tile.label;
        titleRow.appendChild(label);
        button.append(image, titleRow);
        if (tile.reason) {
            const reason = document.createElement('span');
            reason.className = 'akari-inspector-ai-reason';
            reason.textContent = tile.reason;
            button.appendChild(reason);
        }
        button.addEventListener('click', () => { if (tile.enabled) open({ tabId: tile.tabId, sectionId: tile.sectionId }); });
        grid.appendChild(button);
    }
    section.append(heading, grid);
    parent.appendChild(section);
}
