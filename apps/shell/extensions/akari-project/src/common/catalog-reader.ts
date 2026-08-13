/**
 * `catalog/` 配下の各アイテムディレクトリにある meta.json を寛容リーダーで読む。
 * 必須は id・category・title の 3 フィールドのみ。他フィールドの欠落・未知
 * フィールド・壊れた JSON はすべて例外を投げず undefined へフォールドする
 * （render-progress.ts の寛容リーダー流儀を踏襲）。
 */

export interface CatalogItemLicense {
    spdx?: string;
    /** ライセンス区分（例: "commercial-ok" / "paid-license-required"）。分類バッジ導出に使う。 */
    scope?: string;
}

export interface CatalogItemSource {
    url?: string;
    preview_url?: string;
    /** 取得手段（例: "direct" / "login" / "purchase"）。free 分類の「要登録」表示に使う。 */
    acquisition?: string;
}

export interface CatalogItemMeta {
    id: string;
    category: string;
    title: string;
    description?: string;
    tags?: string[];
    when_to_use?: string;
    license?: CatalogItemLicense;
    source?: CatalogItemSource;
    /** true = 実体を同梱せず外部から都度取得する参照配布アイテム。分類バッジ導出に使う。 */
    remote?: boolean;
}

/**
 * カタログルート直下の走査対象カテゴリディレクトリ（meta.json v0 の category enum と同値）。
 * frontend（akari-role-buckets-widget.tsx のフォルダー検証）と backend
 * （akari-project-service.ts の 1 ビュー用ローカル catalog/ 走査）の両方が使う共有定数。
 * 2026-07-29 にカテゴリ軸を主題から配布物の形へ変更（3d→scene3d / telop→overlay /
 * thumbnail→still）。telop テンプレと luts は同日 presets/ へ移設した（コードが id で引く
 * 参照表であり素材カタログではないため）。
 */
export const CATALOG_CATEGORIES = ['overlay', 'still', 'scene3d', 'audio', 'broll', 'font'] as const;

/** カタログ面で category enum を人向けに表示する日本語ラベル。 */
export const CATALOG_CATEGORY_LABELS: Readonly<Record<(typeof CATALOG_CATEGORIES)[number], string>> = {
    overlay: 'オーバーレイ',
    still: '静止画',
    scene3d: '3D',
    audio: '音声',
    broll: 'Bロール',
    font: 'フォント'
};

export interface CatalogCategoryChip {
    category: string;
    label: string;
    count: number;
}

/**
 * 固定 6 カテゴリを 0 件でも先に返し、データに現れた未知カテゴリだけを末尾へ加える。
 * category は絞り込みキーとして一切翻訳せず、label だけを表示用に分離する。
 */
export function deriveCatalogCategoryChips(items: readonly { readonly category: string }[]): CatalogCategoryChip[] {
    const counts = new Map<string, number>();
    for (const item of items) {
        counts.set(item.category, (counts.get(item.category) ?? 0) + 1);
    }
    const known = CATALOG_CATEGORIES.map(category => ({
        category,
        label: CATALOG_CATEGORY_LABELS[category],
        count: counts.get(category) ?? 0
    }));
    const knownSet = new Set<string>(CATALOG_CATEGORIES);
    const unknown = Array.from(counts.keys())
        .filter(category => !knownSet.has(category))
        .sort((left, right) => left.localeCompare(right, 'ja'))
        .map(category => ({ category, label: category, count: counts.get(category) ?? 0 }));
    return [...known, ...unknown];
}

export type CatalogViewMode = 'grid' | 'list';

/** localStorage の欠損・旧値・破損値は既定のカード表示へ安全に戻す。 */
export function normalizeCatalogViewMode(value: unknown): CatalogViewMode {
    return value === 'list' ? 'list' : 'grid';
}

export type CatalogFilteredEmptyKind = 'category-empty' | 'no-match';

/** 選択カテゴリ自体が 0 件なのか、検索条件だけが不一致なのかを分ける。 */
export function deriveCatalogFilteredEmptyKind(
    items: readonly { readonly category: string }[],
    category: string
): CatalogFilteredEmptyKind {
    return category !== 'all' && !items.some(item => item.category === category)
        ? 'category-empty'
        : 'no-match';
}

export function parseCatalogItemMeta(raw: string): CatalogItemMeta | undefined {
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return undefined;
    }
    if (!isRecord(parsed)) {
        return undefined;
    }
    const { id, category, title } = parsed;
    if (!isNonEmptyString(id) || !isNonEmptyString(category) || !isNonEmptyString(title)) {
        return undefined;
    }
    return {
        id,
        category,
        title,
        description: typeof parsed.description === 'string' ? parsed.description : undefined,
        tags: Array.isArray(parsed.tags) ? parsed.tags.filter((tag): tag is string => typeof tag === 'string') : undefined,
        when_to_use: typeof parsed.when_to_use === 'string' ? parsed.when_to_use : undefined,
        license: parseLicense(parsed.license),
        source: parseSource(parsed.source),
        remote: typeof parsed.remote === 'boolean' ? parsed.remote : undefined
    };
}

/**
 * filterCatalogItems が検索対象にする最小フィールド集合。ローカル catalog/ 由来の
 * CatalogItemMeta と、1 ビュー（resolver 合成分含む）の AssetCatalogViewItem
 * （akari-project-protocol.ts）の両方がこの形を満たすため、同じ純関数を両方の
 * データ源で再利用できる。
 */
export interface CatalogSearchable {
    id: string;
    category: string;
    title: string;
    description?: string;
    tags?: string[];
    /** resolver 合成分の生成プロンプト（provenance.prompt）。あれば検索対象に含める。 */
    prompt?: string;
}

/**
 * 検索（名前 / description / tags / prompt）+ カテゴリチップ絞り込みの純関数。
 * category は 'all' で全カテゴリを通す。
 */
export function filterCatalogItems<T extends CatalogSearchable>(
    items: readonly T[],
    query: string,
    category: string
): T[] {
    const normalizedQuery = query.trim().toLowerCase();
    return items.filter(item => {
        if (category !== 'all' && item.category !== category) {
            return false;
        }
        if (!normalizedQuery) {
            return true;
        }
        const haystack = [item.title, item.id, item.description ?? '', item.prompt ?? '', ...(item.tags ?? [])]
            .join(' ')
            .toLowerCase();
        return haystack.includes(normalizedQuery);
    });
}

function parseLicense(value: unknown): CatalogItemLicense | undefined {
    if (!isRecord(value)) {
        return undefined;
    }
    const spdx = typeof value.spdx === 'string' && value.spdx.trim() ? value.spdx : undefined;
    const scope = typeof value.scope === 'string' && value.scope.trim() ? value.scope : undefined;
    if (!spdx && !scope) {
        return undefined;
    }
    return { spdx, scope };
}

function parseSource(value: unknown): CatalogItemSource | undefined {
    if (!isRecord(value)) {
        return undefined;
    }
    const url = typeof value.url === 'string' && value.url.trim() ? value.url : undefined;
    const previewUrl = typeof value.preview_url === 'string' && value.preview_url.trim() ? value.preview_url : undefined;
    const acquisition = typeof value.acquisition === 'string' && value.acquisition.trim() ? value.acquisition : undefined;
    if (!url && !previewUrl && !acquisition) {
        return undefined;
    }
    return { url, preview_url: previewUrl, acquisition };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function isNonEmptyString(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0;
}
