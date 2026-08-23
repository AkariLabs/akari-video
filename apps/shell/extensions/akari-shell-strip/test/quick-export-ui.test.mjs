import test from 'node:test';
import assert from 'node:assert/strict';
import {
    quickExportErrorNotification,
    shouldShowRenderJsonProgress
} from '../lib/common/quick-export-ui.js';

test('shouldShowRenderJsonProgress: quick export phase ごとの真理値表', () => {
    const cases = [
        [undefined, true],
        ['idle', true],
        ['done', true],
        ['linting', false],
        ['rendering', false],
        ['lint-failed', false],
        ['failed', false]
    ];
    for (const [phase, expected] of cases) {
        assert.equal(shouldShowRenderJsonProgress(phase), expected, `phase=${String(phase)}`);
    }
});

test('quickExportErrorNotification: lint-failed は severity 件数とレポート案内を通知する', () => {
    const status = {
        phase: 'lint-failed',
        logTail: '',
        lintIssueCount: 2,
        lintErrorCount: 1,
        lintWarningCount: 1,
        reportPath: '.akari/reports/edit-lint-report.html'
    };
    assert.equal(
        quickExportErrorNotification(status, false),
        'lint NG（エラー 1 件・警告 1 件）のため書き出しを中断しました。lint レポートを開いて確認できます。'
    );
});

test('quickExportErrorNotification: 既知 check は日本語要約と従来の英語詳細を通知する', () => {
    const status = {
        phase: 'lint-failed',
        logTail: '',
        lintIssueCount: 1,
        lintErrorCount: 1,
        lintWarningCount: 0,
        lintFindings: [{
            check: 'cuts.track-transition-unsupported',
            severity: 'error',
            message: 'gap-aware track engine cannot represent xfade'
        }]
    };
    assert.equal(
        quickExportErrorNotification(status, false),
        'このトランジションは現在のトラック順では書き出せません。' +
            'トランジションを削除するか、トラックを既定順へ戻してください。 ' +
            '詳細: [cuts.track-transition-unsupported] gap-aware track engine cannot represent xfade'
    );
});

test('quickExportErrorNotification: 辞書に無い check は従来表示へフォールバックする', () => {
    const status = {
        phase: 'lint-failed',
        logTail: '',
        lintIssueCount: 1,
        lintErrorCount: 1,
        lintWarningCount: 0,
        lintFindings: [{
            check: 'future.unknown',
            severity: 'error',
            message: 'original english detail'
        }],
        reportPath: '.akari/reports/edit-lint-report.html'
    };
    assert.equal(
        quickExportErrorNotification(status, false),
        'lint NG（エラー 1 件・警告 0 件）のため書き出しを中断しました。lint レポートを開いて確認できます。'
    );
});

test('quickExportErrorNotification: 通知済みなら lint-failed を多重通知しない', () => {
    const status = {
        phase: 'lint-failed',
        logTail: '',
        lintIssueCount: 2,
        lintErrorCount: 1,
        lintWarningCount: 1
    };
    assert.equal(quickExportErrorNotification(status, true), undefined);
});

test('quickExportErrorNotification: failed の既存通知と非終端 phase を維持する', () => {
    assert.equal(
        quickExportErrorNotification({ phase: 'failed', logTail: '', failureSummary: 'CLI が見つかりません' }, false),
        '書き出しに失敗しました: CLI が見つかりません'
    );
    assert.equal(quickExportErrorNotification({ phase: 'rendering', logTail: '' }, false), undefined);
    assert.equal(quickExportErrorNotification({ phase: 'done', logTail: '' }, false), undefined);
});
