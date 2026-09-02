import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as waitForImmediate } from 'node:timers/promises';
import {
    AkariQuickExportServiceImpl,
    buildRevealArtifactCommand
} from '../lib/node/akari-quick-export-service.js';

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
                        {
                            check: 'cuts.track-transition-unsupported',
                            severity: 'error',
                            message: 'gap-aware track engine cannot represent xfade'
                        },
                        {
                            check: 'timeline.tracks.declaration-missing',
                            severity: 'warning',
                            message: 'timeline track declaration is missing'
                        }
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
        lintFindings: [
            {
                check: 'cuts.track-transition-unsupported',
                severity: 'error',
                message: 'gap-aware track engine cannot represent xfade'
            },
            {
                check: 'timeline.tracks.declaration-missing',
                severity: 'warning',
                message: 'timeline track declaration is missing'
            }
        ],
        reportPath: '.akari/reports/edit-lint-report.html'
    });
});

test('start: render-cut の stage / frame 出力を status の詳細進捗へ載せる', async () => {
    class ProgressService extends AkariQuickExportServiceImpl {
        fsPath() { return '/project'; }
        async findRenderCutCli() { return '/cli/render-cut.mjs'; }
        async spawnNodeScript(_scriptPath, _args, onChunk) {
            onChunk('PROGRESS stage=prepare status=start\nPROGRESS stage=prepare status=end\n');
            onChunk('PROGRESS stage=audio-cut status=start\nPROGRESS stage=audio-cut status=end\n');
            onChunk('PROGRESS stage=render status=start engine=gpu\nPROGRESS frame=3 total=10\n');
            return { exitCode: 2, stdout: '', stderr: 'test stop' };
        }
        async statOrUndefined() { return undefined; }
    }

    const service = new ProgressService();
    assert.deepEqual(await service.start({
        projectRootUri: 'file:///project',
        outputName: 'final.mp4',
        rerunLint: false
    }), { accepted: true });
    await waitForImmediate();

    const status = await service.getStatus();
    assert.equal(status.progressStage, 'render');
    assert.equal(status.progressFrame, 3);
    assert.equal(status.progressTotalFrames, 10);
    assert.equal(status.progressEngine, 'gpu');
    assert.equal(status.progressPercent, 33);
});

test('cancel: 実行中の子プロセスへ SIGTERM を送り cancelled へ終端する', async () => {
    class CancelService extends AkariQuickExportServiceImpl {
        constructor() {
            super();
            this.signals = [];
            this.fakeChild = {
                kill: signal => {
                    this.signals.push(signal);
                    queueMicrotask(() => {
                        this.activeChild = undefined;
                        this.closeListener?.();
                    });
                    return true;
                },
                once: (event, listener) => {
                    if (event === 'close') this.closeListener = listener;
                    return this.fakeChild;
                }
            };
        }
        prime() {
            this.running = true;
            this.activeChild = this.fakeChild;
            this.status = { phase: 'rendering', logTail: '' };
        }
    }
    const service = new CancelService();
    service.prime();
    assert.deepEqual(await service.cancel(), { cancelled: true });
    assert.deepEqual(service.signals, ['SIGTERM']);
    assert.equal((await service.getStatus()).phase, 'cancelled');
});

test('revealArtifact: OS ごとのファイル管理コマンドを組み立てる', () => {
    assert.deepEqual(buildRevealArtifactCommand('darwin', '/project/exports/final.mp4'), {
        command: 'open', args: ['-R', '/project/exports/final.mp4']
    });
    assert.deepEqual(buildRevealArtifactCommand('win32', 'C:\\project\\exports\\final.mp4'), {
        command: 'explorer', args: ['/select,C:\\project\\exports\\final.mp4']
    });
    assert.deepEqual(buildRevealArtifactCommand('linux', '/project/exports/final.mp4'), {
        command: 'xdg-open', args: ['/project/exports']
    });
});
