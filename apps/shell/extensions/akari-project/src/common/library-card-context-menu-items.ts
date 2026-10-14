import { t } from '../common/project-text';
import { AssetCatalogViewItem } from './akari-project-protocol';
import { MaterialContextMenuItem } from './material-context-menu-items';

export function libraryCardContextMenuItems(item: AssetCatalogViewItem): MaterialContextMenuItem[] {
    if (!item.libraryDir || item.origin !== 'resolver') return [];
    return [
        { id: 'reveal', label: t('project.library.menu.reveal') },
        { id: 'remove-library', label: t('project.library.menu.remove'), danger: true }
    ];
}

export function libraryRemovalWarning(item: Pick<AssetCatalogViewItem, 'sourceKind' | 'title'>, projects: readonly string[]): string {
    const names = projects.slice(0, 3).map(project => project.replace(/[\\/]+$/, '').split(/[\\/]/).pop());
    const used = projects.length ? t('project.library.cardMenu.usedLengthProjectsLabel', { length: projects.length, n: projects.length, value2: names.join('、') }) : t('project.library.cardMenu.notUsedAnyProjectsMessage');
    return t('project.library.cardMenu.usedMoveTrashMessage', { used: used, value2: item.sourceKind === 'own' || item.sourceKind === 'site' ? t('project.library.cardMenu.cannotBeDownloadedAgainError') : '' });
}
