/** 右ドックのタブは共通スタイルの間隔で積み、注釈だけの位置調整は行わない。 */
export const RIGHT_PANEL_TAB_STYLE_CSS = '';

/** akari-annotations-contribution.ts が渡す `shell.rightPanelHandler.tabBar` の最小形。 */
export interface LuminoUpdatable {
    update(): void;
}

/** 呼び出し元との契約を維持する。タブのサイズ・アイコン・間隔は共通スタイルに委ねる。 */
export function installRightPanelTabStyle(tabBar: LuminoUpdatable): void {
    void tabBar;
}
