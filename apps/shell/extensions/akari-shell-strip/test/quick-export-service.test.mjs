import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as waitForImmediate } from 'node:timers/promises';
import { AkariQuickExportServiceImpl } from '../lib/node/akari-quick-export-service.js';

test('start: バックエンドの予期しない例外を failed へ終端させる', async () => {
    class ThrowingService extends AkariQuickExportServiceImpl {
        async run() {
            throw new Error('unexpected test failure');
        }
    }

    const service = new ThrowingService();
    assert.deepEqual(await service.start({
        projectRootUri: 'file:///project',
        outputName: 'final.mp4',
        rerunLint: false
    }), { accepted: true });
    await waitForImmediate();

    const status = await service.getStatus();
    assert.equal(status.phase, 'failed');
    assert.match(status.failureSummary, /unexpected test failure/);
    assert.match(status.logTail, /unexpected test failure/);
});

test('start: render-cut CLI 不在は理由付き failed で終端する', async () => {
    class MissingCliService extends AkariQuickExportServiceImpl {
        fsPath() { return '/project'; }
        async findRenderCutCli() { return undefined; }
    }

    const service = new MissingCliService();
    assert.deepEqual(await service.start({
        projectRootUri: 'file:///project',
        outputName: 'final.mp4',
        rerunLint: false
    }), { accepted: true });
    await waitForImmediate();

    const status = await service.getStatus();
    assert.equal(status.phase, 'failed');
    assert.match(status.failureSummary, /render-cut CLI/);
    assert.match(status.failureSummary, /見つかりません/);
});

test('start: lint-failed に error / warning 件数とレポートを載せる', async () => {
    class LintFailureService extends AkariQuickExportServiceImpl {
        fsPath() { return '/project'; }
        async findEditLintCli() { return '/cli/edit-lint.mjs'; }
        async spawnNodeScript() {
            return {
                exitCode: 1,
                stdout: JSON.stringify({
                    findings: [
                        { severity: 'error' },
                        { severity: 'warning' }
                    ]
                }),
                stderr: ''
            };
        }
        async existingReportPath() { return '.akari/reports/edit-lint-report.html'; }
    }

    const service = new LintFailureService();
    assert.deepEqual(await service.start({
        projectRootUri: 'file:///project',
        outputName: 'final.mp4',
        rerunLint: true
    }), { accepted: true });
    await waitForImmediate();

    assert.deepEqual(await service.getStatus(), {
        phase: 'lint-failed',
        logTail: '',
        lintIssueCount: 2,
        lintErrorCount: 1,
        lintWarningCount: 1,
        reportPath: '.akari/reports/edit-lint-report.html'
    });
});
