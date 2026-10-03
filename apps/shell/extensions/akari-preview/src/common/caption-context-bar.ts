import type { BarItem, ContextBarState } from './context-bar-view';

export const CAPTION_TOOL_KEYS = ['group', 'snap', 'clamp', 'reset'] as const;

export const CAPTION_BAR_ORDER = ['captionFont', 'captionSize', 'captionTextColor', 'captionBold',
    'captionItalic', 'captionUnderline', 'captionStrike', 'captionCase', 'captionAlign', 'captionBullet',
    'captionSpacing', 'captionVertical', 'captionOpacity', 'captionEffect', 'captionAnimation', 'captionStyle'] as const;
export const CAPTION_BAR_PINNED = new Set<string>(['captionFont', 'captionSize', 'captionStyle']);
export const CAPTION_MINI_WINDOWS = new Set<string>(['captionTextColor', 'captionSpacing', 'captionOpacity']);

/** Rightmost optional controls move first; font, size and style stay visible. */
export function contextBarOverflowKeys(order: readonly string[], widths: Record<string, number>, available: number,
    overflowWidth = 30, pinned: ReadonlySet<string> = new Set()): string[] {
    const total = order.reduce((sum, key) => sum + (widths[key] ?? 0), 0);
    if (total <= available) return [];
    const hidden = new Set<string>();
    let remaining = total;
    for (const key of [...order].reverse()) {
        if (pinned.has(key)) continue;
        if (remaining + overflowWidth <= available) break;
        hidden.add(key);
        remaining -= widths[key] ?? 0;
    }
    return order.filter(key => hidden.has(key));
}

export function captionOverflowKeys(widths: Record<string, number>, available: number, overflowWidth = 42): string[] {
    return contextBarOverflowKeys(CAPTION_BAR_ORDER, widths, available, overflowWidth, CAPTION_BAR_PINNED);
}

export function nextCaptionAlign(value: unknown): 'center' | 'right' | 'left' {
    return value === 'center' ? 'right' : value === 'right' ? 'left' : 'center';
}

export function nextCaptionWindow(current: string | null, key: string): string | null {
    return CAPTION_MINI_WINDOWS.has(key) ? current === key ? null : key : null;
}

export function captionItemPressed(key: string, style: Record<string, any>, panel: 'font' | 'style' | null): boolean {
    switch (key) {
        case 'captionFont': return panel === 'font';
        case 'captionStyle': return panel === 'style';
        case 'captionBold': return Number(style.weight ?? style.fontWeight) >= 700;
        case 'captionItalic': return style.italic === true;
        case 'captionUnderline': return style.underline === true;
        case 'captionStrike': return style.strikethrough === true;
        case 'captionCase': return style.textTransform === 'upper' || style.textTransform === 'lower';
        case 'captionAlign': return style.align === 'left' || style.align === 'right';
        case 'captionBullet': return style.list === 'bullet';
        case 'captionSpacing': return (typeof style.lineHeight === 'number' && style.lineHeight !== 1.2)
            || (typeof style.letterSpacingEm === 'number' && style.letterSpacingEm !== 0);
        case 'captionVertical': return style.vertical === true;
        case 'captionOpacity': return typeof style.opacity === 'number' && style.opacity < 1;
        default: return false;
    }
}

export function captionOverflowPressed(hidden: readonly string[], style: Record<string, any>,
    panel: 'font' | 'style' | null): boolean {
    return hidden.some(key => captionItemPressed(key, style, panel));
}

export function captionEscapeClosesPopup(kind: string | null | undefined, openWindow: string | null,
    moreOpen: boolean): boolean {
    return !!kind && (!!openWindow || moreOpen);
}

export function captionValueChanged(current: unknown, pending: unknown, next: unknown): boolean {
    return (pending === undefined ? current : pending) !== next;
}

export function captionBarItems(state: ContextBarState): BarItem[] {
    if (state.kind !== 'caption' || !state.selectedId) return [];
    const style = (state.item?.textStyle ?? {}) as Record<string, any>;
    const labels: Record<string, string> = {
        captionFont: 'フォント', captionSize: 'サイズ', captionTextColor: '文字の色', captionBold: '太字',
        captionItalic: '斜体', captionUnderline: '下線', captionStrike: '取り消し線', captionCase: '大文字小文字',
        captionAlign: '配置', captionBullet: '箇条書き', captionSpacing: '間隔', captionVertical: '縦書き',
        captionOpacity: '透明度', captionEffect: 'エフェクト', captionAnimation: 'アニメーション', captionStyle: 'スタイル'
    };
    return CAPTION_BAR_ORDER.map(key => ({ key, label: labels[key], kind: CAPTION_MINI_WINDOWS.has(key) ? 'window' : 'action',
        ...(key === 'captionTextColor' ? { paint: style.color ?? '#ffffff' } : {}) } as BarItem));
}

export const CAPTION_COLORS = ['#ffffff', '#000000', '#f5c451', '#ff8b2c', '#f26666', '#e85fa1',
    '#ac78ed', '#4da3ff', '#53d1bc', '#75d368', '#8a93a5', '#283447'] as const;
