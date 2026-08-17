/**
 * プロジェクト・ランチャーポップアップ（task 2026-08-17-home-launcher-popup）の表示規則。
 * 正本: 内部リポ `planning/notes-2026-08-17-firstrun-v2-and-launcher.md` 裁定 D + §3.2。
 *
 * ここは純ロジックのみを持つ。ダイアログの生成・DOM・ファイル I/O は
 * `akari-home-widget.tsx` / `akari-project-launcher-dialog.ts` 側の責務。
 */

export interface LauncherAutoOpenContext {
    /** ワークスペース root を開いて起動したか（true ならランチャーは出さない）。 */
    hasOpenProject: boolean;
    /**
     * この起動で初回セットアップダイアログが自動表示される予定か。
     * true の間はここではランチャーを開かない — 完全初回はセットアップが優先し、
     * その `onFinished` からの明示 open にランチャー表示を委ねる（正本 §3.2）。
     */
    firstRunWillAutoOpen: boolean;
    /** 同一ウィンドウセッション内で既に × / Esc（または一覧からの選択）で閉じたか。 */
    dismissedThisSession: boolean;
}

/**
 * 起動時（または再表示のたびの判定）にランチャーを自動表示するかどうか。
 * プロジェクトを開いて起動した場合・初回セットアップが優先される場合・
 * 同一セッション内で既に閉じられている場合はいずれも false。
 */
export function shouldAutoOpenProjectLauncher(context: LauncherAutoOpenContext): boolean {
    if (context.hasOpenProject) {
        return false;
    }
    if (context.firstRunWillAutoOpen) {
        return false;
    }
    return !context.dismissedThisSession;
}
