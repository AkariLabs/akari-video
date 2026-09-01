import { injectable } from '@theia/core/shared/inversify';
import URI from '@theia/core/lib/common/uri';
import { type ChildProcessWithoutNullStreams, spawn } from 'child_process';
import { promises as fs } from 'fs';
import { join, resolve } from 'path';
import {
    AkariQuickExportService,
    QuickExportLintFinding,
    QuickExportStartOutcome,
    QuickExportStartRequest,
    QuickExportStatus
} from '../common/quick-export-protocol';
import {
    buildEditLintArgs,
    buildRenderCutArgs,
    buildRenderCutOutputPath,
    describeRenderFailure,
    describeUnexpectedQuickExportFailure,
    determineLintOutcome,
    determineRenderOutcome,
    QuickExportRenderSettings,
    summarizeStderrTail
} from '../common/quick-export-cli';
import { estimateElapsedAndRemaining, latestQuickExportProgress } from '../common/quick-export-progress';
import { packagedCliCandidates } from './packaged-cli-candidates';
import { childNodeEnvironment, electronResourcesPath } from './child-node-process';

const LOG_TAIL_MAX_CHARS = 4000;
const EDIT_LINT_REPORT_RELATIVE_PATH = join('.akari', 'reports', 'edit-lint-report.html');
const RENDER_CUT_REPORT_RELATIVE_PATH = join('.akari', 'reports', 'render-report.html');

interface SpawnResult {
    readonly exitCode: number | null;
    readonly stdout: string;
    readonly stderr: string;
}

/**
 * `packages/edit-lint` / `packages/render-cut` の既存 CLI を子プロセスとして
 * 直接実行するだけの薄いサービス（both packages 無改造・CLI 呼び出しのみ —
 * task.md 境界）。実行中は `status` フィールドを随時更新し、フロントエンドは
 * `getStatus` をポーリングして進捗を表示する。
 */
@injectable()
export class AkariQuickExportServiceImpl implements AkariQuickExportService {
    protected running = false;
    protected status: QuickExportStatus = { phase: 'idle', logTail: '' };
    protected logBuffer = '';
    /** render-cut フェーズ開始時刻（--progress の経過/残り時間見積もりに使う）。 */
    protected renderStartedAt: number | undefined;
    /** テストからの上書き用（実 CLI を起動しない）。 */
    protected readonly fsImpl: typeof fs = fs;

    async start(request: QuickExportStartRequest): Promise<QuickExportStartOutcome> {
        if (this.running) {
            return { accepted: false, reason: 'already-running' };
        }
        this.running = true;
        this.logBuffer = '';
        this.status = { phase: request.rerunLint ? 'linting' : 'rendering', logTail: '' };
        void this.run(request)
            .catch(error => {
                const failureSummary = describeUnexpectedQuickExportFailure(error, '書き出しバックエンドで予期しないエラーが発生しました');
                this.appendLog(`${failureSummary}\n`);
                this.updateStatus({ phase: 'failed', failureSummary });
            })
            .finally(() => {
                this.running = false;
            });
        return { accepted: true };
    }

    async getStatus(): Promise<QuickExportStatus> {
        return this.status;
    }

    protected async run(request: QuickExportStartRequest): Promise<void> {
        const projectRoot = this.fsPath(request.projectRootUri);

        if (request.rerunLint) {
            const lintOutcome = await this.runEditLintPhase(projectRoot);
            if (lintOutcome !== 'pass') {
                return;
            }
        }

        await this.runRenderCutPhase(projectRoot, {
            outputName: request.outputName,
            quality: request.quality,
            engine: request.engine,
            encoder: request.encoder,
            fps: request.fps,
            outputDirectory: request.outputDirectoryUri ? this.fsPath(request.outputDirectoryUri) : undefined
        });
    }

    protected async runEditLintPhase(projectRoot: string): Promise<'pass' | 'fail' | 'error'> {
        this.updateStatus({ phase: 'linting' });
        const cli = await this.findEditLintCli();
        if (!cli) {
            this.updateStatus({
                phase: 'failed',
                logTail: 'edit-lint CLI が見つかりませんでした',
                failureSummary: 'edit-lint CLI が見つかりませんでした（packages/edit-lint/bin/edit-lint.mjs 不在）'
            });
            return 'error';
        }
        const result = await this.spawnNodeScript(cli, buildEditLintArgs(projectRoot), chunk => this.appendLog(chunk));
        const outcome = determineLintOutcome(result.exitCode);
        if (outcome === 'pass') {
            return 'pass';
        }
        if (outcome === 'fail') {
            const lintSummary = this.parseLintFindingSummary(result.stdout);
            this.updateStatus({
                phase: 'lint-failed',
                lintIssueCount: lintSummary?.issueCount,
                lintErrorCount: lintSummary?.errorCount,
                lintWarningCount: lintSummary?.warningCount,
                lintFindings: lintSummary?.findings,
                reportPath: await this.existingReportPath(projectRoot, EDIT_LINT_REPORT_RELATIVE_PATH)
            });
            return 'fail';
        }
        const failureSummary = summarizeStderrTail(result.stderr)
            || `edit-lint が exit code ${result.exitCode ?? '不明'} で終了しました（エラー出力はありません）`;
        this.updateStatus({ phase: 'failed', failureSummary });
        return 'error';
    }

    protected async runRenderCutPhase(projectRoot: string, settings: QuickExportRenderSettings): Promise<void> {
        this.updateStatus({
            phase: 'rendering',
            progressPercent: undefined,
            progressElapsedMs: undefined,
            progressRemainingMs: undefined
        });
        const cli = await this.findRenderCutCli();
        if (!cli) {
            this.updateStatus({
                phase: 'failed',
                failureSummary: 'render-cut CLI が見つかりませんでした（packages/render-cut/bin/render-cut.mjs 不在）'
            });
            return;
        }
        this.renderStartedAt = Date.now();
        const result = await this.spawnNodeScript(cli, buildRenderCutArgs(projectRoot, settings), chunk => this.appendRenderLog(chunk));
        const outputRelativePath = buildRenderCutOutputPath(settings.outputName, settings.outputDirectory);
        const outputAbsolutePath = resolve(projectRoot, outputRelativePath);
        const outputStat = await this.statOrUndefined(outputAbsolutePath);
        const outcome = determineRenderOutcome(result.exitCode, outputStat && { exists: true, size: outputStat.size });
        if (outcome === 'success' && outputStat) {
            this.updateStatus({
                phase: 'done',
                artifactPath: outputRelativePath,
                artifactSize: outputStat.size,
                reportPath: await this.existingReportPath(projectRoot, RENDER_CUT_REPORT_RELATIVE_PATH)
            });
            return;
        }
        this.updateStatus({
            phase: 'failed',
            failureSummary: describeRenderFailure(result.exitCode, result.stderr, outputRelativePath, outputStat)
        });
    }

    protected parseLintFindingSummary(stdout: string): {
        issueCount: number;
        errorCount: number;
        warningCount: number;
        findings: QuickExportLintFinding[];
    } | undefined {
        try {
            const parsed = JSON.parse(stdout) as {
                findings?: Array<{ check?: unknown; severity?: unknown; message?: unknown }>;
            };
            if (!Array.isArray(parsed.findings)) {
                return undefined;
            }
            const findings = parsed.findings.map(finding => ({
                check: typeof finding?.check === 'string' ? finding.check : undefined,
                severity: typeof finding?.severity === 'string' ? finding.severity : undefined,
                message: typeof finding?.message === 'string' ? finding.message : undefined
            }));
            return {
                issueCount: findings.length,
                errorCount: findings.filter(finding => finding.severity === 'error').length,
                warningCount: findings.filter(finding => finding.severity === 'warning').length,
                findings
            };
        } catch {
            return undefined;
        }
    }

    protected async existingReportPath(projectRoot: string, relativePath: string): Promise<string | undefined> {
        try {
            await this.fsImpl.stat(join(projectRoot, relativePath));
            return relativePath;
        } catch {
            return undefined;
        }
    }

    protected async statOrUndefined(path: string): Promise<{ size: number } | undefined> {
        try {
            const stat = await this.fsImpl.stat(path);
            return { size: stat.size };
        } catch {
            return undefined;
        }
    }

    protected appendLog(chunk: string): void {
        this.logBuffer = (this.logBuffer + chunk).slice(-LOG_TAIL_MAX_CHARS);
        this.updateStatus({ logTail: this.logBuffer });
    }

    /**
     * render-cut フェーズ専用の onChunk（edit-lint フェーズは appendLog のみを使う —
     * lint の stdout に PROGRESS 行が混じることはないため、進捗解析はここだけで十分）。
     * ログ蓄積は appendLog に委ね、そのうえで直近の PROGRESS 行から % と経過/残り
     * 時間を見積もって status に反映する。
     */
    protected appendRenderLog(chunk: string): void {
        this.appendLog(chunk);
        const snapshot = latestQuickExportProgress(this.logBuffer);
        if (!snapshot || this.renderStartedAt === undefined) {
            return;
        }
        const elapsedMs = Date.now() - this.renderStartedAt;
        const { remainingMs } = estimateElapsedAndRemaining(snapshot, elapsedMs);
        this.updateStatus({
            progressPercent: snapshot.percent,
            progressElapsedMs: elapsedMs,
            progressRemainingMs: remainingMs
        });
    }

    /** 既存フィールド（特に随時伸びる logTail）は明示されない限り保持する。 */
    protected updateStatus(patch: Partial<QuickExportStatus>): void {
        this.status = { ...this.status, ...patch };
    }

    /**
     * `theia build` は backend を単一バンドル（`apps/shell/lib/backend/main.js`）
     * に固めるため、実行時の `__dirname` は元の `src/node/*.ts` の場所ではなく
     * 常に `apps/shell/lib/backend` になる（akari-preview-service.ts /
     * akari-project-service.ts の同種コメント・実測で確認済み）。
     * 候補の組み立ては packaged-cli-candidates.ts に集約する（`process.cwd()` を
     * 使わない理由と 3 段の内訳はそちらのコメント参照）。
     */
    protected async findEditLintCli(): Promise<string | undefined> {
        return this.findCli(packagedCliCandidates('edit-lint', 'edit-lint.mjs', __dirname, this.resourcesPath()));
    }

    protected async findRenderCutCli(): Promise<string | undefined> {
        return this.findCli(packagedCliCandidates('render-cut', 'render-cut.mjs', __dirname, this.resourcesPath()));
    }

    /** Electron が packaged 時のみ設定する `Contents/Resources`（開発起動では undefined）。 */
    protected resourcesPath(): string | undefined {
        return electronResourcesPath();
    }

    /**
     * どの候補で当たったかをログへ残す。同梱漏れ・配置ずれの切り分けは
     * 「見つからなかった」より「どこで見つけたか」の方が速いため
     * （実測: v0.1.12 では 4 候補すべてが外れており、CLI が見つからない理由の
     * 特定に .app を開ける必要があった）。
     */
    protected async findCli(candidates: readonly string[]): Promise<string | undefined> {
        for (const [index, candidate] of candidates.entries()) {
            try {
                if ((await this.fsImpl.stat(candidate)).isFile()) {
                    this.appendLog(`CLI 解決: 候補 ${index + 1}/${candidates.length} = ${candidate}\n`);
                    return candidate;
                }
            } catch {
                // 次の候補（パッケージ版配置 / 祖先探索 / 後方互換配置）を試す。
            }
        }
        this.appendLog(`CLI 解決に失敗（試した候補 ${candidates.length} 件）:\n${candidates.map(c => `  - ${c}`).join('\n')}\n`);
        return undefined;
    }

    /**
     * 子プロセス（edit-lint / render-cut。render-cut はさらに bake-layer を spawn する）へ渡す環境。
     * `AKARI_FFMPEG_BIN` / `AKARI_FFPROBE_BIN` を明示的に載せる理由と優先順位は
     * child-node-process.ts（preview-server バックエンドと共有）のコメント参照。
     */
    protected childEnvironment(): NodeJS.ProcessEnv {
        return childNodeEnvironment(this.resourcesPath());
    }

    /**
     * Electron のバックエンドプロセスから素の node スクリプトを起動する
     * （ELECTRON_RUN_AS_NODE は akari-project-service.ts の runNodeScript /
     * akari-partner-server.ts の bootstrap と同じ流儀）。stdout/stderr は
     * 受信のたびに onChunk へ渡す（ポーリングされる `status.logTail` の
     * ストリーム更新に使う）。
     */
    protected spawnNodeScript(scriptPath: string, args: string[], onChunk: (chunk: string) => void): Promise<SpawnResult> {
        return new Promise(resolvePromise => {
            let stdout = '';
            let stderr = '';
            let settled = false;
            const settle = (result: SpawnResult): void => {
                if (!settled) {
                    settled = true;
                    resolvePromise(result);
                }
            };
            let child: ChildProcessWithoutNullStreams;
            try {
                child = spawn(process.execPath, [scriptPath, ...args], {
                    env: this.childEnvironment(),
                    stdio: ['ignore', 'pipe', 'pipe']
                });
            } catch (error) {
                const message = describeUnexpectedQuickExportFailure(error, `${scriptPath} を起動できませんでした`);
                settle({ exitCode: 2, stdout, stderr: message });
                return;
            }
            child.stdout.on('data', chunk => {
                const text = chunk.toString();
                stdout += text;
                onChunk(text);
            });
            child.stderr.on('data', chunk => {
                const text = chunk.toString();
                stderr += text;
                onChunk(text);
            });
            child.on('error', error => {
                stderr += `\n${error.message}`;
                settle({ exitCode: 2, stdout, stderr });
            });
            // `exit` より `close` を待つ。close は stdout/stderr が閉じた後なので、
            // 失敗理由の末尾を取りこぼした状態で GUI を終端させない。
            child.on('close', code => settle({ exitCode: code, stdout, stderr }));
        });
    }

    protected fsPath(uri: string): string {
        return new URI(uri).path.fsPath();
    }
}
