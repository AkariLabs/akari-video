/**
 * タイムラインのクリップ右クリックメニューの項目構成を組み立てる純関数
 * (task 2026-08-10-timeline-clip-menu 指示2)。DOM に一切依存しないため node --test で検証できる。
 * 呼び出し側 (akari-annotations-widget.ts) が id ごとに既存ハンドラへディスパッチする。
 *
 * v2 の visual item は source.kind に関係なく同じコピー経路を使う。字幕は sidecar の既存経路、
 * audio はトップレベル audio ブロックのためコピー対象外。分割は cut、削除は全種別。
 */
export type TimelineClipMenuItemKind = 'cut' | 'overlay' | 'caption' | 'layer' | 'audio';

export interface TimelineClipMenuItem {
    readonly id: string;
    readonly label: string;
    readonly danger?: boolean;
}

export interface TimelineTreeMenuContext {
    canDetach?: boolean;
    canConvertToTelop?: boolean;
    canGroup?: boolean;
    canUngroup?: boolean;
    canToggleCollapse?: boolean;
    collapsed?: boolean;
    hasParent?: boolean;
}

/** コピー対応種別（v2 visual item + 字幕）。 */
const COPY_CAPABLE_KINDS: ReadonlySet<TimelineClipMenuItemKind> = new Set(['cut', 'caption', 'overlay', 'layer']);

/** 分割対応種別（既存 razor performRazorSplitAt の対応範囲）。 */
const SPLIT_CAPABLE_KINDS: ReadonlySet<TimelineClipMenuItemKind> = new Set(['cut']);

/** 司令塔裁定3: 項目の並び = コピー → ペースト → 分割 → 削除（削除は danger 表示）。 */
export function buildTimelineClipMenuItems(
    kind: TimelineClipMenuItemKind, hasClipboard: boolean, tree: TimelineTreeMenuContext = {}
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
    if (tree.canDetach) items.push({ id: 'detach', label: '出す' });
    if (tree.canConvertToTelop) items.push({ id: 'convert-to-telop', label: 'テロップに変換' });
    if (tree.canGroup) items.push({ id: 'group', label: 'まとめる' });
    if (tree.canUngroup) items.push({ id: 'ungroup', label: 'ばらす' });
    if (tree.canToggleCollapse) {
        items.push({ id: 'toggle-collapse', label: tree.collapsed ? '展開' : '折りたたむ' });
    }
    if (tree.hasParent) items.push({ id: 'select-parent', label: '親を選択' });
    items.push({ id: 'delete', label: '削除', danger: true });
    return items;
}
