import type { AssetCatalogViewItem } from './akari-project-protocol';

/** Catalog tags or the established telop- ID distinguish text overlays from other overlays. */
export function isTextTelop(item: Pick<AssetCatalogViewItem, 'category' | 'id' | 'tags'>): boolean {
    return item.category === 'overlay' && (item.tags.includes('telop') || item.id.startsWith('telop-'));
}

export function textTelopItems(items: readonly AssetCatalogViewItem[]): AssetCatalogViewItem[] {
    return items.filter(isTextTelop);
}
