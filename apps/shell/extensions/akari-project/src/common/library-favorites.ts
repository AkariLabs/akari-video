/**
 * ライブラリの ★ お気に入り（素材の key の集合）。利用者ごとに `AKARI_HOME/library-favorites.json`
 * へ保存する（使用回数の台帳 `library-usage.jsonl` と同じ置き場。プロジェクトの edit.json には入れない）。
 *
 * key は一覧の key と同じ形: 素材 = `<category>/<id>`、プリセット = `textstyle/<id>` など、
 * マイスタイル = `mystyle/<id>`。
 */
export const LIBRARY_FAVORITES_FILE = 'library-favorites.json';
export const LIBRARY_FAVORITES_SCHEMA = 'akari-library-favorites/v0';

export interface LibraryFavoritesDocument {
    schema: typeof LIBRARY_FAVORITES_SCHEMA;
    keys: string[];
}

/** 空・改行・制御文字・パス区切りの前後の `..` を含む key は捨てる。 */
export function isLibraryFavoriteKey(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0 && value.length <= 300
        && /^[^/\s]+\/[^\s]/.test(value) && ![...value].some(char => char.charCodeAt(0) < 0x20)
        && !value.split('/').some(part => part === '..' || part === '.');
}

/** 壊れた・古い形のファイルでも落とさない（読めない分は空として扱う）。重複を除き、順は保つ。 */
export function parseLibraryFavorites(raw: string | undefined): string[] {
    if (!raw) return [];
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch { return []; }
    const keys = Array.isArray(parsed) ? parsed
        : parsed && typeof parsed === 'object' && Array.isArray((parsed as { keys?: unknown }).keys) ? (parsed as { keys: unknown[] }).keys : [];
    return [...new Set(keys.filter(isLibraryFavoriteKey))];
}

export function serializeLibraryFavorites(keys: readonly string[]): string {
    const document: LibraryFavoritesDocument = { schema: LIBRARY_FAVORITES_SCHEMA, keys: [...new Set(keys.filter(isLibraryFavoriteKey))] };
    return `${JSON.stringify(document, undefined, 2)}\n`;
}

/** 付ける = 先頭へ（最近 ★ したものが前）。外す = 取り除く。 */
export function toggleLibraryFavorite(keys: readonly string[], key: string, favorite: boolean): string[] {
    if (!isLibraryFavoriteKey(key)) throw new Error('お気に入りの key が不正です');
    const rest = keys.filter(value => value !== key);
    return favorite ? [key, ...rest] : rest;
}
