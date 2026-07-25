import { injectable } from '@theia/core/shared/inversify';
import URI from '@theia/core/lib/common/uri';
import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import { join, resolve } from 'path';
import {
    AkariQuickExportService,
    QuickExportStartOutcome,
    QuickExportStartRequest,
    QuickExportStatus
} from '../common/quick-export-protocol';
import {
    buildEditLintArgs,
    buildRenderCutArgs,
    buildRenderCutOutputPath,
    determineLintOutcome,
    determineRenderOutcome,
    QuickExportRenderSettings,
    summarizeStderrTail
} from '../common/quick-export-cli';
import { estimateElapsedAndRemaining, latestQuickExportProgress } from '../common/quick-export-progress';

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
        void this.run(request).finally(() => {
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
            const issueCount = this.parseLintIssueCount(result.stdout);
            this.updateStatus({
                phase: 'lint-failed',
                lintIssueCount: issueCount,
                reportPath: await this.existingReportPath(projectRoot, EDIT_LINT_REPORT_RELATIVE_PATH)
            });
            return 'fail';
        }
        this.updateStatus({ phase: 'failed', failureSummary: summarizeStderrTail(result.stderr) });
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
        this.updateStatus({ phase: 'failed', failureSummary: summarizeStderrTail(result.stderr) });
    }

    protected parseLintIssueCount(stdout: string): number | undefined {
        try {
            const parsed = JSON.parse(stdout) as { findings?: unknown[] };
            return Array.isArray(parsed.findings) ? parsed.findings.length : undefined;
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
     * akari-project-service.ts の同種コメント・実測で確認済み）。そこから
     * 4 階層上がモノレポルート。process.cwd() 依存の候補は起動方法
     * （`npm start` 等で cwd が `apps/shell` になるケース）向けの保険として残す。
     */
    protected async findEditLintCli(): Promise<string | undefined> {
        return this.findCli([
            resolve(__dirname, '../../../../packages/edit-lint/bin/edit-lint.mjs'),
            resolve(process.cwd(), '../../packages/edit-lint/bin/edit-lint.mjs'),
            resolve(process.cwd(), 'packages/edit-lint/bin/edit-lint.mjs'),
            resolve(__dirname, '../edit-lint/bin/edit-lint.mjs')
        ]);
    }

    protected async findRenderCutCli(): Promise<string | undefined> {
        return this.findCli([
            resolve(__dirname, '../../../../packages/render-cut/bin/render-cut.mjs'),
            resolve(process.cwd(), '../../packages/render-cut/bin/render-cut.mjs'),
            resolve(process.cwd(), 'packages/render-cut/bin/render-cut.mjs'),
            resolve(__dirname, '../render-cut/bin/render-cut.mjs')
        ]);
    }

    protected async findCli(candidates: readonly string[]): Promise<string | undefined> {
        for (const candidate of candidates) {
            try {
                if ((await this.fsImpl.stat(candidate)).isFile()) {
                    return candidate;
                }
            } catch {
                // 次の候補（開発配置 / パッケージ版配置）を試す。
            }
        }
        return undefined;
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
            const child = spawn(process.execPath, [scriptPath, ...args], {
                env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
                stdio: ['ignore', 'pipe', 'pipe']
            });
            let stdout = '';
            let stderr = '';
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
                resolvePromise({ exitCode: 2, stdout, stderr });
            });
            child.on('exit', code => resolvePromise({ exitCode: code, stdout, stderr }));
        });
    }

    protected fsPath(uri: string): string {
        return new URI(uri).path.fsPath();
    }
}
