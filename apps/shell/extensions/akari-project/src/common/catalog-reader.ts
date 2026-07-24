/**
 * `catalog/` 配下の各アイテムディレクトリにある meta.json を寛容リーダーで読む。
 * 必須は id・category・title の 3 フィールドのみ。他フィールドの欠落・未知
 * フィールド・壊れた JSON はすべて例外を投げず undefined へフォールドする
 * （render-progress.ts の寛容リーダー流儀を踏襲）。
 */

export interface CatalogItemLicense {
    spdx?: string;
}

export interface CatalogItemSource {
    url?: string;
    preview_url?: string;
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
        source: parseSource(parsed.source)
    };
}

/**
 * 検索（名前 / description / tags）+ カテゴリチップ絞り込みの純関数。
 * category は 'all' で全カテゴリを通す。
 */
export function filterCatalogItems(
    items: readonly CatalogItemMeta[],
    query: string,
    category: string
): CatalogItemMeta[] {
    const normalizedQuery = query.trim().toLowerCase();
    return items.filter(item => {
        if (category !== 'all' && item.category !== category) {
            return false;
        }
        if (!normalizedQuery) {
            return true;
        }
        const haystack = [item.title, item.id, item.description ?? '', ...(item.tags ?? [])]
            .join(' ')
            .toLowerCase();
        return haystack.includes(normalizedQuery);
    });
}

function parseLicense(value: unknown): CatalogItemLicense | undefined {
    if (!isRecord(value) || typeof value.spdx !== 'string' || !value.spdx.trim()) {
        return undefined;
    }
    return { spdx: value.spdx };
}

function parseSource(value: unknown): CatalogItemSource | undefined {
    if (!isRecord(value)) {
        return undefined;
    }
    const url = typeof value.url === 'string' && value.url.trim() ? value.url : undefined;
    const previewUrl = typeof value.preview_url === 'string' && value.preview_url.trim() ? value.preview_url : undefined;
    if (!url && !previewUrl) {
        return undefined;
    }
    return { url, preview_url: previewUrl };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function isNonEmptyString(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0;
}
