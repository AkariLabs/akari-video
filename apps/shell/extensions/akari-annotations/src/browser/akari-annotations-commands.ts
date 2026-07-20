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
