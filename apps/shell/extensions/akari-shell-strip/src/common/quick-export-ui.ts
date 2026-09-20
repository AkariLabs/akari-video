import {
    formatLintFailureForUi,
    japaneseLintSummary,
    UiLintFinding
} from 'akari-annotations/lib/common/lint-message-ja';
import { QuickExportLintFinding, QuickExportPhase, QuickExportStatus } from './quick-export-protocol';
import { QuickExportStage, QuickExportVerifyCheck } from './quick-export-progress';

export function quickExportStageLabel(
    stage: QuickExportStage | undefined,
    verifyCheck?: QuickExportVerifyCheck
): string | undefined {
    switch (stage) {
        case 'prepare': return '準備';
        case 'audio-cut': return '音を切り出す';
        case 'render': return '映像を描いて圧縮する';
        case 'audio-mix': return '音と合わせて仕上げる';
        // 88 分 4K では確認だけで約 63 分かかり、そのうち黒画面検査が約 57 分を占める
        // （不具合メモ 第22項）。「確認」の 1 語だけでは止まったように見えるので、
        // 今どの工程かを添える。
        case 'verify': return verifyCheck
            ? `確認（${quickExportVerifyCheckLabel(verifyCheck)}）`
            : '確認';
        default: return undefined;
    }
}

export function quickExportVerifyCheckLabel(check: QuickExportVerifyCheck): string {
    switch (check) {
        case 'probe': return '仕様を読む';
        case 'video-identity': return '映像が同じか照合';
        case 'decode': return '全編を復号';
        case 'audio-decode': return '音声を復号';
        case 'audio-level': return '音量を測る';
        case 'motion': return '動きを測る';
        case 'blank-frames': return '黒画面を探す';
    }
}

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
        const findings = status.lintFindings ?? [];
        const errors = lintErrorDetails(findings);
        if (japaneseLintSummary(errors, findings as readonly UiLintFinding[])) {
            const prefix = '書き出しに失敗しました';
            const formatted = formatLintFailureForUi(
                prefix,
                errors,
                findings as readonly UiLintFinding[]
            );
            return formatted.slice(`${prefix}: `.length);
        }
        const counts = lintFindingCounts(status);
        const reportHint = status.reportPath
            ? 'lint レポートを開いて確認できます。'
            : 'ログを確認してください。';
        return `lint NG（${counts}）のため書き出しを中断しました。${reportHint}`;
    }
    return undefined;
}

function lintErrorDetails(findings: readonly QuickExportLintFinding[]): string[] {
    return findings
        .filter(finding => finding.severity === 'error')
        .map(finding => {
            const check = finding.check ? `[${finding.check}]` : '';
            return [check, finding.message].filter(Boolean).join(' ') || 'edit-lint error';
        });
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
