/** browser 実装や他拡張へ依存しないよう、同期対象の widget ID を文字列でミラーする。 */
export const AKARI_INSPECTOR_WIDGET_ID = 'akari-inspector-widget';
export const PARTNER_WIDGET_ID = 'akari-partner-onboarding';

export type RightPaneSyncAction = 'open-inspector' | 'show-partner' | 'attach-inspector' | 'skip';

export function resolveRightPaneSyncAction(
    currentRightWidgetId: string | undefined,
    hasSelection: boolean
): RightPaneSyncAction {
    const isSyncTarget = currentRightWidgetId === undefined
        || currentRightWidgetId === AKARI_INSPECTOR_WIDGET_ID
        || currentRightWidgetId === PARTNER_WIDGET_ID;
    if (!isSyncTarget) {
        // 同期対象外のタブ（パートナー AI・注釈など）を使用中は焦点を奪わない。ただし選択が
        // あるならインスペクターをバックグラウンドのタブとして常駐だけさせる（実機報告
        // 2026-08-18: パートナー AI タブが常時 current のため 'skip' しか出ず、遅延生成の
        // インスペクターが一度も生成されずアイコン自体が右パネルに存在しなかった）。
        return hasSelection ? 'attach-inspector' : 'skip';
    }
    return hasSelection ? 'open-inspector' : 'show-partner';
}
