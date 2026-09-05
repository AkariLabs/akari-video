import type { InspectorStorage } from './section-model';

export interface InspectorTabDef {
    id: string;
    label: string;
    enabled: boolean;
}

export type InspectorTabKind = 'cut' | 'layer' | 'overlay' | 'item' | 'caption' | 'audio';

export interface InspectorTabSnapshotHints {
    src?: unknown;
}

const VIDEO_TAB = { id: 'video', label: '動画', enabled: true } as const;
const INFO_TAB = { id: 'info', label: '情報', enabled: true } as const;

export function tabsForKind(
    kind: InspectorTabKind,
    snapshotHints: InspectorTabSnapshotHints = {}
): InspectorTabDef[] {
    if (kind === 'caption') {
        return [
            { id: 'text', label: 'テキスト', enabled: true },
            { ...INFO_TAB }
        ];
    }
    if (kind === 'audio') {
        return [
            { id: 'audio', label: '音声', enabled: true },
            { ...INFO_TAB }
        ];
    }

    const hasMediaSource = typeof snapshotHints.src === 'string' && snapshotHints.src.length > 0;
    const hasMediaPreview = kind === 'cut' || hasMediaSource;
    return [
        { ...VIDEO_TAB },
        { id: 'adjust', label: '調整', enabled: hasMediaPreview },
        { id: 'audio', label: '音声', enabled: hasMediaPreview },
        { ...INFO_TAB }
    ];
}

export function assignSectionToTab(kind: InspectorTabKind, sectionId: string): string {
    const rootId = sectionId.split(':')[0];
    if (rootId === 'info') return 'info';
    if (rootId === 'adjust') return 'adjust';
    if (kind === 'caption') return 'text';
    if (kind === 'audio') return 'audio';
    return 'video';
}

export class InspectorTabState {
    constructor(
        protected readonly storage: InspectorStorage,
        protected readonly prefix = 'akari.inspector.tab.v1'
    ) { }

    activeTab(kind: string, tabs: readonly InspectorTabDef[]): string {
        const saved = this.storage.getItem(`${this.prefix}:${kind}`);
        const savedTab = tabs.find(tab => tab.id === saved && tab.enabled);
        return savedTab?.id ?? tabs.find(tab => tab.enabled)?.id ?? '';
    }

    setActiveTab(kind: string, tabId: string): void {
        this.storage.setItem(`${this.prefix}:${kind}`, tabId);
    }
}

export const COMING_SOON_ADJUST_SECTIONS = [
    'RGB カーブ',
    'カラーホイール',
    'Hue カーブ',
    'エフェクト'
] as const;

export const ACTIVE_ADJUST_SECTIONS = ['基本補正', 'LUT'] as const;
