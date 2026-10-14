import { t } from '@akari-video/i18n';
/** 保存層の型名や英語を画面へ出さず、操作の失敗理由を短く示す。 */
export function canvasOperationReason(error: unknown): string {
    const detail = error instanceof Error ? error.message : String(error);
    if (detail.includes('2 個以上')) return t('annotationscommon.canvasOperationReason.action.selectLeastTwoItems');
    if (detail.includes('同じ場所') || detail.includes('同じグループ')) return t('annotationscommon.canvasOperationReason.action.selectItemsSameLevel');
    if (detail.includes('袋')) return t('annotationscommon.canvasOperationReason.action.moveContentsOutGroupFirst');
    if (detail.includes('より前')) return t('annotationscommon.canvasOperationReason.error.cannotPlaceBeforeCanvasStarts');
    if (detail.includes('ロック')) return t('annotationscommon.canvasOperationReason.action.unlockBeforeContinuing');
    if (detail.includes('自分自身')) return t('annotationscommon.canvasOperationReason.error.cannotPlaceItemInsideItself');
    if (detail.includes('見つかりません')) return t('annotationscommon.canvasOperationReason.error.itemNotFoundReloadTryAgain');
    return t('annotationscommon.canvasOperationReason.error.cannotCompleteActionCheckSelectionTime');
}
