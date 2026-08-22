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
