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

/**
 * akari-preview から動画オープン時に呼ばれる内部コマンド。label なし = コマンドパレット非表示
 * （AKARI_TRANSCRIPT_SEEK_REQUESTED と同じ「ラベルなし内部コマンド」パターン）。
 */
export const ATTACH_AKARI_ANNOTATIONS_PASSIVE: Command = {
    id: 'akari.annotations.attachPassive'
};
