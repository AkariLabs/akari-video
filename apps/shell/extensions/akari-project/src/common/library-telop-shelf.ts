import type { AssetCatalogViewItem } from './akari-project-protocol';

/** Catalog tags or the established telop- ID distinguish text overlays from other overlays. */
export function isTelopAsset(item: Pick<AssetCatalogViewItem, 'category' | 'id' | 'tags'>): boolean {
    return item.category === 'overlay' && (item.tags.includes('telop') || item.id.startsWith('telop-'));
}

export function textTelopItems(items: readonly AssetCatalogViewItem[]): AssetCatalogViewItem[] {
    return items.filter(isTelopAsset);
}

export function catalogItemsWithoutShelvedTelops(
    items: readonly AssetCatalogViewItem[], category: string, query: string
): AssetCatalogViewItem[] {
    return category === 'overlay' && !query.trim() ? items.filter(item => !isTelopAsset(item)) : [...items];
}
