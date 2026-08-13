/** browser 実装や他拡張へ依存しないよう、同期対象の widget ID を文字列でミラーする。 */
export const AKARI_INSPECTOR_WIDGET_ID = 'akari-inspector-widget';
export const PARTNER_WIDGET_ID = 'akari-partner-onboarding';

export type RightPaneSyncAction = 'open-inspector' | 'show-partner' | 'skip';

export function resolveRightPaneSyncAction(
    currentRightWidgetId: string | undefined,
    hasSelection: boolean
): RightPaneSyncAction {
    const isSyncTarget = currentRightWidgetId === undefined
        || currentRightWidgetId === AKARI_INSPECTOR_WIDGET_ID
        || currentRightWidgetId === PARTNER_WIDGET_ID;
    if (!isSyncTarget) {
        return 'skip';
    }
    return hasSelection ? 'open-inspector' : 'show-partner';
}
