/**
 * ライブラリの絞り込み（検索欄の右の 1 個のボタン → 4 節のポップオーバー）の純関数。
 *
 * - 出どころ: 全部 / 自分の / 素材サイト / Lab（旧「出どころの 1 行」をここへ畳んだ。1 つだけ選ぶ）
 * - tier: 無料 / Pro（内部の price キーは既存ウィジェットとの互換のため維持）
 * - ライセンス: 商用 OK / 帰属表示あり / 商用不可（library-license.ts の 2 軸で判定）
 * - 状態: 取得済み / 未取得 / ★
 *
 * 節の中は「どれか」（OR）、節どうしは「すべて」（AND）。何も選ばない節は絞らない。
 * 種類（画像 / 動画…）はカテゴリ側の仕事なので入れない。タグはどこにも出さない（検索語には効く）。
 */
import type { AssetCatalogViewItem } from './akari-project-protocol';
import { libraryItemLicenseAxes } from './library-license';
import { libraryItemSource, LibrarySourceFilter, LIBRARY_SOURCE_FILTERS } from './library-source-view';

export type LibraryPriceFilter = 'free' | 'premium' | 'purchased';
export type LibraryLicenseFilter = 'commercial' | 'attribution' | 'noncommercial';
export type LibraryStatusFilter = 'cached' | 'remote' | 'favorite';

export interface LibraryFilterState {
    source: LibrarySourceFilter;
    price: readonly LibraryPriceFilter[];
    license: readonly LibraryLicenseFilter[];
    status: readonly LibraryStatusFilter[];
}

export const EMPTY_LIBRARY_FILTER: LibraryFilterState = { source: 'all', price: [], license: [], status: [] };

/** 指定された節だけを置き換え、呼び出し元の配列は共有しない。 */
export function applyLibraryFilterPatch(state: LibraryFilterState, patch: Partial<LibraryFilterState>): LibraryFilterState {
    return {
        source: patch.source ?? state.source,
        price: [...(patch.price ?? state.price)],
        license: [...(patch.license ?? state.license)],
        status: [...(patch.status ?? state.status)]
    };
}

export type LibraryFilterSectionKey = 'source' | 'tier' | 'price' | 'license' | 'status';

export interface LibraryFilterSection {
    key: LibraryFilterSectionKey;
    label: string;
    /** true = 1 つだけ選ぶ（出どころ）。false = いくつでも。 */
    single: boolean;
    options: readonly { key: string; label: string }[];
}

export const LIBRARY_FILTER_SECTIONS: readonly LibraryFilterSection[] = [
    { key: 'source', label: '出どころ', single: true, options: LIBRARY_SOURCE_FILTERS },
    { key: 'tier', label: 'tier', single: false, options: [
        { key: 'free', label: '無料' }, { key: 'premium', label: 'Pro' }] },
    { key: 'license', label: 'ライセンス', single: false, options: [
        { key: 'commercial', label: '商用 OK' }, { key: 'attribution', label: '帰属表示あり' }, { key: 'noncommercial', label: '商用不可' }] },
    { key: 'status', label: '状態', single: false, options: [
        { key: 'cached', label: '取得済み' }, { key: 'remote', label: '未取得' }, { key: 'favorite', label: 'お気に入り' }] }
];

/** 絞り込み中の条件の数（ボタンの件数の座布団）。0 なら座布団を出さない。 */
export function libraryFilterCount(filter: LibraryFilterState): number {
    return (filter.source !== 'all' ? 1 : 0) + filter.price.length + filter.license.length + filter.status.length;
}

export function isLibraryFilterOptionOn(filter: LibraryFilterState, section: LibraryFilterSectionKey, option: string): boolean {
    return section === 'source' ? filter.source === option : (filter[section === 'tier' ? 'price' : section] as readonly string[]).includes(option);
}

/** チップを押したときの次の状態。出どころは押し直しで「全部」へ戻す。 */
export function toggleLibraryFilterOption(filter: LibraryFilterState, section: LibraryFilterSectionKey, option: string): LibraryFilterState {
    if (section === 'source') {
        const next = (filter.source === option ? 'all' : option) as LibrarySourceFilter;
        return { ...filter, source: next };
    }
    const field = section === 'tier' ? 'price' : section;
    const current = filter[field] as readonly string[];
    const values = current.includes(option) ? current.filter(value => value !== option) : [...current, option];
    return { ...filter, [field]: values };
}

/**
 * tier の区分。resolver は machineTags の tier を優先し、旧データは price で読む。
 * purchased は従来の内部状態名として残す。Pro フィルタには未契約と契約済みの両方を含む。
 */
export function libraryItemPrice(item: Pick<AssetCatalogViewItem, 'origin' | 'state' | 'price' | 'distribution' | 'machineTags'>): LibraryPriceFilter | 'external' {
    if (item.origin === 'resolver') {
        if (item.state === 'locked') return 'premium';
        if (item.machineTags?.includes('tier:pro')) return 'purchased';
        if (item.machineTags?.includes('tier:free')) return 'free';
        return (item.price ?? 0) > 0 ? 'purchased' : 'free';
    }
    return item.distribution === 'paid' || item.distribution === 'subscription' ? 'external' : 'free';
}

/** 取得済み = 手元にある（resolver の cached / ローカル索引の同梱済み）。 */
export function isLibraryItemCached(item: Pick<AssetCatalogViewItem, 'origin' | 'state' | 'installed'>): boolean {
    return item.origin === 'resolver' ? item.state === 'cached' : item.installed === true;
}

export function isPremiumLocked(item: Pick<AssetCatalogViewItem, 'origin' | 'state'>): boolean {
    return item.origin === 'resolver' && item.state === 'locked';
}

function matchesLicense(item: AssetCatalogViewItem, wanted: readonly LibraryLicenseFilter[]): boolean {
    const axes = libraryItemLicenseAxes(item);
    return wanted.some(value => value === 'commercial' ? axes.commercial === 'allowed'
        : value === 'attribution' ? axes.attributionRequired === true
            : axes.commercial === 'prohibited');
}

export function matchesLibraryFilter(item: AssetCatalogViewItem, filter: LibraryFilterState, favorites: ReadonlySet<string>): boolean {
    if (filter.source !== 'all' && libraryItemSource(item) !== filter.source) return false;
    const itemTier = libraryItemPrice(item);
    if (filter.price.length && !filter.price.includes(itemTier as LibraryPriceFilter)
        && !(itemTier === 'purchased' && filter.price.includes('premium'))) return false;
    if (filter.license.length && !matchesLicense(item, filter.license)) return false;
    if (filter.status.length) {
        const cached = isLibraryItemCached(item);
        const ok = filter.status.some(value => value === 'cached' ? cached
            : value === 'remote' ? !cached : favorites.has(item.key));
        if (!ok) return false;
    }
    return true;
}

export function filterLibraryItems(items: readonly AssetCatalogViewItem[], filter: LibraryFilterState,
    favorites: ReadonlySet<string>): AssetCatalogViewItem[] {
    return items.filter(item => matchesLibraryFilter(item, filter, favorites));
}

/**
 * 同梱のプリセット（テキストスタイル・テキストアニメ・LUT・トランジション）とマイスタイルの判定。
 * どれも手元にある無料の標準素材として扱う（マイスタイルは「自分の」）。key は `<種類>/<id>`。
 */
export function presetMatchesLibraryFilter(key: string, filter: LibraryFilterState, favorites: ReadonlySet<string>,
    source: 'lab' | 'own' = 'lab'): boolean {
    if (filter.source !== 'all' && filter.source !== source) return false;
    if (filter.price.length && !filter.price.includes('free')) return false;
    if (filter.license.length && !filter.license.includes('commercial')) return false;
    if (filter.status.length && !filter.status.some(value => value === 'cached' || (value === 'favorite' && favorites.has(key)))) return false;
    return true;
}
