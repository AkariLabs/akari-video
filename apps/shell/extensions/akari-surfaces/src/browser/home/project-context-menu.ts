import { t } from '@akari-video/i18n';

export type ProjectContextMenuAction = 'open' | 'copy-path';

export interface ProjectContextMenuItem {
    readonly id: ProjectContextMenuAction;
    readonly label: string;
    readonly icon: string;
}

/** プロジェクトの右クリックメニュー。いま開いているプロジェクトには「開く」を出さない。 */
export function projectContextMenuItems(row: { readonly current?: boolean }): ProjectContextMenuItem[] {
    return [
        ...(row.current ? [] : [{ id: 'open' as const, label: t('surfaces.projects.contextMenuOpenProject.action'), icon: 'folder-opened' }]),
        { id: 'copy-path', label: t('surfaces.projects.contextMenuCopyPath.action'), icon: 'copy' }
    ];
}
