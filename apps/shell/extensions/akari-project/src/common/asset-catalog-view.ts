/**
 * カタログ面「1 ビュー」の純関数群（ビューのマージ・resolver 生アイテムの正規化・
 * 状態→バッジ文言）。node/browser のどちらからも import される想定のため、
 * node: 組み込みモジュールには依存しない（ファイルシステム/ネットワークが要る処理は
 * ここに置かない — resolveResolverPreviewUrl は src/node/resolver-preview-url.ts 側）。
 */

import { AssetCatalogViewItem } from './akari-project-protocol';

/** resolver カタログの files[] 1 件（akari-assets-catalog/v0 契約: url か key のどちらかを持つ）。 */
export interface ResolverRawCatalogFile {
    name?: string;
    url?: string;
    key?: string;
}

/** resolver 合成カタログ（packages/asset-resolver の composeState()）1 件の生スキーマ。 */
export interface ResolverRawCatalogItem {
    id: string;
    category: string;
    title: string;
    tags?: string[];
    license?: { spdx?: string };
    price?: number | null;
    state?: 'cached' | 'available' | 'locked';
    provenance?: { prompt?: string };
    /** 実体ファイル一覧。mediaUrl（試聴用）の選定元 — selectResolverAudioFileRef を参照。 */
    files?: ResolverRawCatalogFile[];
}

const AUDIO_FILE_EXTENSIONS = /\.(mp3|wav|m4a|ogg)$/i;

/**
 * resolver の生アイテムの files[] から試聴用の音声ファイル参照（url か base 相対 key）を選ぶ。
 * audio カテゴリでのみ意味を持つ（他カテゴリは常に undefined — サムネ用の preview
 * フィールドと混同しないため、files[] だけを見る）。複数ファイル（バリエーション違い等）が
 * あるときは、音声拡張子（.mp3/.wav/.m4a/.ogg）に一致する先頭の 1 件を採用する。
 */
export function selectResolverAudioFileRef(item: Pick<ResolverRawCatalogItem, 'category' | 'files'>): string | undefined {
    if (item.category !== 'audio') {
        return undefined;
    }
    const match = item.files?.find(file => AUDIO_FILE_EXTENSIONS.test(file.name ?? ''));
    return match?.url ?? match?.key;
}

/**
 * resolver の生アイテムを 1 ビューの共通行へ正規化する。previewUrl / mediaUrl はファイル
 * システム/ネットワークに触れずに済むよう、呼び出し側が事前に確定させた値を渡す
 * （src/node/resolver-preview-url.ts の resolveResolverPreviewUrl を想定。mediaUrl も
 * 同じ解決規則で組み立てるため同じ関数を再利用してよい — selectResolverAudioFileRef が
 * 返す url/key 文字列は previewUrl の入力と同じ形をしている）。
 */
export function toResolverAssetCatalogViewItem(item: ResolverRawCatalogItem, previewUrl: string | undefined, mediaUrl?: string): AssetCatalogViewItem {
    return {
        origin: 'resolver',
        key: `${item.category}/${item.id}`,
        id: item.id,
        category: item.category,
        title: item.title,
        tags: item.tags ?? [],
        licenseSpdx: item.license?.spdx,
        price: item.price ?? 0,
        state: item.state,
        previewUrl,
        mediaUrl,
        prompt: item.provenance?.prompt
    };
}

/**
 * 1 ビューのマージ。`${category}/${id}`（= AssetCatalogViewItem.key）で重複排除し、
 * resolver 側を優先する（同じ id がローカル catalog/ と resolver 側の両方に存在する
 * 移行期でも壊れないように）。表示直前のタイトル五十音順ソートまで含む。
 */
export function mergeAssetCatalogViews(
    localItems: readonly AssetCatalogViewItem[],
    resolverItems: readonly AssetCatalogViewItem[]
): AssetCatalogViewItem[] {
    const merged = new Map<string, AssetCatalogViewItem>();
    for (const item of localItems) {
        merged.set(item.key, item);
    }
    for (const item of resolverItems) {
        merged.set(item.key, item);
    }
    return Array.from(merged.values()).sort((left, right) => left.title.localeCompare(right.title, 'ja'));
}

/**
 * カード状態バッジの短い表示文言。origin='local'（state undefined）は
 * バッジを持たないので undefined を返す（呼び出し側はバッジ自体を出さない）。
 */
export function assetStateBadgeText(item: Pick<AssetCatalogViewItem, 'state' | 'price'>): string | undefined {
    if (!item.state) {
        return undefined;
    }
    if (item.state === 'locked') {
        return `¥${(item.price ?? 0).toLocaleString()}`;
    }
    return item.state === 'cached' ? '✓' : '☁';
}
