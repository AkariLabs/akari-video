import type { AssetCatalogViewItem, LibraryAssetPlacementSource } from './akari-project-protocol';
import type { AssetBinChildNode } from './asset-bin-grouping';
import { classifyMaterialKind, resolveAssetGroupMedia, AssetGroupMedia } from './asset-group-media';

export const RESOLVE_LIBRARY_MATERIAL_COMMAND_ID = 'akari.catalog.resolveMaterial';

/** 別の取り込み導線を持つ local を除き、未購入でない音・映像・画像だけを直接配置する。 */
export function canPlaceLibraryAsset(item: Pick<AssetCatalogViewItem, 'origin' | 'category' | 'state'>): boolean {
    return item.origin !== 'local' && item.state !== 'locked' && ['audio', 'broll', 'still'].includes(item.category);
}

export function libraryDragKind(item: Pick<AssetCatalogViewItem, 'category'>): 'asset' | 'overlay' | 'scene3d' {
    return item.category === 'overlay' ? 'overlay' : item.category === 'scene3d' ? 'scene3d' : 'asset';
}

export function canPlaceOverlay(item: Pick<AssetCatalogViewItem, 'origin' | 'category' | 'state'>): boolean {
    return item.origin === 'resolver' && item.category === 'overlay' && item.state !== 'locked';
}

/** 複数テイクの音源は試聴したファイルを選ぶ。meta.json 付きパックは一意解決のみ。 */
export function resolveLibraryAssetMedia(
    item: Pick<AssetCatalogViewItem, 'category' | 'mediaUrl'>,
    children: readonly AssetBinChildNode[]
): AssetGroupMedia {
    const media = resolveAssetGroupMedia(item.category, children);
    if (media.kind !== 'other' || item.category !== 'audio'
        || children.some(child => !child.isDirectory && child.name.toLowerCase() === 'meta.json')) {
        return media;
    }
    let name: string;
    try {
        name = decodeURIComponent(new URL(item.mediaUrl).pathname.split('/').pop() ?? '');
    } catch {
        return { kind: 'other' };
    }
    const matches = children.filter(child => !child.isDirectory && child.name === name
        && classifyMaterialKind(child.name) === 'audio');
    return matches.length === 1 ? { kind: 'audio', mediaName: matches[0].name } : { kind: 'other' };
}

/** list にカタログ収載フラグが無いため own/site の置き場素材だけをコピー経路へ渡す。 */
export function localLibraryAssetPlacementSource(item: AssetCatalogViewItem): LibraryAssetPlacementSource | undefined {
    return item.origin === 'resolver' && item.libraryDir && (item.sourceKind === 'own' || item.sourceKind === 'site')
        ? { category: item.category, id: item.id, libraryDir: item.libraryDir }
        : undefined;
}
