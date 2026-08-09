/**
 * カタログ面「1 ビュー」の純関数群（ビューのマージ・resolver 生アイテムの正規化・
 * 状態→バッジ文言）。node/browser のどちらからも import される想定のため、
 * node: 組み込みモジュールには依存しない（ファイルシステム/ネットワークが要る処理は
 * ここに置かない — resolveResolverPreviewUrl は src/node/resolver-preview-url.ts 側）。
 */

import { AssetCatalogResolverStatus, AssetCatalogViewItem } from './akari-project-protocol';
import { CatalogPack } from './catalog-packs';

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

/** カタログ面の空状態の原因分岐（catalog-account-first-ux task.md §2）。 */
export type CatalogEmptyStateKind = 'resolver-failed' | 'empty' | 'items';

/**
 * 空状態の原因を判定する純関数。1 件でも表示できる項目があれば 'items'
 * （resolver / ローカル catalog/ のどちらが由来かは問わない）。0 件のときだけ、
 * resolver の取得状態で「取得失敗（オフライン等）」と「取得できたが 0 件（通常起きない）」を
 * 分ける。ローカル catalog/ 未設定はここでは判定しない（一般ユーザーの正常系であり
 * resolver の可用性とは独立した概念のため — 呼び出し側は resolverStatus のみを渡す）。
 */
export function deriveCatalogEmptyStateKind(
    itemCount: number,
    resolverStatus: AssetCatalogResolverStatus['status']
): CatalogEmptyStateKind {
    if (itemCount > 0) {
        return 'items';
    }
    return resolverStatus === 'failed' ? 'resolver-failed' : 'empty';
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

// --- origin='local' の分類バッジ（同梱 / サブスク / 各自入手 / 無料 DL） ---------------------

/** origin='local' アイテムの入手分類。カテゴリ非依存（font 専用にしない）。 */
export type AssetDistribution = 'bundled' | 'subscription' | 'paid' | 'free';

export interface AssetDistributionInput {
    /** `assets/<category>/<id>/` の実体有無。 */
    installed: boolean;
    /** meta.json license.scope。 */
    licenseScope?: string;
    /** meta.json remote（外部から都度取得する参照配布アイテムかどうか）。 */
    remote?: boolean;
    tags?: readonly string[];
}

const PAID_LICENSE_SCOPE = 'paid-license-required';

/**
 * 4 分類の導出順（task.md §2 が定める優先順）:
 * 1. installed → bundled（実体が既にある。他の条件より常に優先）
 * 2. license.scope === "paid-license-required" → tags に "subscription" があれば subscription、
 *    なければ paid
 * 3. remote === true → free
 * 4. どれにも当てはまらない（installed でも remote でも paid-license でもない）→ undefined
 *    （バッジ自体を出さない。ローカル catalog/ の設計上ほぼ発生しない想定だが、
 *    寛容リーダー流儀としてここでも落とさない）
 */
export function deriveAssetDistribution(input: AssetDistributionInput): AssetDistribution | undefined {
    if (input.installed) {
        return 'bundled';
    }
    if (input.licenseScope === PAID_LICENSE_SCOPE) {
        return (input.tags ?? []).includes('subscription') ? 'subscription' : 'paid';
    }
    if (input.remote === true) {
        return 'free';
    }
    return undefined;
}

/**
 * 分類バッジの表示文言。free のみ sourceAcquisition が要る（"login" のとき「要登録」を付す）。
 * distribution が undefined のときは呼び出し側がバッジ自体を出さない（assetStateBadgeText と対称）。
 */
export function assetDistributionBadgeText(distribution: AssetDistribution | undefined, sourceAcquisition?: string): string | undefined {
    switch (distribution) {
        case 'bundled': return '✓ 同梱済み';
        case 'subscription': return 'サブスク';
        case 'paid': return '¥ 各自入手';
        case 'free': return sourceAcquisition === 'login' ? '☁ 無料 DL（要登録）' : '☁ 無料 DL';
        default: return undefined;
    }
}

// --- パック棚（同じ pack:<id> タグを持つカード群のグループ表示） -----------------------------

const PACK_TAG_PREFIX = 'pack:';

/** アイテムの tags から `pack:<id>` タグの `<id>` 部分を全件抽出する（複数所属を許す）。 */
export function catalogItemPackIds(item: Pick<AssetCatalogViewItem, 'tags'>): string[] {
    return (item.tags ?? [])
        .filter(tag => tag.startsWith(PACK_TAG_PREFIX))
        .map(tag => tag.slice(PACK_TAG_PREFIX.length))
        .filter(id => id.length > 0);
}

export interface CatalogPackGroup {
    pack: CatalogPack;
    items: AssetCatalogViewItem[];
}

export interface CatalogPackGroupingResult {
    groups: CatalogPackGroup[];
    /** どの pack にも属さない（または未知の pack id を指す）アイテム。従来どおりセクション外に並ぶ。 */
    ungrouped: AssetCatalogViewItem[];
}

/**
 * items を packs.json の並び順でグループ化する。packs.json に無い id を指す
 * `pack:<id>` タグは無視して ungrouped 側へ落とす（壊れたタグ参照で落ちない）。
 * 1 件のアイテムが複数の pack タグを持つ場合はそれぞれのセクションに重複して現れる
 * （ungrouped には入らない）。空の pack（該当アイテムなし）はセクション自体を作らない。
 */
export function groupCatalogItemsByPack(
    items: readonly AssetCatalogViewItem[],
    packs: readonly CatalogPack[]
): CatalogPackGroupingResult {
    const packById = new Map(packs.map(pack => [pack.id, pack]));
    const itemsByPackId = new Map<string, AssetCatalogViewItem[]>();
    const ungrouped: AssetCatalogViewItem[] = [];
    for (const item of items) {
        const packIds = catalogItemPackIds(item).filter(id => packById.has(id));
        if (!packIds.length) {
            ungrouped.push(item);
            continue;
        }
        for (const packId of packIds) {
            const bucket = itemsByPackId.get(packId);
            if (bucket) {
                bucket.push(item);
            } else {
                itemsByPackId.set(packId, [item]);
            }
        }
    }
    const groups: CatalogPackGroup[] = [];
    for (const pack of packs) {
        const bucket = itemsByPackId.get(pack.id);
        if (bucket?.length) {
            groups.push({ pack, items: bucket });
        }
    }
    return { groups, ungrouped };
}

export interface CatalogPackBreakdown {
    total: number;
    bundled: number;
    free: number;
    paid: number;
    subscription: number;
}

/** パック 1 件分の内訳集計（ヘッダ表示用）。distribution 未導出（undefined）は total にのみ数える。 */
export function summarizeCatalogPackDistribution(items: readonly Pick<AssetCatalogViewItem, 'distribution'>[]): CatalogPackBreakdown {
    const breakdown: CatalogPackBreakdown = { total: items.length, bundled: 0, free: 0, paid: 0, subscription: 0 };
    for (const item of items) {
        switch (item.distribution) {
            case 'bundled': breakdown.bundled++; break;
            case 'free': breakdown.free++; break;
            case 'paid': breakdown.paid++; break;
            case 'subscription': breakdown.subscription++; break;
            default: break;
        }
    }
    return breakdown;
}

const PACK_BREAKDOWN_LABEL: Record<'bundled' | 'free' | 'paid' | 'subscription', string> = {
    bundled: '同梱',
    free: '無料 DL',
    paid: '¥ 各自入手',
    subscription: 'サブスク'
};

/**
 * パックヘッダの内訳文言（例: "23 件 — 同梱 9 / 無料 DL 14"）。0 件の分類は出さない。
 * 単位は「書体」等カテゴリ固有の語にせず汎用の「件」に統一する（パックはカテゴリ非依存の
 * 仕組みのため — task.md の例は font パックでの一例）。
 */
export function formatCatalogPackBreakdown(breakdown: CatalogPackBreakdown): string {
    const parts = (['bundled', 'free', 'paid', 'subscription'] as const)
        .filter(key => breakdown[key] > 0)
        .map(key => `${PACK_BREAKDOWN_LABEL[key]} ${breakdown[key]}`);
    return parts.length ? `${breakdown.total} 件 — ${parts.join(' / ')}` : `${breakdown.total} 件`;
}
