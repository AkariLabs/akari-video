/**
 * `AkariPreviewOpenHandler.openOutput()`（edit.json を開く経路）の焦点制御規則（task
 * 2026-08-17-shell-right-panel-order-and-focus 指示3）を DOM / ApplicationShell から切り離した
 * 純関数として切り出したもの。node --test で before/after を検証できるようにする。
 *
 * 値の語彙は Theia 本体の WidgetOpenMode（@theia/core/lib/browser/widget-open-handler.js
 * `doOpen()` 実装を実測 — 既定 'activate'、'activate' は activateWidget、'reveal' は
 * revealWidget、'open' は addWidget 済みであれば何もしない）と同じにしてある。
 *
 * 本タスクが変えるのは「明示 mode が無いときの既定値」だけ: Theia 本体は常に 'activate' 既定だが、
 * ここでは「新規作成された widget だけ activate、既に存在した widget の再 open（別経路からの open
 * を含む）は reveal に留める」— 表示中の別タブの焦点を奪わないため。
 */
export type OutputOpenMode = 'open' | 'reveal' | 'activate';

export function resolveOutputOpenFocusMode(
    explicitMode: OutputOpenMode | undefined,
    wasAlreadyOpen: boolean
): OutputOpenMode {
    if (explicitMode) {
        return explicitMode;
    }
    return wasAlreadyOpen ? 'reveal' : 'activate';
}
