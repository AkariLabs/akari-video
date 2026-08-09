/**
 * プロジェクトの人間向け表示名の解決（task 2026-08-09-project-display-title）。
 * フォルダ名は作成時刻ベースの機械 ID のまま変えない（オーナー裁定: フォルダ名 = 機械の ID /
 * 表示名 = 別に持つ）。人が読む名前は `.akari/intake.json` の `title` に置き、
 * ホームのプロジェクトカード・ウィンドウ/タブタイトルなど全ての表示箇所はここを通す。
 */

/** intake.json をパースした結果から title を読む。文字列以外・空文字・キー無しは null に正規化する。 */
export function parseIntakeTitle(parsed: unknown): string | null {
    const value = (parsed as { title?: unknown } | null | undefined)?.title;
    return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

/** title ?? フォルダ名。title が無い（既存プロジェクト）・null・空文字はフォルダ名へフォールバックする。 */
export function resolveProjectDisplayName(title: string | null | undefined, folderName: string): string {
    return typeof title === 'string' && title.trim().length > 0 ? title : folderName;
}
