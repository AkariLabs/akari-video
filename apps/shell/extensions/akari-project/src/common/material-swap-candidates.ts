import type { AssetCatalogViewItem } from './akari-project-protocol';
import { catalogItemCategoryChipKey } from './catalog-reader';
import { canPlaceLibraryAsset } from './library-asset-placement';

export interface MaterialSwapRequest {
    itemId: string;
    kind: 'audio' | 'visual';
    currentRelativePath: string;
}
export interface SwapCandidate { item: AssetCatalogViewItem; canTry: boolean; }
export interface SwapCandidates { near?: SwapCandidate[]; rest: SwapCandidate[]; }
const compare = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
const family = (id: string): string | undefined => id.match(/^(sfx-[^-]+-|bgm-[^-]+-|br-|bg-)/)?.[0];

/** current は meta.json またはカタログ key と取り込み先の一致で確認した素材。 */
export function rankSwapCandidates(items: readonly AssetCatalogViewItem[], kind: 'audio' | 'visual',
    current?: { id: string; tags: readonly string[] }, currentRelativePath?: string): SwapCandidates {
    const installedKey = currentRelativePath?.match(/^assets\/([^/]+\/[^/]+)\//)?.[1];
    const candidates = items.filter(item => item.id !== current?.id && item.key !== installedKey).filter(item => kind === 'audio'
        ? ['audio:sfx', 'audio:bgm'].includes(catalogItemCategoryChipKey(item))
        : ['broll', 'still'].includes(item.category)).map(item => {
        const canTry = canPlaceLibraryAsset(item);
        const prefix = current && family(current.id);
        return { item, canTry,
            prefix: canTry && prefix && family(item.id) === prefix ? 1 : 0,
            tags: canTry && current ? new Set(item.tags.filter(tag => current.tags.includes(tag))).size : 0 };
    });
    candidates.sort((a, b) => (current ? b.prefix - a.prefix || b.tags - a.tags : 0)
        || compare(a.item.id, b.item.id) || compare(a.item.key, b.item.key));
    const near = current ? candidates.filter(item => item.prefix || item.tags).slice(0, 6) : undefined;
    const rows = (entries: typeof candidates): SwapCandidate[] => entries.map(({ item, canTry }) => ({ item, canTry }));
    return { ...(near ? { near: rows(near) } : {}), rest: rows(candidates.filter(item => !near?.includes(item))
        .sort((a, b) => compare(a.item.id, b.item.id) || compare(a.item.key, b.item.key))) };
}
