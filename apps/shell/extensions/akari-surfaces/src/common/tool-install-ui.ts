import type { AkariToolCheckResult, AkariToolId, AkariToolInstallResult } from './akari-new-project-protocol';

/**
 * 初回セットアップ v2（裁定 A）の道具ステップから UI を分離した純ロジック。
 * ダイアログ（browser 側）は状態機械の判定・進捗文字列・結果 3 値のマッピングを
 * ここへ寄せてテストする（task.md 手順 7）。
 */

export interface ToolSelectionSnapshot {
    selectedIds: ReadonlySet<AkariToolId>;
    unavailableIds: ReadonlySet<AkariToolId>;
}

/**
 * 未導入の道具にチェック（既定 ON）を導出する（裁定 A2）。
 * 直前の結果でも未導入だった道具は、ユーザーが外したチェックを再チェック後も尊重する。
 * 新たに未導入と分かった道具（初回・または導入済みから未導入へ戻った道具）は既定で ON。
 */
export function deriveToolSelection(
    tools: ReadonlyArray<Pick<AkariToolCheckResult, 'id' | 'available'>>,
    previous?: ToolSelectionSnapshot
): Set<AkariToolId> {
    const next = new Set<AkariToolId>();
    for (const tool of tools) {
        if (tool.available) {
            continue;
        }
        const wasUnavailableBefore = previous?.unavailableIds.has(tool.id) ?? false;
        const shouldCheck = wasUnavailableBefore ? previous!.selectedIds.has(tool.id) : true;
        if (shouldCheck) {
            next.add(tool.id);
        }
    }
    return next;
}

/** 「インストール中: FFmpeg (1/3)…」形式の進捗表示文字列。 */
export function formatInstallProgressLabel(toolName: string, index: number, total: number): string {
    return `インストール中: ${toolName} (${index}/${total})…`;
}

/** 結果 3 値（installed / external-installer-opened / failed）をそのまま表示できる 1 行へ寄せる。 */
export function describeToolInstallOutcome(result: AkariToolInstallResult, toolName: string): string {
    if (result.message) {
        return result.message;
    }
    switch (result.outcome) {
        case 'installed':
            return `${toolName} を導入しました。`;
        case 'external-installer-opened':
            return `${toolName} のインストーラーを開きました。完了したら再チェックしてください。`;
        case 'failed':
            return `${toolName} の導入に失敗しました。もう一度お試しください。`;
    }
}

/** 作成先パスをホーム配下のとき `~/` 短縮表示にする（作業場ステップ v2・裁定 B2）。 */
export function shortenHomePath(path: string, homeDir: string | undefined): string {
    if (!homeDir) {
        return path;
    }
    const normalizedHome = homeDir.replace(/[\\/]+$/, '');
    const normalizedPath = path;
    if (normalizedPath === normalizedHome) {
        return '~';
    }
    if (normalizedPath.startsWith(`${normalizedHome}/`)) {
        return `~${normalizedPath.slice(normalizedHome.length)}`;
    }
    if (normalizedPath.startsWith(`${normalizedHome}\\`)) {
        return `~${normalizedPath.slice(normalizedHome.length)}`;
    }
    return path;
}
