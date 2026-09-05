import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as waitForImmediate } from 'node:timers/promises';
import {
    AkariQuickExportServiceImpl,
    buildRevealArtifactCommand
} from '../lib/node/akari-quick-export-service.js';
import { resolveExportPreviewPath } from '../lib/node/akari-quick-export-service.js';

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

test('copyArtifact: コピーコマンドの終了コードを結果へ反映する', async () => {
    class CopyService extends AkariQuickExportServiceImpl {
        constructor(exitCode) {
            super();
            this.exitCode = exitCode;
        }
        prime() {
            this.currentProjectRoot = '/project';
            this.status = { phase: 'done', logTail: '', artifactPath: 'exports/final.mp4' };
        }
        platform() { return 'darwin'; }
        async spawnCopyCommand(command, args, stdin) {
            this.copyRequest = { command, args, stdin };
            return this.exitCode;
        }
    }

    const successful = new CopyService(0);
    successful.prime();
    assert.deepEqual(await successful.copyArtifact(), { copied: true });
    assert.deepEqual(successful.copyRequest, {
        command: 'osascript',
        args: ['-e', 'set the clipboard to POSIX file "/project/exports/final.mp4"'],
        stdin: undefined
    });

    const failed = new CopyService(7);
    failed.prime();
    const failure = await failed.copyArtifact();
    assert.equal(failure.copied, false);
    assert.match(failure.reason, /exit code 7/);
});

test('readPreviewFrame: 許可ディレクトリ配下の JPEG を data URL として返す', async () => {
    class PreviewService extends AkariQuickExportServiceImpl {
        constructor() {
            super();
            this.currentProjectRoot = '/project';
            this.fsImpl = {
                readFile: async path => {
                    this.readPath = path;
                    return Buffer.from([0xff, 0xd8, 0xff]);
                }
            };
        }
    }
    const path = '/project/.akari/cache/export-preview/30.jpg';
    assert.equal(resolveExportPreviewPath('/project', path), path);
    const service = new PreviewService();
    assert.equal(await service.readPreviewFrame(path), 'data:image/jpeg;base64,/9j/');
    assert.equal(service.readPath, path);
});

test('readPreviewFrame: 許可ディレクトリ外を拒否してファイルを読まない', async () => {
    class GuardedPreviewService extends AkariQuickExportServiceImpl {
        constructor() {
            super();
            this.currentProjectRoot = '/project';
            this.readCount = 0;
            this.fsImpl = {
                readFile: async () => {
                    this.readCount += 1;
                    return Buffer.from('unexpected');
                }
            };
        }
    }
    const outside = '/project/exports/final.mp4';
    const traversal = '/project/.akari/cache/export-preview/../../../etc/passwd';
    assert.equal(resolveExportPreviewPath('/project', outside), undefined);
    assert.equal(resolveExportPreviewPath('/project', traversal), undefined);
    const service = new GuardedPreviewService();
    assert.equal(await service.readPreviewFrame(outside), undefined);
    assert.equal(await service.readPreviewFrame(traversal), undefined);
    assert.equal(service.readCount, 0);
});

// --- recheckLint（task 2026-09-03-export-lint-auto-recheck）--------------------

const LINT_FAILED_STATUS = {
    phase: 'lint-failed',
    logTail: '直前の書き出しログ',
    lintIssueCount: 1,
    lintErrorCount: 1,
    lintWarningCount: 0,
    lintFindings: [{ check: 'captions.overlap', severity: 'error', message: 'old finding' }],
    reportPath: '.akari/reports/edit-lint-report.html'
};

class RecheckService extends AkariQuickExportServiceImpl {
    constructor(spawnResult) {
        super();
        this.spawnResult = spawnResult;
        this.spawnCalls = [];
        this.status = { ...LINT_FAILED_STATUS };
    }
    fsPath() { return '/project'; }
    now() { return 1_772_000_000_000; }
    async findEditLintCli() { return '/cli/edit-lint.mjs'; }
    async existingReportPath() { return '.akari/reports/edit-lint-report.html'; }
    async spawnNodeScript(script, args, onChunk, options) {
        this.spawnCalls.push({ script, args, options });
        return this.spawnResult;
    }
}

test('recheckLint: 直っていれば保持していた lint-failed を idle へ戻す', async () => {
    const service = new RecheckService({ exitCode: 0, stdout: '{"findings":[]}', stderr: '' });

    const result = await service.recheckLint({ projectRootUri: 'file:///project' });

    assert.equal(result.outcome, 'pass');
    assert.equal(result.status.phase, 'idle');
    assert.equal(result.status.lintFindings, undefined);
    assert.equal(result.status.lintErrorCount, undefined);
    assert.equal(result.status.lintCheckedAt, 1_772_000_000_000);
    assert.equal((await service.getStatus()).phase, 'idle');
    // 再検査は書き出しのログを汚さない（子プロセス出力は status.logTail へ流さない）。
    assert.equal((await service.getStatus()).logTail, '直前の書き出しログ');
    // 中止ボタンの対象にしない子として起動する。
    assert.deepEqual(service.spawnCalls[0].options, { trackActive: false });
    assert.deepEqual(service.spawnCalls[0].args, ['/project', '--json']);
});

test('recheckLint: まだ NG なら findings を最新へ差し替える', async () => {
    const service = new RecheckService({
        exitCode: 1,
        stdout: JSON.stringify({
            findings: [
                { check: 'captions.overlap', severity: 'error', message: 'new finding' },
                { check: 'timeline.tracks.declaration-missing', severity: 'warning', message: 'warn' }
            ]
        }),
        stderr: ''
    });

    const result = await service.recheckLint({ projectRootUri: 'file:///project' });

    assert.equal(result.outcome, 'lint-failed');
    assert.equal(result.status.phase, 'lint-failed');
    assert.equal(result.status.lintIssueCount, 2);
    assert.equal(result.status.lintErrorCount, 1);
    assert.equal(result.status.lintWarningCount, 1);
    assert.equal(result.status.lintFindings[0].message, 'new finding');
    assert.equal(result.status.lintCheckedAt, 1_772_000_000_000);
});

test('recheckLint: 書き出しの実行中は走らせず status も触らない', async () => {
    const service = new RecheckService({ exitCode: 0, stdout: '{"findings":[]}', stderr: '' });
    service.running = true;

    const result = await service.recheckLint({ projectRootUri: 'file:///project' });

    assert.equal(result.outcome, 'skipped');
    assert.equal(result.status.phase, 'lint-failed');
    assert.equal(service.spawnCalls.length, 0);
});

test('recheckLint: 再検査の最中に書き出しが始まったら結果を捨てる', async () => {
    class RaceService extends RecheckService {
        async spawnNodeScript(script, args, onChunk, options) {
            this.running = true;
            return super.spawnNodeScript(script, args, onChunk, options);
        }
    }
    const service = new RaceService({ exitCode: 0, stdout: '{"findings":[]}', stderr: '' });

    const result = await service.recheckLint({ projectRootUri: 'file:///project' });

    assert.equal(result.outcome, 'skipped');
    assert.equal((await service.getStatus()).phase, 'lint-failed');
});

test('recheckLint: CLI 不在・異常終了は unavailable として保持中の所見を残す', async () => {
    class MissingCliService extends RecheckService {
        async findEditLintCli() { return undefined; }
    }
    const missing = new MissingCliService({ exitCode: 0, stdout: '', stderr: '' });
    const missingResult = await missing.recheckLint({ projectRootUri: 'file:///project' });
    assert.equal(missingResult.outcome, 'unavailable');
    assert.match(missingResult.reason, /edit-lint CLI/);
    assert.equal(missingResult.status.phase, 'lint-failed');
    assert.equal(missingResult.status.lintFindings[0].message, 'old finding');

    const crashed = new RecheckService({ exitCode: 2, stdout: '', stderr: 'boom' });
    const crashedResult = await crashed.recheckLint({ projectRootUri: 'file:///project' });
    assert.equal(crashedResult.outcome, 'unavailable');
    assert.match(crashedResult.reason, /boom|exit code 2/);
    assert.equal(crashedResult.status.phase, 'lint-failed');
});
