import { AssetCatalogViewItem } from './akari-project-protocol';
import { groupCatalogItemsByPack } from './asset-catalog-view';
import { CatalogPack } from './catalog-packs';
import { catalogItemCategoryChipKey, filterCatalogItems } from './catalog-reader';
import { LIBRARY_GROUPS, LibraryCategoryDefinition, LibraryCategoryKey, LibraryGroupDefinition } from './library-home-view';
import { PresetShowcase } from './preset-showcase';

export type LibrarySourceFilter = 'all' | 'own' | 'site' | 'lab';
export const LIBRARY_SOURCE_FILTERS = [
    { key: 'all', label: '全部' }, { key: 'own', label: '自分の' },
    { key: 'site', label: '素材サイト' }, { key: 'lab', label: 'Lab' }
] as const;

/** resolver の分類は再判定しない。リポ同梱の外部索引だけ site として補う。 */
export function libraryItemSource(item: AssetCatalogViewItem): AssetCatalogViewItem['sourceKind'] {
    return item.origin === 'resolver' ? item.sourceKind : 'site';
}

export function includesLibraryLab(source: LibrarySourceFilter): boolean {
    return source === 'all' || source === 'lab';
}

export function filterLibrarySources(items: readonly AssetCatalogViewItem[], source: LibrarySourceFilter): AssetCatalogViewItem[] {
    return items.filter(item => source === 'all' || libraryItemSource(item) === source);
}

export function filterLibraryCatalogItems(
    items: readonly AssetCatalogViewItem[], source: LibrarySourceFilter, query: string, category: string, folder?: string
): AssetCatalogViewItem[] {
    return filterCatalogItems(filterLibrarySources(items, source), query, category)
        .filter(item => folder === undefined || item.folder === folder);
}

export function countLibraryCategory(
    category: LibraryCategoryDefinition, source: LibrarySourceFilter, items: readonly AssetCatalogViewItem[],
    presets: PresetShowcase, transitionCount: number, packs: readonly CatalogPack[]
): number | undefined {
    if (category.status === 'soon') { return undefined; }
    if (category.key === 'transition') { return includesLibraryLab(source) ? transitionCount : 0; }
    if (category.key === 'textstyle' || category.key === 'textanim' || category.key === 'lut') {
        return includesLibraryLab(source) ? presets[category.key].length : 0;
    }
    const filtered = filterLibrarySources(items, source);
    if (category.key === 'pack') { return groupCatalogItemsByPack(filtered, packs).groups.length; }
    return filterCatalogItems(filtered, '', category.chipKey ?? 'all').length;
}

export interface RecentLibraryEntry {
    key: string;
    label: string;
    category: LibraryCategoryKey;
    itemKey: string;
    folder?: string;
    count: number;
}

export const LIBRARY_RANK_WEIGHTS = { favorite: 4, used: 3, own: 2, cached: 1 } as const;

/** 意味の近さを最優先にし、同程度の候補だけ利用実績と出どころで並べる。 */
export function compareLibraryItems(a: AssetCatalogViewItem, b: AssetCatalogViewItem,
    relevance: (item: AssetCatalogViewItem) => number = () => 0): number {
    const time = (value?: string): number => Date.parse(value ?? '') || 0;
    const own = (item: AssetCatalogViewItem): number => item.sourceKind === 'own' || item.sourceKind === 'site' ? LIBRARY_RANK_WEIGHTS.own : 0;
    return relevance(b) - relevance(a)
        || Number(!!b.favorite) * LIBRARY_RANK_WEIGHTS.favorite - Number(!!a.favorite) * LIBRARY_RANK_WEIGHTS.favorite
        || Number(!!b.usageCount) * LIBRARY_RANK_WEIGHTS.used - Number(!!a.usageCount) * LIBRARY_RANK_WEIGHTS.used
        || (b.usageCount ?? 0) - (a.usageCount ?? 0)
        || time(b.lastUsedAt) - time(a.lastUsedAt)
        || own(b) - own(a)
        || Number(b.state === 'cached') * LIBRARY_RANK_WEIGHTS.cached - Number(a.state === 'cached') * LIBRARY_RANK_WEIGHTS.cached
        || time(b.addedAt) - time(a.addedAt)
        || a.key.localeCompare(b.key);
}

export function rankRecentLibraryItems(items: readonly AssetCatalogViewItem[],
    relevance?: (item: AssetCatalogViewItem) => number): AssetCatalogViewItem[] {
    return [...items].sort((a, b) => compareLibraryItems(a, b, relevance));
}

/** 同じフォルダは最新の素材のカテゴリへ導く。0 件なら帯は描画しない。 */
export function recentLibraryEntries(items: readonly AssetCatalogViewItem[], source: LibrarySourceFilter): RecentLibraryEntry[] {
    const candidates = filterLibrarySources(items, source).filter(item =>
        item.origin === 'resolver' && !!item.libraryDir
        && (((item.sourceKind === 'own' || item.sourceKind === 'site')
            && Number.isFinite(Date.parse(item.addedAt ?? ''))) || !!item.usageCount));
    const entries = new Map<string, RecentLibraryEntry>();
    const categories = (LIBRARY_GROUPS as readonly LibraryGroupDefinition[]).flatMap(group => group.categories);
    for (const item of rankRecentLibraryItems(candidates)) {
        const category = categories.find(candidate => candidate.chipKey === catalogItemCategoryChipKey(item));
        if (!category) { continue; }
        const key = item.folder ? `folder:${item.folder}` : `asset:${item.key}`;
        const previous = entries.get(key);
        if (previous) { previous.count++; continue; }
        entries.set(key, {
            key, label: item.folder || item.title, category: category.key as LibraryCategoryKey,
            itemKey: item.key, folder: item.folder || undefined, count: 1
        });
    }
    return [...entries.values()].slice(0, 8);
}
