import { Command } from '@theia/core/lib/common';

/** ウィジェット同士の循環 import を避けるため、コマンド定義はここに置く。 */
export const OPEN_AKARI_ANNOTATIONS: Command = {
    id: 'akari.annotations.open',
    label: 'タイムラインを開く'
};

export const OPEN_AKARI_REVIEW_PANEL: Command = {
    id: 'akari.review.open',
    label: '注釈を開く'
};

export const OPEN_AKARI_REVIEW_PANEL_ID = OPEN_AKARI_REVIEW_PANEL.id;

export const OPEN_AKARI_INSPECTOR: Command = {
    id: 'akari.inspector.open',
    label: 'インスペクターを開く'
};

export const OPEN_AKARI_INSPECTOR_ID = OPEN_AKARI_INSPECTOR.id;

export const OPEN_AKARI_REVIEW_BOARD: Command = {
    id: 'akari.review.board.open',
    label: 'レビューボードを開く'
};

export const OPEN_AKARI_REVIEW_BOARD_ID = OPEN_AKARI_REVIEW_BOARD.id;

/** キャンバス面（contract-2026-07-26-canvas-surface）を新規に開く。 */
export const OPEN_AKARI_CANVAS: Command = {
    id: 'akari.canvas.open',
    label: 'キャンバスを開く'
};

export const OPEN_AKARI_CANVAS_ID = OPEN_AKARI_CANVAS.id;

/**
 * akari-preview から動画オープン時に呼ばれる内部コマンド。label なし = コマンドパレット非表示
 * （AKARI_TRANSCRIPT_SEEK_REQUESTED と同じ「ラベルなし内部コマンド」パターン）。
 */
export const ATTACH_AKARI_ANNOTATIONS_PASSIVE: Command = {
    id: 'akari.annotations.attachPassive'
};

/**
 * 分析レポート（akari-surfaces の WebviewWidget）内の `[data-block-id]` 要素クリックから、
 * `command:` URI 経由で通知される内部コマンド（doc-annotation-ui タスク・report.md §統合点調査）。
 * label なし = コマンドパレット非表示。webview は WebviewContentOptions.enableCommandUris で
 * このコマンドのみを許可される（akari-annotations-contribution.ts が付与する）。
 */
export const SELECT_DOC_BLOCK: Command = {
    id: 'akari.annotations.selectDocBlock'
};

/**
 * 分析レポート内の画像ブロック（`<img data-block-id>`、image-annotation-pen タスク）クリックから
 * 同じ `command:` URI 経由の bridge で通知される内部コマンド。SELECT_DOC_BLOCK と同じく
 * enableCommandUris の許可対象・label なし。
 */
export const SELECT_IMAGE_BLOCK: Command = {
    id: 'akari.annotations.selectImage'
};
