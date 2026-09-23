import { AssetCatalogViewItem } from './akari-project-protocol';
import { MaterialContextMenuItem } from './material-context-menu-items';

export function libraryCardContextMenuItems(item: AssetCatalogViewItem): MaterialContextMenuItem[] {
    if (!item.libraryDir || item.origin !== 'resolver') return [];
    return [
        { id: 'reveal', label: 'Finder で場所を見る' },
        { id: 'remove-library', label: 'ライブラリから消す', danger: true }
    ];
}

export function libraryRemovalWarning(item: Pick<AssetCatalogViewItem, 'sourceKind' | 'title'>, projects: readonly string[]): string {
    const names = projects.slice(0, 3).map(project => project.replace(/[\\/]+$/, '').split(/[\\/]/).pop());
    const used = projects.length ? `${projects.length} 本のプロジェクトで使用中（${names.join('、')}）` : '使用中のプロジェクトはありません';
    return `${used}。${item.sourceKind === 'own' || item.sourceKind === 'site' ? '取り直せません。' : ''}ゴミ箱へ移します。`;
}
