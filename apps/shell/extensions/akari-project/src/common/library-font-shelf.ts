import type { AssetCatalogViewItem } from './akari-project-protocol';

export interface FontSelection { kind: 'cut' | 'caption'; id: string }

/** 字幕の保存形（配列または captions 包み）から既存の見た目を取り出す。 */
export function selectedFontStyleFromCaptions(source: string, captionId: string,
    presets: readonly { id: string; style?: Record<string, unknown> }[]): Record<string, unknown> {
    const document = JSON.parse(source) as unknown;
    const rows = Array.isArray(document) ? document
        : document && typeof document === 'object' && Array.isArray((document as { captions?: unknown }).captions)
            ? (document as { captions: unknown[] }).captions : [];
    const row = rows.find(value => value && typeof value === 'object'
        && (value as { id?: unknown }).id === captionId) as { text_style?: unknown; style_preset?: unknown } | undefined;
    const preset = typeof row?.style_preset === 'string' ? presets.find(item => item.id === row.style_preset)?.style : undefined;
    const override = row?.text_style && typeof row.text_style === 'object' && !Array.isArray(row.text_style)
        ? row.text_style as Record<string, unknown> : undefined;
    return { ...preset, ...override };
}

/** 既存の文字スタイル適用イベントへ渡す、見た目だけの部品。 */
export function planFontApply(item: Pick<AssetCatalogViewItem, 'category' | 'id' | 'title'>,
    selection: FontSelection | null | undefined, previousStyle: Record<string, unknown> = {}): { ok: true; captionId: string; detail: {
        ids: string[]; selectedParts: string[]; style: { parts: Array<{ kind: 'look'; text_style: Record<string, unknown> }> }
    } } | { ok: false; message: string } {
    if (item.category !== 'font' || !item.id.trim()) return { ok: false, message: 'フォントが見つかりません。' };
    if (!selection || selection.kind !== 'caption' || !selection.id.trim()) {
        return { ok: false, message: '先に文字を選んでください。' };
    }
    const family = item.title.replace(/（.*$/, '').trim();
    if (!family) return { ok: false, message: 'フォントの名前を確認できません。' };
    return { ok: true, captionId: selection.id, detail: {
        ids: [selection.id], selectedParts: ['look'],
        style: { parts: [{ kind: 'look', text_style: { ...previousStyle, font_family: family } }] }
    } };
}
