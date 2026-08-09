/**
 * タイムラインのクリップ右クリックメニューの項目構成を組み立てる純関数
 * (task 2026-08-10-timeline-clip-menu 指示2)。DOM に一切依存しないため node --test で検証できる。
 * 呼び出し側 (akari-annotations-widget.ts) が id ごとに既存ハンドラへディスパッチする。
 *
 * 司令塔裁定1: メニューは既存ハンドラのメニュー化に徹する。ハンドラが対応しない種別には
 * 項目を出さない — コピーは caption/overlay のみ（既存 copySelectedItem の対応範囲）、
 * ペーストは clipboard に中身があるときだけ全種別、分割は cut のみ（既存 razor
 * performRazorSplitAt）、削除は全種別。cuts/layers/audio へのコピー&ペースト拡張は次段
 * （本タスクでは実装しない）。
 */
export type TimelineClipMenuItemKind = 'cut' | 'overlay' | 'caption' | 'layer' | 'audio';

export interface TimelineClipMenuItem {
    readonly id: string;
    readonly label: string;
    readonly danger?: boolean;
}

/** コピー対応種別（既存 copySelectedItem の対応範囲）。 */
const COPY_CAPABLE_KINDS: ReadonlySet<TimelineClipMenuItemKind> = new Set(['caption', 'overlay']);

/** 分割対応種別（既存 razor performRazorSplitAt の対応範囲）。 */
const SPLIT_CAPABLE_KINDS: ReadonlySet<TimelineClipMenuItemKind> = new Set(['cut']);

/** 司令塔裁定3: 項目の並び = コピー → ペースト → 分割 → 削除（削除は danger 表示）。 */
export function buildTimelineClipMenuItems(
    kind: TimelineClipMenuItemKind, hasClipboard: boolean
): TimelineClipMenuItem[] {
    const items: TimelineClipMenuItem[] = [];
    if (COPY_CAPABLE_KINDS.has(kind)) {
        items.push({ id: 'copy', label: 'コピー' });
    }
    if (hasClipboard) {
        items.push({ id: 'paste', label: 'ペースト' });
    }
    if (SPLIT_CAPABLE_KINDS.has(kind)) {
        items.push({ id: 'split', label: '分割' });
    }
    items.push({ id: 'delete', label: '削除', danger: true });
    return items;
}
