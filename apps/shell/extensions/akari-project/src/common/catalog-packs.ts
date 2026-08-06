/**
 * `catalog/packs.json`（パック台帳）の寛容リーダー。契約: akari-catalog-packs/v0
 * （`{ "schema": ..., "packs": [{ "id", "category", "title", "summary" }] }`）。
 * ファイル不在・壊れた JSON・スキーマ不一致・要素ごとの必須フィールド欠落は
 * すべて例外を投げず空配列 / 該当要素スキップへフォールドする
 * （catalog-reader.ts の寛容リーダー流儀を踏襲。schema 文字列自体は検証しない —
 * 将来のマイナー更新で無用に全滅させないため、`packs` 配列の形だけを見る）。
 */

export interface CatalogPack {
    id: string;
    category: string;
    title: string;
    summary?: string;
}

export function parseCatalogPacksFile(raw: string): CatalogPack[] {
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return [];
    }
    if (!isRecord(parsed) || !Array.isArray(parsed.packs)) {
        return [];
    }
    return parsed.packs
        .filter(isRecord)
        .map(parsePack)
        .filter((pack): pack is CatalogPack => pack !== undefined);
}

function parsePack(value: Record<string, unknown>): CatalogPack | undefined {
    const { id, category, title } = value;
    if (!isNonEmptyString(id) || !isNonEmptyString(category) || !isNonEmptyString(title)) {
        return undefined;
    }
    return {
        id,
        category,
        title,
        summary: typeof value.summary === 'string' ? value.summary : undefined
    };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function isNonEmptyString(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0;
}
