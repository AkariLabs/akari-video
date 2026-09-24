/**
 * ブランドキット（ブランドカラー）。利用者ごとに `AKARI_HOME/brand-kit.json` へ保存する
 * （★ お気に入りと同じ置き場。どのプロジェクトからも同じ 1 つが見える。edit.json には入れない）。
 * ライブラリ › マイ › ブランドキット と、インスペクターの色パネルの「ブランドキット」は同じファイルを読む。
 *
 * 色は `#RRGGBB` か `#RRGGBBAA`（大文字）。追加した順に並ぶ。
 */
export const BRAND_KIT_FILE = 'brand-kit.json';
export const BRAND_KIT_SCHEMA = 'akari-brand-kit/v0';
export const BRAND_KIT_MAX_COLORS = 60;

/** コマンド id（拡張をまたいで文字列で呼ぶ。インスペクターの色パネルが使う）。 */
export const BRAND_KIT_GET_COMMAND_ID = 'akari.library.brandKit.get';
export const BRAND_KIT_ADD_COLOR_COMMAND_ID = 'akari.library.brandKit.addColor';
export const BRAND_KIT_REMOVE_COLOR_COMMAND_ID = 'akari.library.brandKit.removeColor';

export interface BrandKitDocument {
    schema: typeof BRAND_KIT_SCHEMA;
    colors: string[];
}

/** `#abc` / `#aabbcc` / `#aabbccdd` → 大文字の `#AABBCC(DD)`（不透明の FF は落とす）。読めなければ undefined。 */
export function normalizeBrandColor(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    const match = /^#?([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/iu.exec(value.trim());
    if (!match) return undefined;
    let digits = match[1].length === 3 ? match[1].split('').map(char => char + char).join('') : match[1];
    digits = digits.toUpperCase();
    if (digits.length === 8 && digits.endsWith('FF')) digits = digits.slice(0, 6);
    return `#${digits}`;
}

function uniqueColors(values: readonly unknown[]): string[] {
    const result: string[] = [];
    for (const value of values) {
        const color = normalizeBrandColor(value);
        if (color && !result.includes(color)) result.push(color);
    }
    return result.slice(0, BRAND_KIT_MAX_COLORS);
}

/** 壊れた・古い形のファイルでも落とさない（読めない分は空）。重複を除き、順は保つ。 */
export function parseBrandKit(raw: string | undefined): string[] {
    if (!raw) return [];
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch { return []; }
    const colors = Array.isArray(parsed) ? parsed
        : parsed && typeof parsed === 'object' && Array.isArray((parsed as { colors?: unknown }).colors)
            ? (parsed as { colors: unknown[] }).colors : [];
    return uniqueColors(colors);
}

export function serializeBrandKit(colors: readonly string[]): string {
    const document: BrandKitDocument = { schema: BRAND_KIT_SCHEMA, colors: uniqueColors(colors) };
    return `${JSON.stringify(document, undefined, 2)}\n`;
}

/** 足す = 末尾へ（既にあれば何もしない）。 */
export function addBrandColor(colors: readonly string[], color: string): string[] {
    const normalized = normalizeBrandColor(color);
    if (!normalized) throw new Error('ブランドカラーは #RRGGBB で指定してください');
    const current = uniqueColors(colors);
    if (current.includes(normalized)) return current;
    if (current.length >= BRAND_KIT_MAX_COLORS) throw new Error(`ブランドカラーは ${BRAND_KIT_MAX_COLORS} 色までです`);
    return [...current, normalized];
}

export function removeBrandColor(colors: readonly string[], color: string): string[] {
    const normalized = normalizeBrandColor(color);
    return uniqueColors(colors).filter(value => value !== normalized);
}
