import type { AssetCatalogViewItem, LibraryAssetPlacementSource } from './akari-project-protocol';
import type { AssetBinChildNode } from './asset-bin-grouping';
import { classifyMaterialKind, resolveAssetGroupMedia, AssetGroupMedia, MaterialKind } from './asset-group-media';

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

/**
 * 取り寄せる前に置き先を当てる。resolver はカタログの files[] の name をそのまま
 * <ライブラリ>/<category>/<id>/ へ置き、edit.json 側の参照は
 * `assets/<category>/<id>/<name>` で固定なので、名前が分かれば置き先が分かる。
 *
 * これは「先に置いて、届いたら塗り替える」ための下ごしらえで、当てられないもの
 * （名前が一意に決まらない・種別が合わない・置き場からのコピー経路）は undefined を
 * 返す。呼び出し側は従来どおり「取り寄せてから置く」経路へ落とす。
 */
export function plannedLibraryAssetMedia(
    item: Pick<AssetCatalogViewItem, 'origin' | 'category' | 'state' | 'id'
        | 'mediaFile' | 'plannedMediaName' | 'price' | 'machineTags'> & { sourceKind?: AssetCatalogViewItem['sourceKind'] }
): { relativePath: string; kind: MaterialKind; mediaName: string } | undefined {
    if (!canPlaceLibraryAsset(item)) return undefined;
    // 置き場（own / site）はコピー経路で、取り寄せの待ちが無い。当てる必要がない。
    if (item.sourceKind === 'own' || item.sourceKind === 'site') return undefined;
    // 有料は zip 経路（中身は catalog に出ていない）。購入判定も絡むので当てない。
    if (item.machineTags?.includes('tier:pro') || (!item.machineTags?.includes('tier:free') && (item.price ?? 0) > 0)) return undefined;
    const kind: MaterialKind = item.category === 'audio' ? 'audio'
        : item.category === 'broll' ? 'video' : item.category === 'still' ? 'image' : 'other';
    if (kind === 'other') return undefined;
    const id = item.id;
    if (!id || id === '.' || id === '..' || /[\\/]/.test(id)) return undefined;
    const mediaName = item.mediaFile || item.plannedMediaName;
    if (!mediaName || mediaName.startsWith('.') || /[\\/]/.test(mediaName)) return undefined;
    // meta.json や fragment.html を主メディアと見誤らないよう、種別まで一致させる。
    if (classifyMaterialKind(mediaName) !== kind) return undefined;
    if (item.category === 'still' && mediaName.toLowerCase() === 'preview.png') return undefined;
    return { relativePath: `assets/${item.category}/${id}/${mediaName}`, kind, mediaName };
}
