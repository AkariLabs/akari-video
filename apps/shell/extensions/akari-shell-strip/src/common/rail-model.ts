import {
    AKARI_COMMANDS, RAIL_EXPAND_ID, RAIL_PROJECT_OPENER_ID, RAIL_LIBRARY_OPENER_ID,
    RAIL_SKILLS_WIDGET_ID, RAIL_EXPORT_OPENER_ID, RAIL_DEVELOPER_OPENER_ID,
    RAIL_SETTINGS_OPENER_ID, RAIL_ROLE_BUCKETS_WIDGET_ID, AkariScope
} from './rail-ids';

export interface RailCommand { id: string; args?: { tab?: 'project' | 'library'; section?: 'developer' } }

export function railOpenerCommand(id: string): RailCommand | undefined {
    switch (id) {
        case RAIL_EXPAND_ID: return { id: AKARI_COMMANDS.railToggleExpanded };
        case RAIL_PROJECT_OPENER_ID: return { id: AKARI_COMMANDS.catalogOpen, args: { tab: 'project' } };
        case RAIL_LIBRARY_OPENER_ID: return { id: AKARI_COMMANDS.catalogOpen, args: { tab: 'library' } };
        case RAIL_EXPORT_OPENER_ID: return { id: AKARI_COMMANDS.exportOpenDialog };
        case RAIL_DEVELOPER_OPENER_ID: return { id: AKARI_COMMANDS.settingsOpen, args: { section: 'developer' } };
        case RAIL_SETTINGS_OPENER_ID: return { id: AKARI_COMMANDS.settingsOpen };
        default: return undefined;
    }
}

export function railDisabledIds(scope: AkariScope, exportAvailable: boolean): Set<string> {
    const ids = new Set<string>();
    if (scope === 'channel') {
        ids.add(RAIL_PROJECT_OPENER_ID);
        ids.add(RAIL_LIBRARY_OPENER_ID);
        ids.add(RAIL_SKILLS_WIDGET_ID);
    }
    if (scope === 'channel' || !exportAvailable) ids.add(RAIL_EXPORT_OPENER_ID);
    return ids;
}

export function railSelection(catalogTab: string | null, currentId: string | undefined, collapsed: boolean): string | undefined {
    if (collapsed || currentId !== RAIL_ROLE_BUCKETS_WIDGET_ID) return undefined;
    return catalogTab === 'library' ? RAIL_LIBRARY_OPENER_ID : RAIL_PROJECT_OPENER_ID;
}
