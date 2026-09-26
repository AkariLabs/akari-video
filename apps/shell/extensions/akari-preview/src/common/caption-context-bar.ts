import type { BarItem, ContextBarState } from './context-bar-view';
import { BUNDLED_CAPTION_FONT_FACES } from './bundled-caption-fonts';
import { CAPTION_FONT_FAMILY } from './caption-visual-contract';

export const CAPTION_TOOL_KEYS = ['group', 'snap', 'clamp', 'reset'] as const;

export function captionBarItems(state: ContextBarState): BarItem[] {
    if (state.kind !== 'caption' || !state.selectedId) return [];
    const style = (state.item?.textStyle ?? {}) as Record<string, any>;
    return [
        { key: 'captionPreset', label: '字幕のスタイル', kind: 'window', text: true },
        { key: 'captionCushion', label: '座布団', kind: 'window', text: true },
        { key: 'captionTextColor', label: '文字の色', kind: 'window', paint: style.color ?? '#ffffff' },
        { key: 'captionStrokeColor', label: '縁取りの色', kind: 'window', paint: style.stroke?.color ?? '#000000' },
        { key: 'captionBold', label: '太字', kind: 'action', text: true },
        { key: 'captionFont', label: 'フォント', kind: 'window', text: true },
        { key: 'captionSize', label: '大きさ', kind: 'window', text: true },
        { key: 'captionSpacing', label: '行間・字間', kind: 'window', text: true },
        { key: 'captionStroke', label: '縁取り', kind: 'window', text: true },
        { key: 'captionSep', label: '', kind: 'separator' },
        { key: 'captionMore', label: 'その他', kind: 'window' }
    ];
}

export function captionMoreItems(): ReadonlyArray<{ key: string; label: string }> {
    return [
        { key: 'captionMyStyleSave', label: 'マイスタイルに保存' },
        { key: 'captionInspector', label: 'インスペクターを開く' }
    ];
}

export const CAPTION_COLORS = ['#ffffff', '#000000', '#f5c451', '#ff8b2c', '#f26666', '#e85fa1',
    '#ac78ed', '#4da3ff', '#53d1bc', '#75d368', '#8a93a5', '#283447'] as const;

export const CAPTION_PRESETS = [
    { key: 'subtitle-standard', label: '標準字幕' },
    { key: 'subtitle-interview', label: 'インタビュー字幕' },
    { key: 'subtitle-commentary', label: '実況テロップ' },
    { key: 'subtitle-news', label: 'ニュース風' },
    { key: 'subtitle-variety', label: 'バラエティ' },
    { key: 'narration-caption', label: 'ナレーション字幕' }
] as const;

/** プレビューが実際に読み込む書体を、表示名で重複を除いて並べる。 */
export function captionFontChoices(current: string | undefined): string[] {
    const families = [CAPTION_FONT_FAMILY, ...BUNDLED_CAPTION_FONT_FACES.map(face => face.family)];
    if (current?.trim()) families.unshift(current.trim());
    return [...new Set(families)];
}
