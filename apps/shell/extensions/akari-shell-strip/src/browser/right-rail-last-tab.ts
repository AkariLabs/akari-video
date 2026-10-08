export const RIGHT_RAIL_LAST_TAB_KEY = 'akari.rightRail.lastTab';
export type RightRailLastTab = 'inspector' | 'chat' | 'script' | 'annotations';

export function rightRailLogicalTab(widgetId: string): RightRailLastTab | undefined {
    if (widgetId === 'akari-inspector-widget') return 'inspector';
    if (widgetId === 'akari-daihon-widget') return 'script';
    if (widgetId === 'akari-review-panel-widget') return 'annotations';
    if (widgetId.startsWith('terminal-') || widgetId === 'akari-partner-web' ||
        widgetId === 'akari-partner-onboarding') return 'chat';
    return undefined;
}

export function rightRailWidgetForTab(tab: RightRailLastTab, ids: readonly string[]): string | undefined {
    if (tab === 'chat') return ids.find(id => id.startsWith('terminal-')) ??
        ids.find(id => id === 'akari-partner-web') ?? ids.find(id => id === 'akari-partner-onboarding');
    const wanted = tab === 'inspector' ? 'akari-inspector-widget' :
        tab === 'script' ? 'akari-daihon-widget' : 'akari-review-panel-widget';
    return ids.find(id => id === wanted);
}

export function readRightRailLastTab(storage: Pick<Storage, 'getItem'>): RightRailLastTab | undefined {
    const value = storage.getItem(RIGHT_RAIL_LAST_TAB_KEY);
    return value === 'inspector' || value === 'chat' || value === 'script' || value === 'annotations'
        ? value : undefined;
}
