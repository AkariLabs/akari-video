import { QuickExportPhase, QuickExportStatus } from './quick-export-protocol';

/**
 * render.json は前回実行の成功結果を保持し得るため、今回の quick export が
 * 実行中・中断・失敗の間は併記しない。未実行と正常完了では従来どおり表示する。
 */
export function shouldShowRenderJsonProgress(phase: QuickExportPhase | undefined): boolean {
    return phase === undefined || phase === 'idle' || phase === 'done';
}

/**
 * quick export の終端失敗を Theia 通知へ変換する。alreadyNotified を入力に含め、
 * ポーリングが同じ status を複数回返しても二重通知しない契約を純関数で固定する。
 */
export function quickExportErrorNotification(
    status: QuickExportStatus,
    alreadyNotified: boolean
): string | undefined {
    if (alreadyNotified) {
        return undefined;
    }
    if (status.phase === 'failed') {
        const summary = status.failureSummary || '理由が返されませんでした。ログを確認してください';
        return `書き出しに失敗しました: ${summary.split(/\r?\n/)[0]}`;
    }
    if (status.phase === 'lint-failed') {
        const counts = lintFindingCounts(status);
        const reportHint = status.reportPath
            ? 'lint レポートを開いて確認できます。'
            : 'ログを確認してください。';
        return `lint NG（${counts}）のため書き出しを中断しました。${reportHint}`;
    }
    return undefined;
}

function lintFindingCounts(status: QuickExportStatus): string {
    const severityCounts: string[] = [];
    if (status.lintErrorCount !== undefined) {
        severityCounts.push(`エラー ${status.lintErrorCount} 件`);
    }
    if (status.lintWarningCount !== undefined) {
        severityCounts.push(`警告 ${status.lintWarningCount} 件`);
    }
    if (severityCounts.length > 0) {
        return severityCounts.join('・');
    }
    if (status.lintIssueCount !== undefined) {
        return `lint ${status.lintIssueCount} 件`;
    }
    return '件数不明';
}
