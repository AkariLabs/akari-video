import type { InspectorStorage } from './section-model';

export interface InspectorTabDef {
    id: string;
    label: string;
    enabled: boolean;
    disabledTitle?: string;
}

export type InspectorTabKind = 'cut' | 'layer' | 'overlay' | 'item' | 'caption' | 'audio' | 'world';

export interface InspectorTabSnapshotHints {
    src?: unknown;
    generationAvailable?: boolean;
}

const VIDEO_TAB = { id: 'video', label: '映像', enabled: true } as const;
const INFO_TAB = { id: 'info', label: '情報', enabled: true } as const;

export function tabsForKind(
    kind: InspectorTabKind,
    snapshotHints: InspectorTabSnapshotHints = {}
): InspectorTabDef[] {
    if (kind === 'world') return [{ id: 'world', label: '地図', enabled: true }, { ...INFO_TAB }];
    if (kind === 'caption') {
        return [
            { id: 'text', label: 'テキスト', enabled: true },
            { ...INFO_TAB }
        ];
    }
    if (kind === 'audio') {
        return [
            { id: 'audio', label: '音声', enabled: true },
            { id: 'generation', label: '編集', enabled: true },
            { ...INFO_TAB }
        ];
    }

    const hasMediaSource = typeof snapshotHints.src === 'string' && snapshotHints.src.length > 0;
    const hasMediaPreview = kind === 'cut' || hasMediaSource;
    return [
        { ...VIDEO_TAB },
        { id: 'adjust', label: '色', enabled: hasMediaPreview },
        { id: 'audio', label: '音声', enabled: hasMediaPreview },
        { id: 'generation', label: '編集', enabled: snapshotHints.generationAvailable === true,
            disabledTitle: 'このクリップで使える編集はまだありません' },
        { ...INFO_TAB }
    ];
}

export function assignSectionToTab(kind: InspectorTabKind, sectionId: string): string {
    const rootId = sectionId.split(':')[0];
    if (rootId === 'info') return 'info';
    if (rootId === 'adjust') return 'adjust';
    if (kind === 'caption') return 'text';
    if (kind === 'audio') return 'audio';
    if (kind === 'world') return 'world';
    if (rootId === 'generation') return 'generation';
    return 'video';
}

export interface InitialInspectorTabOptions {
    kind: InspectorTabKind;
    tabs: readonly InspectorTabDef[];
    persisted?: string | null;
    generationTodo: boolean;
    explicitTabId?: string;
    clipKey?: string;
    previousClipKey?: string;
    currentTab?: string;
}

/** Selection policy only: no storage, DOM or asynchronous state reads. */
export function initialTabFor(options: InitialInspectorTabOptions): string {
    const { tabs, persisted, generationTodo, explicitTabId, clipKey, previousClipKey, currentTab } = options;
    const enabled = (id: string | null | undefined): string | undefined =>
        tabs.find(tab => tab.id === id && tab.enabled)?.id;
    const fallback = (): string => enabled(persisted) ?? tabs.find(tab => tab.enabled)?.id ?? '';
    if (explicitTabId) return enabled(explicitTabId) ?? fallback();
    if (clipKey !== undefined && clipKey === previousClipKey && currentTab) {
        return enabled(currentTab) ?? fallback();
    }
    if (generationTodo && enabled('generation')) return 'generation';
    if (persisted === 'generation' || currentTab === 'generation') {
        return enabled('generation') ?? tabs.find(tab => tab.enabled)?.id ?? '';
    }
    return fallback();
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

export const COMING_SOON_ADJUST_SECTIONS = [] as const;

export const ACTIVE_ADJUST_SECTIONS = ['基本補正', 'RGB カーブ', 'カラーホイール', 'Hue カーブ', 'LUT', 'エフェクト'] as const;
