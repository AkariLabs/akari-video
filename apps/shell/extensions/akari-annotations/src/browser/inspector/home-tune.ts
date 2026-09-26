import type { InspectorTabDef, InspectorTabKind } from './tab-model';
import { createInspectorIcon } from './icons';

export interface HomeTuneTile {
    id: string;
    label: string;
    icon: 'scrub' | 'diamond' | 'plateLine' | 'jump';
    tabId: string;
    sectionId?: string;
    enabled: boolean;
    reason?: string;
}

export function homeTuneTiles(kind: InspectorTabKind, tabs: readonly InspectorTabDef[]): HomeTuneTile[] {
    if (!['cut', 'layer', 'overlay', 'item', 'audio'].includes(kind)) return [];
    const choices: Omit<HomeTuneTile, 'enabled' | 'reason'>[] = kind === 'audio'
        ? [{ id: 'volume', label: '音量', icon: 'plateLine', tabId: 'audio' }]
        : [
            { id: 'position', label: '位置と大きさ', icon: 'scrub', tabId: 'video', sectionId: 'transform' },
            { id: 'color', label: '色', icon: 'diamond', tabId: 'adjust' },
            { id: 'volume', label: '音量', icon: 'plateLine', tabId: 'audio' },
            { id: 'motion', label: '動き', icon: 'jump', tabId: 'motion' }
        ];
    return choices.map(choice => {
        const enabled = tabs.find(tab => tab.id === choice.tabId)?.enabled === true;
        return { ...choice, enabled, ...(!enabled ? { reason: '映像の素材で使えます' } : {}) };
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
    heading.textContent = '整える';
    const grid = document.createElement('div');
    grid.className = 'akari-inspector-section-body akari-inspector-ai-grid';
    for (const tile of tiles) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `akari-inspector-ai-tile akari-inspector-home-tune-tile${tile.enabled ? '' : ' akari-inspector-ai-disabled'}`;
        button.setAttribute('data-akari-home-tune', tile.id);
        button.setAttribute('aria-disabled', String(!tile.enabled));
        button.style.minHeight = '70px';
        const icon = createInspectorIcon(tile.icon);
        icon.style.margin = '8px 10px 2px';
        const label = document.createElement('span');
        label.className = 'akari-inspector-ai-title';
        label.textContent = tile.label;
        button.append(icon, label);
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
