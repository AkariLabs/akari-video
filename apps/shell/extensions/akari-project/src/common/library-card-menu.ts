/**
 * ライブラリのカードの「右クリック = 操作のメニュー」と「⋯ = 情報カード」の中身を組む純関数。
 *
 * カードは「顔 + 名前 + ⋯」だけにしたので、＋（プレイヘッドに置く）と「使う」（取り込む）は
 * ここへ畳む。どの素材にも同じ形のメニューを出し、既存の経路が無い操作は出さない。
 * 呼び出し側（ウィジェット）が id ごとに実処理へ振り分ける。
 */
import type { AssetCatalogViewItem } from './akari-project-protocol';
import { canPlaceLibraryAsset } from './library-asset-placement';
import { isPremiumLocked, libraryItemPrice } from './library-filter';
import { LAB_PREMIUM_SPDX, LibraryLicenseSheet, libraryLicenseSheet } from './library-license';
import { libraryItemSource, LibrarySourceFilter } from './library-source-view';

export type LibraryMenuActionId =
    | 'place' | 'import' | 'agent-import' | 'ask' | 'lab' | 'place-text' | 'apply'
    | 'favorite' | 'info' | 'reveal' | 'remove-library' | 'rename' | 'delete';

export interface LibraryMenuEntry {
    readonly id: LibraryMenuActionId;
    readonly label: string;
    readonly danger?: boolean;
    /** true = この項目の前に区切り線。 */
    readonly separator?: boolean;
    /** 既存のアイコン部品（codicon）の名前。 */
    readonly icon?: string;
}

/** 棚の種類。asset = 置き場・カタログの素材 / preset = 同梱のプリセット / mystyle = マイスタイル。 */
export type LibraryMenuTarget =
    | { readonly kind: 'asset'; readonly item: AssetCatalogViewItem }
    | { readonly kind: 'textstyle' | 'textanim' | 'lut' | 'transition'; readonly key: string }
    | { readonly kind: 'mystyle'; readonly key: string };

export function libraryMenuTargetKey(target: LibraryMenuTarget): string {
    return target.kind === 'asset' ? target.item.key : target.key;
}

export function formatYen(price: number | undefined): string {
    return `¥${(price ?? 0).toLocaleString('ja-JP')}`;
}

/** 未購入のプレミアムでも「置く」操作の見た目は同じ（押すと促しのシート）。置ける種類かどうかだけを見る。 */
export function isPlaceableLibraryCategory(item: Pick<AssetCatalogViewItem, 'origin' | 'category'>): boolean {
    return canPlaceLibraryAsset({ origin: item.origin, category: item.category, state: 'available' });
}

function favoriteEntry(favorite: boolean, separator = false): LibraryMenuEntry {
    return favorite
        ? { id: 'favorite', label: 'お気に入りから外す', icon: 'star-full', separator }
        : { id: 'favorite', label: 'お気に入りに入れる', icon: 'star-empty', separator };
}

const INFO: LibraryMenuEntry = { id: 'info', label: '情報を見る', icon: 'info' };

export function libraryCardMenuEntries(target: LibraryMenuTarget, favorite: boolean): LibraryMenuEntry[] {
    if (target.kind === 'asset') return target.item.category === 'font'
        ? [{ id: 'apply', label: '選択中に当てる', icon: 'check' }, favoriteEntry(favorite, true), INFO]
        : assetMenuEntries(target.item, favorite);
    if (target.kind === 'mystyle') {
        return [
            { id: 'apply', label: '選択中の文字に当てる', icon: 'check' },
            { id: 'place-text', label: 'プレイヘッドに置く', icon: 'add' },
            favoriteEntry(favorite, true), INFO,
            { id: 'rename', label: '名前を変更', icon: 'edit', separator: true },
            { id: 'delete', label: '消す', icon: 'trash', danger: true }
        ];
    }
    if (target.kind === 'textstyle') {
        return [{ id: 'apply', label: '選択中の文字に当てる', icon: 'check' },
            { id: 'place-text', label: '新しい文字として置く', icon: 'add' }, favoriteEntry(favorite, true), INFO];
    }
    if (target.kind === 'textanim') return [{ id: 'apply', label: '選択中の文字に当てる', icon: 'check' }, favoriteEntry(favorite, true), INFO];
    if (target.kind === 'lut') return [{ id: 'apply', label: '選択中の映像に当てる', icon: 'check' }, favoriteEntry(favorite, true), INFO];
    return [favoriteEntry(favorite), INFO];
}

function assetMenuEntries(item: AssetCatalogViewItem, favorite: boolean): LibraryMenuEntry[] {
    const entries: LibraryMenuEntry[] = [];
    if (isPremiumLocked(item)) {
        entries.push({ id: 'lab', label: `Lab で見る（${formatYen(item.price)}）`, icon: 'link-external' });
        if (isPlaceableLibraryCategory(item)) entries.push({ id: 'place', label: 'プレイヘッドに置く', icon: 'add' });
        entries.push(favoriteEntry(favorite, true), INFO);
        return entries;
    }
    if (item.origin === 'local') {
        if (!item.installed) entries.push({ id: 'agent-import', label: '取り込む', icon: 'cloud-download' });
        entries.push({ id: 'ask', label: 'この素材について頼む', icon: 'comment' });
        entries.push(favoriteEntry(favorite, true), INFO);
        return entries;
    }
    if (canPlaceLibraryAsset(item)) {
        entries.push({ id: 'place', label: 'プレイヘッドに置く', icon: 'add' });
        entries.push({ id: 'import', label: '取り込むだけ（置かない）', icon: 'cloud-download' });
    } else {
        entries.push({ id: 'import', label: '取り込む', icon: 'cloud-download' });
    }
    entries.push(favoriteEntry(favorite, true), INFO);
    if (item.libraryDir) {
        entries.push({ id: 'reveal', label: 'Finder で場所を見る', icon: 'folder-opened', separator: true });
        entries.push({ id: 'remove-library', label: 'ライブラリから消す', icon: 'trash', danger: true });
    }
    return entries;
}

// --- ⋯ = 情報カード ---------------------------------------------------------------------------

export interface LibraryInfoCardAction {
    readonly id: LibraryMenuActionId;
    readonly label: string;
    readonly primary?: boolean;
    readonly icon?: string;
}

export interface LibraryInfoCardModel {
    key: string;
    name: string;
    /** 「作成: …」。 */
    creator: string;
    /** 「この作成元の素材をもっと見る」で合わせる出どころ（無ければリンクを出さない）。 */
    creatorSource?: LibrarySourceFilter;
    /** 料金の行。premium = 王冠を添える。 */
    price: { kind: 'free' | 'premium' | 'purchased' | 'external'; label: string };
    license: LibraryLicenseSheet;
    keywords: string[];
    actions: LibraryInfoCardAction[];
}

export const LIBRARY_INFO_KEYWORD_LIMIT = 5;

const BUILTIN_LICENSE_INPUT = {
    origin: 'resolver', sourceKind: 'lab', licenseScope: 'commercial-ok', licenseAttributionRequired: false
} as const;

function siteName(item: Pick<AssetCatalogViewItem, 'machineTags'>): string | undefined {
    return item.machineTags?.find(tag => tag.startsWith('site:'))?.slice('site:'.length) || undefined;
}

/** 空を除き、大文字小文字だけ違う語（BGM / bgm）は先に出た方を残す。 */
function unique(values: readonly (string | undefined)[]): string[] {
    const seen = new Set<string>();
    return values.map(value => value?.trim()).filter((value): value is string => {
        if (!value || seen.has(value.toLowerCase())) return false;
        seen.add(value.toLowerCase());
        return true;
    });
}

function priceRow(item: AssetCatalogViewItem): LibraryInfoCardModel['price'] {
    const kind = libraryItemPrice(item);
    if (kind === 'premium') return { kind, label: `プレミアム · ${formatYen(item.price)}` };
    if (kind === 'purchased') return { kind, label: '購入済み' };
    if (kind === 'external') return { kind, label: item.distribution === 'subscription' ? 'サブスク（各自入手）' : '有料（各自入手）' };
    return { kind, label: '無料' };
}

export function libraryAssetInfoCard(item: AssetCatalogViewItem, categoryLabel: string, favorite: boolean): LibraryInfoCardModel {
    const source = libraryItemSource(item);
    const creator = item.author?.trim()
        || (source === 'lab' ? 'AKARI Video Lab' : source === 'own' ? '自分の素材' : siteName(item) ?? '素材サイト');
    const license = libraryLicenseSheet(isPremiumLocked(item) ? { ...item, licenseSpdx: item.licenseSpdx ?? LAB_PREMIUM_SPDX } : item);
    const actions: LibraryInfoCardAction[] = [];
    for (const entry of assetMenuEntries(item, favorite)) {
        if (entry.id === 'info' || entry.id === 'reveal' || entry.id === 'remove-library') continue;
        // 未購入のプレミアムの入口は「Lab で見る」1 つ（置く操作は右クリックに残し、押すと促しのシート）。
        if (entry.id === 'place' && isPremiumLocked(item)) continue;
        actions.push({ id: entry.id, label: entry.label, icon: entry.icon, primary: actions.length === 0 });
    }
    return {
        key: item.key,
        name: item.title,
        creator,
        creatorSource: source,
        price: priceRow(item),
        license,
        keywords: unique([categoryLabel, ...item.tags, item.folder, siteName(item)]),
        actions
    };
}

export interface LibraryPresetInfoInput {
    key: string;
    kind: 'textstyle' | 'textanim' | 'lut' | 'transition' | 'mystyle';
    name: string;
    categoryLabel: string;
    tags?: readonly string[];
    author?: string;
}

export function libraryPresetInfoCard(input: LibraryPresetInfoInput, favorite: boolean): LibraryInfoCardModel {
    const target: LibraryMenuTarget = input.kind === 'mystyle' ? { kind: 'mystyle', key: input.key } : { kind: input.kind, key: input.key };
    const actions: LibraryInfoCardAction[] = [];
    for (const entry of libraryCardMenuEntries(target, favorite)) {
        if (entry.id === 'info' || entry.id === 'rename' || entry.id === 'delete') continue;
        actions.push({ id: entry.id, label: entry.label, icon: entry.icon, primary: actions.length === 0 && entry.id !== 'favorite' });
    }
    const mine = input.kind === 'mystyle';
    return {
        key: input.key,
        name: input.name,
        creator: input.author?.trim() || (mine ? '自分の素材' : 'AKARI Video（標準）'),
        creatorSource: mine ? 'own' : 'lab',
        price: { kind: 'free', label: '無料' },
        license: mine
            ? libraryLicenseSheet({ origin: 'resolver', licenseSpdx: 'LicenseRef-user-owned', licenseScope: 'private-owned' })
            : libraryLicenseSheet(BUILTIN_LICENSE_INPUT),
        keywords: unique([input.categoryLabel, ...(input.tags ?? [])]),
        actions
    };
}

/** 促しのシートの文言（price と既存の商品ページの経路だけから作る）。 */
export function premiumPromptText(item: Pick<AssetCatalogViewItem, 'title' | 'price'>): { title: string; body: string; action: string } {
    return {
        title: `「${item.title}」は Lab のプレミアムです`,
        body: `${formatYen(item.price)} で購入すると、このライブラリからそのまま置けるようになります。`
            + 'パスに含まれているかどうかも Lab のページで確かめられます。まだ置いていません。',
        action: 'Lab で見る'
    };
}
