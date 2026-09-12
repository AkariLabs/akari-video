/**
 * タイムラインのクリップ右クリックメニューの項目構成を組み立てる純関数
 * (task 2026-08-10-timeline-clip-menu 指示2)。DOM に一切依存しないため node --test で検証できる。
 * 呼び出し側 (akari-annotations-widget.ts) が id ごとに既存ハンドラへディスパッチする。
 *
 * v2 の visual item は source.kind に関係なく同じコピー経路を使う。字幕は sidecar の既存経路、
 * 効果音も断片に含める。BGM・ナレーションは呼び出し側が copyable: false で除外する。
 */
export type TimelineClipMenuItemKind = 'cut' | 'overlay' | 'caption' | 'layer' | 'audio';

export type TimelineAnnotationTargetKind = TimelineClipMenuItemKind | 'item';

export interface TimelineAnnotationTargetInput {
    readonly kind: TimelineAnnotationTargetKind;
    /** v2 tracks[].items[].id。解決できたときだけ渡す。 */
    readonly itemId?: string;
    /** legacy 投影の cuts[] index（kind === 'cut' のときだけ意味を持つ）。 */
    readonly cutIndex?: number;
    /** 画面に出ているクリップ名。空なら id / C<n+1> にフォールバックする。 */
    readonly label?: string;
}

export interface TimelineAnnotationTarget {
    /** `ui:` プレフィックスなしの target（ReviewModel.addUiAnnotation が ui: を付ける）。 */
    readonly target: string;
    readonly label: string;
}

/** 出力プレビュー（akari-preview ホスト）→ タイムライン。timelineT と選択中 item id を渡す生の要求。 */
export const CLIP_ANNOTATION_REQUEST_EVENT = 'akari.review.clipAnnotation.request';
/** タイムライン → 注釈パネル。sourceT / target / label を解決済みの composer 起動要求。 */
export const CLIP_ANNOTATION_OPEN_EVENT = 'akari.review.clipAnnotation.open';
/** パネル・ボード → タイムライン。ui:timeline:* 注釈から該当クリップを選択してスクロールさせる。 */
export const CLIP_ANNOTATION_REVEAL_EVENT = 'akari.review.clipAnnotation.reveal';
/** タイムライン → パネル・ボード。ui target id → 画面のクリップ名の索引（読み取り専用）。 */
export const CLIP_ANNOTATION_LABELS_EVENT = 'akari.review.clipAnnotation.labels';
/** パネル・ボード → タイムライン。ui target id → クリップ名の索引を送り直させる。 */
export const CLIP_ANNOTATION_LABELS_REQUEST_EVENT = 'akari.review.clipAnnotation.labelsRequest';

export interface TimelineClipMenuItem {
    readonly id: string;
    readonly label: string;
    readonly danger?: boolean;
    readonly disabled?: boolean;
    readonly disabledReason?: string;
}

export interface TimelineCutAudioMenuContext {
    split?: { ok: true } | { ok: false; message: string };
    linked?: boolean;
    copyable?: boolean;
}

export interface TimelineTreeMenuContext {
    canSplit?: boolean;
    canDetach?: boolean;
    canConvertToTelop?: boolean;
    canGroup?: boolean;
    canUngroup?: boolean;
    canToggleCollapse?: boolean;
    collapsed?: boolean;
    hasParent?: boolean;
}

/** 互換呼び出しの既定。現行 UI は素材IDから canSplit を明示する。 */
const SPLIT_CAPABLE_KINDS: ReadonlySet<TimelineClipMenuItemKind> = new Set(['cut']);

/** コピー・切り取り・貼り付け・複製を先頭へ置き、削除は danger 表示にする。 */
export function buildTimelineClipMenuItems(
    kind: TimelineClipMenuItemKind, hasClipboard: boolean, tree: TimelineTreeMenuContext = {},
    audio: TimelineCutAudioMenuContext = {}
): TimelineClipMenuItem[] {
    const items: TimelineClipMenuItem[] = [];
    if (audio.copyable !== false) {
        items.push({ id: 'copy', label: 'コピー' }, { id: 'cut', label: '切り取り' });
    }
    items.push({ id: 'paste', label: '貼り付け', ...(!hasClipboard ? { disabled: true } : {}) });
    if (audio.copyable !== false) items.push({ id: 'duplicate', label: '複製' });
    if (tree.canSplit ?? SPLIT_CAPABLE_KINDS.has(kind)) {
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
    if (kind === 'cut' && audio.split) items.push({
        id: 'split-audio', label: '音声を分離',
        ...(audio.split.ok === false ? { disabled: true, disabledReason: audio.split.message } : {})
    });
    if (kind === 'audio' && audio.linked) items.push({ id: 'unlink-audio', label: 'リンクを解除' });
    items.push({ id: 'annotate', label: '注釈…' });
    items.push({ id: 'delete', label: '削除', danger: true });
    return items;
}

export function resolveTimelineAnnotationTarget(
    input: TimelineAnnotationTargetInput
): TimelineAnnotationTarget | undefined {
    const itemId = typeof input.itemId === 'string' && input.itemId.trim() ? input.itemId.trim() : undefined;
    const cutIndex = input.kind === 'cut' && Number.isInteger(input.cutIndex) && input.cutIndex! >= 0
        ? input.cutIndex : undefined;
    const target = itemId
        ? `timeline:item:${itemId}`
        : cutIndex !== undefined ? `timeline:cut:${cutIndex}` : undefined;
    if (!target) return undefined;
    const suppliedLabel = typeof input.label === 'string' && input.label.trim() ? input.label.trim() : undefined;
    return {
        target,
        label: suppliedLabel ?? itemId ?? `C${cutIndex! + 1}`
    };
}
