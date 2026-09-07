import { injectable } from '@theia/core/shared/inversify';
import { BackendApplicationContribution } from '@theia/core/lib/node/backend-application';
import URI from '@theia/core/lib/common/uri';
import { type ChildProcessWithoutNullStreams, spawn } from 'child_process';
import { promises as fs } from 'fs';
import { dirname, join, resolve, sep } from 'path';
import {
    AkariQuickExportService,
    QuickExportLintFinding,
    QuickExportRecheckRequest,
    QuickExportRecheckResult,
    QuickExportDiscardLeftoverResult,
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
import {
    createQuickExportProgressTracker,
    estimateElapsedAndRemaining,
    QuickExportProgressTracker
} from '../common/quick-export-progress';
import { copyArtifactCommand, copyArtifactStdin } from '../common/export-share';
import { packagedCliCandidates } from './packaged-cli-candidates';
import { childNodeEnvironment, electronResourcesPath } from './child-node-process';

const LOG_TAIL_MAX_CHARS = 4000;
const EDIT_LINT_REPORT_RELATIVE_PATH = join('.akari', 'reports', 'edit-lint-report.html');
const RENDER_CUT_REPORT_RELATIVE_PATH = join('.akari', 'reports', 'render-report.html');
export const EXPORT_PREVIEW_RELATIVE_DIRECTORY = join('.akari', 'cache', 'export-preview');
/** render-cut / gpu-export / osr-export が実行ごとの作業ディレクトリを掘る場所。 */
export const RENDER_TMP_RELATIVE_DIRECTORY = join('.akari', 'render-tmp');

/** プロジェクト内の許可ディレクトリ配下に限定して解決する。外なら undefined。 */
export function resolveExportPreviewPath(
    projectRoot: string | undefined,
    candidate: string
): string | undefined {
    if (!projectRoot || typeof candidate !== 'string' || candidate.length === 0) {
        return undefined;
    }
    const allowedRoot = resolve(projectRoot, EXPORT_PREVIEW_RELATIVE_DIRECTORY);
    const resolved = resolve(candidate);
    if (resolved === allowedRoot) {
        return undefined;
    }
    return resolved.startsWith(`${allowedRoot}${sep}`) ? resolved : undefined;
}

interface SpawnResult {
    readonly exitCode: number | null;
    readonly stdout: string;
    readonly stderr: string;
}

export interface RevealArtifactCommand {
    readonly command: string;
    readonly args: readonly string[];
}

export function buildRevealArtifactCommand(
    platform: NodeJS.Platform,
    artifactPath: string,
    isDirectory = false
): RevealArtifactCommand {
    if (platform === 'darwin') {
        return { command: 'open', args: isDirectory ? [artifactPath] : ['-R', artifactPath] };
    }
    if (platform === 'win32') {
        return { command: 'explorer', args: isDirectory ? [artifactPath] : [`/select,${artifactPath}`] };
    }
    return { command: 'xdg-open', args: [isDirectory ? artifactPath : dirname(artifactPath)] };
}

/**
 * `packages/edit-lint` / `packages/render-cut` の既存 CLI を子プロセスとして
 * 直接実行するだけの薄いサービス（both packages 無改造・CLI 呼び出しのみ —
 * task.md 境界）。実行中は `status` フィールドを随時更新し、フロントエンドは
 * `getStatus` をポーリングして進捗を表示する。
 */
@injectable()
export class AkariQuickExportServiceImpl implements AkariQuickExportService, BackendApplicationContribution {
    protected running = false;
    protected status: QuickExportStatus = { phase: 'idle', logTail: '' };
    protected logBuffer = '';
    /** render-cut フェーズ開始時刻（--progress の経過/残り時間見積もりに使う）。 */
    protected renderStartedAt: number | undefined;
    protected progressTracker: QuickExportProgressTracker = createQuickExportProgressTracker();
    protected renderStageStartedAt: number | undefined;
    protected activeChild: ChildProcessWithoutNullStreams | undefined;
    protected cancelRequested = false;
    /** start 時点で既にあった render-tmp の entry 名（この回のゴミの判定基準）。 */
    protected renderTmpEntriesAtStart: ReadonlySet<string> = new Set();
    /** recheckLint の二重起動ガード（running とは別。再検査は書き出しではない）。 */
    protected recheckRunning = false;
    protected currentProjectRoot: string | undefined;
    /** テストからの上書き用（実 CLI を起動しない）。 */
    protected readonly fsImpl: typeof fs = fs;

    async start(request: QuickExportStartRequest): Promise<QuickExportStartOutcome> {
        if (this.running) {
            return { accepted: false, reason: 'already-running' };
        }
        this.running = true;
        this.cancelRequested = false;
        this.currentProjectRoot = this.fsPath(request.projectRootUri);
        this.logBuffer = '';
        this.progressTracker = createQuickExportProgressTracker();
        this.renderStageStartedAt = undefined;
        // この回のゴミだけを後で消せるように、開始前の render-tmp を控えておく。
        this.renderTmpEntriesAtStart = await this.readRenderTmpEntries(this.currentProjectRoot);
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

    /**
     * 書き出しを始めずに edit-lint だけ走らせ直す（task 2026-09-03-export-lint-auto-recheck）。
     *
     * 出自: `status` は次の start まで書き換わらないため、パートナーが edit.json を直しても
     * 書き出しエラー画面は止まった時点の findings を出し続け、閉じて開き直しても
     * 同じ結果が返っていた（getStatus はサーバー保持の status をそのまま返す）。
     *
     * 実行中の書き出しには一切触らない: running なら skipped で返し、走らせた結果も
     * 「戻ってきた時点でまだ running でない」ときだけ status へ反映する。
     * phase は 'linting' にしない — 再検査は書き出しではないので、画面を
     * 「書き出し中」へ飛ばさずに lint 停止画面のまま更新する。
     */
    async recheckLint(request: QuickExportRecheckRequest): Promise<QuickExportRecheckResult> {
        if (this.running) {
            return { outcome: 'skipped', status: this.status, reason: '書き出しの実行中は再検査しません' };
        }
        if (this.recheckRunning) {
            return { outcome: 'skipped', status: this.status, reason: 'すでに再検査中です' };
        }
        this.recheckRunning = true;
        try {
            return await this.runLintRecheck(this.fsPath(request.projectRootUri));
        } catch (error) {
            return {
                outcome: 'unavailable',
                status: this.status,
                reason: describeUnexpectedQuickExportFailure(error, 'lint の再検査に失敗しました')
            };
        } finally {
            this.recheckRunning = false;
        }
    }

    protected async runLintRecheck(projectRoot: string): Promise<QuickExportRecheckResult> {
        // 再検査は書き出しのログ（logTail）を汚さない。CLI 解決の失敗理由だけは結果に載せる。
        const cli = await this.findEditLintCli(() => undefined);
        if (!cli) {
            return {
                outcome: 'unavailable',
                status: this.status,
                reason: 'edit-lint CLI が見つかりませんでした（packages/edit-lint/bin/edit-lint.mjs 不在）'
            };
        }
        const result = await this.spawnNodeScript(
            cli,
            buildEditLintArgs(projectRoot),
            () => undefined,
            { trackActive: false }
        );
        if (this.running) {
            return { outcome: 'skipped', status: this.status, reason: '書き出しが始まったため再検査の結果は捨てました' };
        }
        const outcome = determineLintOutcome(result.exitCode);
        const checkedAt = this.now();
        if (outcome === 'pass') {
            // 直っていた: 保持していた lint-failed を捨て、設定画面へ戻せる idle にする。
            // done（前回の成果物）を消さないよう、書き換えるのは lint で止まっている時だけ。
            if (this.status.phase === 'lint-failed') {
                this.status = { phase: 'idle', logTail: this.status.logTail, lintCheckedAt: checkedAt };
            } else {
                this.updateStatus({ lintCheckedAt: checkedAt });
            }
            return { outcome: 'pass', status: this.status };
        }
        if (outcome === 'fail') {
            const lintSummary = this.parseLintFindingSummary(result.stdout);
            this.updateStatus({
                phase: 'lint-failed',
                lintIssueCount: lintSummary?.issueCount,
                lintErrorCount: lintSummary?.errorCount,
                lintWarningCount: lintSummary?.warningCount,
                lintFindings: lintSummary?.findings,
                reportPath: await this.existingReportPath(projectRoot, EDIT_LINT_REPORT_RELATIVE_PATH),
                failureSummary: undefined,
                lintCheckedAt: checkedAt
            });
            return { outcome: 'lint-failed', status: this.status };
        }
        return {
            outcome: 'unavailable',
            status: this.status,
            reason: summarizeStderrTail(result.stderr)
                || `edit-lint が exit code ${result.exitCode ?? '不明'} で終了しました（エラー出力はありません）`
        };
    }

    /**
     * シェル終了時に走っている書き出しを道連れにする（孤児を残さない —
     * preview-server バックエンドと同じ規律）。中止ボタンを押さずにアプリを
     * 終了した場合、これが無いと ffmpeg / OSR Electron が延々と回り続ける。
     */
    onStop(): void {
        const child = this.activeChild;
        if (!child) {
            return;
        }
        this.cancelRequested = true;
        this.activeChild = undefined;
        // シェル終了経路は同期でしか動けない（await できない）ので猶予を置かず
        // 一段で畳む。書き出しの中間生成物は .akari/work/ 配下の使い捨てなので、
        // SIGTERM の後始末を待つ価値より孤児を残さないことを優先する。
        this.killTree(child, 'SIGKILL');
    }

    async cancel(): Promise<{ cancelled: boolean }> {
        if (!this.running) {
            return { cancelled: false };
        }
        this.cancelRequested = true;
        const child = this.activeChild;
        this.updateStatus({ phase: 'cancelled', failureSummary: undefined });
        if (!child) {
            return { cancelled: true };
        }
        const exited = await new Promise<boolean>(resolvePromise => {
            let settled = false;
            const timeout = setTimeout(() => {
                if (settled) return;
                settled = true;
                resolvePromise(false);
            }, 5000);
            child.once('close', () => {
                if (settled) return;
                settled = true;
                clearTimeout(timeout);
                resolvePromise(true);
            });
            this.killTree(child, 'SIGTERM');
        });
        if (!exited && this.activeChild === child) {
            this.killTree(child, 'SIGKILL');
        }
        // 子が死んでから数える（走っている間はまだ書き足されるので数が意味を持たない）。
        // 消すのは押されたときだけ — ここでは「何がどれだけ残ったか」を伝えるにとどめる。
        this.updateStatus({ cancelledLeftover: await this.measureCancelledLeftover() });
        return { cancelled: true };
    }

    /**
     * 中止で残った、この回の作業ディレクトリを削除する。消すのは
     * `status.cancelledLeftover.entries`（= start 前には無かった entry）だけで、
     * 解決先が `<projectRoot>/.akari/render-tmp/` 配下に収まることを毎回確かめる。
     * 既存の実行分・lint.json・reports/ には触れない。
     */
    async discardCancelledLeftover(): Promise<QuickExportDiscardLeftoverResult> {
        if (this.running) {
            return { discarded: false, reason: '書き出しの実行中は削除できません' };
        }
        const leftover = this.status.cancelledLeftover;
        const projectRoot = this.currentProjectRoot;
        if (!leftover || leftover.entries.length === 0 || !projectRoot) {
            return { discarded: false, reason: '削除する一時ファイルがありません' };
        }
        let removedBytes = 0;
        const failures: string[] = [];
        for (const entry of leftover.entries) {
            const target = this.resolveRenderTmpEntry(projectRoot, entry);
            if (!target) {
                failures.push(entry);
                continue;
            }
            const measured = await this.treeSize(target);
            try {
                await this.fsImpl.rm(target, { recursive: true, force: true });
                removedBytes += measured;
            } catch (error) {
                failures.push(entry);
                this.appendLog(`${describeUnexpectedQuickExportFailure(error, `${entry} を削除できませんでした`)}\n`);
            }
        }
        // 消し残しがあれば「まだ残っている分」を数え直して出し続ける（嘘の完了にしない）。
        this.updateStatus({ cancelledLeftover: await this.measureCancelledLeftover() });
        if (failures.length > 0) {
            return { discarded: false, reason: `一時ファイルを削除できませんでした（${failures.length} 件）` };
        }
        return { discarded: true, bytes: removedBytes };
    }

    /** `.akari/render-tmp` 直下の entry 名。ディレクトリが無ければ空集合。 */
    protected async readRenderTmpEntries(projectRoot: string | undefined): Promise<ReadonlySet<string>> {
        if (!projectRoot) {
            return new Set();
        }
        try {
            return new Set(await this.fsImpl.readdir(join(projectRoot, RENDER_TMP_RELATIVE_DIRECTORY)));
        } catch {
            // まだ 1 度も書き出していないプロジェクトではディレクトリ自体が無い。
            return new Set();
        }
    }

    /** start 以降に増えた entry と、その合計サイズ。増えていなければ undefined。 */
    protected async measureCancelledLeftover(): Promise<QuickExportStatus['cancelledLeftover']> {
        const projectRoot = this.currentProjectRoot;
        if (!projectRoot) {
            return undefined;
        }
        const now = await this.readRenderTmpEntries(projectRoot);
        const entries = [...now].filter(entry => !this.renderTmpEntriesAtStart.has(entry));
        if (entries.length === 0) {
            return undefined;
        }
        let bytes = 0;
        for (const entry of entries) {
            const target = this.resolveRenderTmpEntry(projectRoot, entry);
            if (target) {
                bytes += await this.treeSize(target);
            }
        }
        return { entries, bytes };
    }

    /**
     * ディレクトリツリーの合計バイト数。`statOrUndefined` は直下のファイルしか
     * 数えないが、作業ディレクトリは `electron-user-data/` のような入れ子を抱えるので
     * 表示用には再帰で数える（読めない枝は 0 として飛ばす — 表示が目的で監査ではない）。
     */
    protected async treeSize(path: string): Promise<number> {
        let stat;
        try {
            stat = await this.fsImpl.stat(path);
        } catch {
            return 0;
        }
        if (!stat.isDirectory()) {
            return stat.size;
        }
        let total = 0;
        let children;
        try {
            children = await this.fsImpl.readdir(path, { withFileTypes: true });
        } catch {
            return total;
        }
        for (const child of children) {
            // シンボリックリンクは辿らない（リンク先の実体を二重計上・外へ出ないため）。
            if (child.isSymbolicLink()) {
                continue;
            }
            total += await this.treeSize(join(path, child.name));
        }
        return total;
    }

    /** `<projectRoot>/.akari/render-tmp/<entry>` に収まるときだけ絶対パスを返す。 */
    protected resolveRenderTmpEntry(projectRoot: string, entry: string): string | undefined {
        const allowedRoot = resolve(projectRoot, RENDER_TMP_RELATIVE_DIRECTORY);
        const resolved = resolve(allowedRoot, entry);
        return resolved.startsWith(`${allowedRoot}${sep}`) ? resolved : undefined;
    }

    /**
     * 子プロセス「ツリー」へシグナルを届ける。素の `child.kill()` は spawn した
     * 直接の子（render-cut / osr-export の node）にしか届かず、その子が起こした
     * ffmpeg・OSR Electron・Chromium は孤児として走り続ける（実測: 中止しても
     * プロセスが残り続け、孤児 OSR Electron が親の閉じたパイプへ PROGRESS 行を
     * 書いて EPIPE → main process のエラーダイアログを出し続ける）。
     *
     * POSIX: spawn 時に detached: true でプロセスグループを作ってあるので、
     * pid を負にしてグループ全体へ送る。Windows: taskkill /T /F でツリーを畳む。
     * どちらも失敗したら直接の子だけでも殺す（best effort — 中止操作は必ず
     * 「何かしら止まる」で終わらせる）。
     */
    protected killTree(child: ChildProcessWithoutNullStreams, signal: 'SIGTERM' | 'SIGKILL'): void {
        const pid = child.pid;
        if (pid === undefined) {
            return;
        }
        if (this.platform() === 'win32') {
            try {
                // /T = 子孫ごと、/F = 強制。SIGTERM 相当の穏当な終了は Windows の
                // コンソールプロセスには届かないので、どちらの signal でも /F を使う。
                this.killWindowsTree(pid);
            } catch {
                this.killDirect(child, signal);
            }
            return;
        }
        try {
            this.signalProcessGroup(pid, signal);
        } catch {
            // グループが既に消えている（ESRCH）か、detached に失敗して
            // グループリーダーになれなかった場合。直接の子へフォールバックする。
            this.killDirect(child, signal);
        }
    }

    /** テストからの上書き用の seam（実プロセスへシグナルを送らない）。 */
    protected signalProcessGroup(pid: number, signal: 'SIGTERM' | 'SIGKILL'): void {
        process.kill(-pid, signal);
    }

    /** テストからの上書き用の seam（実 taskkill を起動しない）。 */
    protected killWindowsTree(pid: number): void {
        spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    }

    protected killDirect(child: ChildProcessWithoutNullStreams, signal: 'SIGTERM' | 'SIGKILL'): void {
        try {
            child.kill(signal);
        } catch {
            // 既に終了している。中止としては目的達成なので握りつぶす。
        }
    }

    async revealArtifact(): Promise<{ revealed: boolean }> {
        if (this.status.phase !== 'done' || !this.status.artifactPath || !this.currentProjectRoot) {
            return { revealed: false };
        }
        const artifactPath = resolve(this.currentProjectRoot, this.status.artifactPath);
        try {
            const artifact = await this.fsImpl.stat(artifactPath);
            const request = buildRevealArtifactCommand(this.platform(), artifactPath, artifact.isDirectory());
            await this.spawnRevealCommand(request.command, request.args);
            return { revealed: true };
        } catch (error) {
            this.appendLog(`${describeUnexpectedQuickExportFailure(error, '成果物をファイル管理画面で表示できませんでした')}\n`);
            return { revealed: false };
        }
    }

    async copyArtifact(): Promise<{ copied: boolean; reason?: string }> {
        if (this.status.phase !== 'done' || !this.status.artifactPath || !this.currentProjectRoot) {
            return { copied: false, reason: 'コピーできる書き出し済み動画がありません' };
        }
        const artifactPath = resolve(this.currentProjectRoot, this.status.artifactPath);
        const platform = this.platform();
        const request = copyArtifactCommand(platform, artifactPath);
        if (!request) {
            return { copied: false, reason: 'この OS ではクリップボードへのコピーに対応していません' };
        }
        try {
            const exitCode = await this.spawnCopyCommand(
                request.command,
                request.args,
                copyArtifactStdin(platform, artifactPath)
            );
            if (exitCode === 0) {
                return { copied: true };
            }
            return {
                copied: false,
                reason: `コピー用コマンドが exit code ${exitCode ?? '不明'} で終了しました`
            };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return {
                copied: false,
                reason: `コピー用コマンドを起動できませんでした: ${message.replace(/\s+/gu, ' ')}`
            };
        }
    }

    async readPreviewFrame(path: string): Promise<string | undefined> {
        const resolved = resolveExportPreviewPath(this.currentProjectRoot, path);
        if (!resolved) {
            return undefined;
        }
        try {
            const bytes = await this.fsImpl.readFile(resolved);
            return `data:image/jpeg;base64,${bytes.toString('base64')}`;
        } catch {
            return undefined;
        }
    }

    protected async run(request: QuickExportStartRequest): Promise<void> {
        const projectRoot = this.fsPath(request.projectRootUri);

        if (request.rerunLint) {
            const lintOutcome = await this.runEditLintPhase(projectRoot);
            if (lintOutcome !== 'pass') {
                return;
            }
        }

        if (this.cancelRequested) {
            return;
        }

        await this.runRenderCutPhase(projectRoot, {
            outputName: request.outputName,
            quality: request.quality,
            engine: request.engine,
            encoder: request.encoder,
            codec: request.codec,
            fps: request.fps,
            scaleTo: request.scaleTo,
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
        if (this.cancelRequested) {
            return 'error';
        }
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
        if (this.cancelRequested) {
            return;
        }
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

    protected async statOrUndefined(path: string): Promise<{ size: number; isDirectory: boolean } | undefined> {
        try {
            const stat = await this.fsImpl.stat(path);
            if (!stat.isDirectory()) return { size: stat.size, isDirectory: false };
            const children = await this.fsImpl.readdir(path, { withFileTypes: true });
            const sizes = await Promise.all(children.filter(child => child.isFile()).map(async child => (await this.fsImpl.stat(join(path, child.name))).size));
            return { size: sizes.reduce((sum, size) => sum + size, 0), isDirectory: true };
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
     * ログ蓄積は appendLog に委ね、状態つきトラッカーへチャンクを逐次渡して % と
     * 経過/残り時間を見積もり、status に反映する。
     */
    protected appendRenderLog(chunk: string): void {
        this.appendLog(chunk);
        const previousSnapshot = this.progressTracker.snapshot();
        this.progressTracker.push(chunk);
        const snapshot = this.progressTracker.snapshot();
        if (!snapshot || this.renderStartedAt === undefined) {
            return;
        }
        const nowMs = Date.now();
        const renderRestarted = snapshot.stage === 'render'
            && previousSnapshot?.stage === 'render'
            && (
                (snapshot.frame === 0 && previousSnapshot.frame !== 0)
                || snapshot.engine !== previousSnapshot.engine
            );
        if (snapshot.stage === 'render' && (this.renderStageStartedAt === undefined || renderRestarted)) {
            this.renderStageStartedAt = nowMs;
        }
        const elapsedMs = nowMs - this.renderStartedAt;
        const renderStage = snapshot.stage === 'render' && this.renderStageStartedAt !== undefined
            ? { startedAtMs: this.renderStageStartedAt, nowMs }
            : undefined;
        const { remainingMs } = estimateElapsedAndRemaining(snapshot, elapsedMs, renderStage);
        this.updateStatus({
            progressPercent: snapshot.percent,
            progressElapsedMs: elapsedMs,
            progressRemainingMs: remainingMs,
            progressStage: snapshot.stage,
            progressFrame: snapshot.frame,
            progressTotalFrames: snapshot.totalFrames,
            progressEngine: snapshot.engine,
            progressPreviewFrame: snapshot.previewFrame,
            progressPreviewPath: snapshot.previewPath
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
    protected async findEditLintCli(log?: (chunk: string) => void): Promise<string | undefined> {
        return this.findCli(packagedCliCandidates('edit-lint', 'edit-lint.mjs', __dirname, this.resourcesPath()), log);
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
    protected async findCli(
        candidates: readonly string[],
        log: (chunk: string) => void = chunk => this.appendLog(chunk)
    ): Promise<string | undefined> {
        for (const [index, candidate] of candidates.entries()) {
            try {
                if ((await this.fsImpl.stat(candidate)).isFile()) {
                    log(`CLI 解決: 候補 ${index + 1}/${candidates.length} = ${candidate}\n`);
                    return candidate;
                }
            } catch {
                // 次の候補（パッケージ版配置 / 祖先探索 / 後方互換配置）を試す。
            }
        }
        log(`CLI 解決に失敗（試した候補 ${candidates.length} 件）:\n${candidates.map(c => `  - ${c}`).join('\n')}\n`);
        return undefined;
    }

    /**
     * 子プロセス（edit-lint / render-cut）へ渡す環境。
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
    protected spawnNodeScript(
        scriptPath: string,
        args: string[],
        onChunk: (chunk: string) => void,
        options: { readonly trackActive?: boolean } = {}
    ): Promise<SpawnResult> {
        // 再検査（trackActive: false）の子は cancel の対象にしない。中止ボタンは
        // 「書き出しを止める」ボタンであって、裏で走った lint を止める口ではない。
        const trackActive = options.trackActive ?? true;
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
                    stdio: ['ignore', 'pipe', 'pipe'],
                    // 中止で「孫まで」殺せるようにする（POSIX）。detached: true は子を
                    // 新しいプロセスグループのリーダーにするので、`process.kill(-pid)` で
                    // render-cut / osr-export が起こした ffmpeg・OSR Electron・Chromium まで
                    // 一括で落とせる。detached にしただけでは何も切り離されない（unref して
                    // いないので親の exit は今までどおり子を待つ）。Windows は
                    // プロセスグループの概念が違うので taskkill /T に委ねる（killTree 参照）。
                    detached: this.platform() !== 'win32'
                });
            } catch (error) {
                const message = describeUnexpectedQuickExportFailure(error, `${scriptPath} を起動できませんでした`);
                settle({ exitCode: 2, stdout, stderr: message });
                return;
            }
            if (trackActive) {
                this.activeChild = child;
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
            child.on('close', code => {
                if (trackActive && this.activeChild === child) {
                    this.activeChild = undefined;
                }
                settle({ exitCode: code, stdout, stderr });
            });
        });
    }

    protected platform(): NodeJS.Platform {
        return process.platform;
    }

    /** テストからの上書き用の時刻シーム。 */
    protected now(): number {
        return Date.now();
    }

    protected spawnRevealCommand(command: string, args: readonly string[]): Promise<void> {
        return new Promise((resolvePromise, rejectPromise) => {
            let child;
            try {
                child = spawn(command, [...args], { detached: true, stdio: 'ignore' });
            } catch (error) {
                rejectPromise(error);
                return;
            }
            child.once('error', rejectPromise);
            child.once('spawn', () => {
                child.unref();
                resolvePromise();
            });
        });
    }

    protected spawnCopyCommand(command: string, args: readonly string[], stdin?: string): Promise<number | null> {
        return new Promise((resolvePromise, rejectPromise) => {
            let child;
            try {
                child = spawn(command, [...args], { stdio: ['pipe', 'ignore', 'ignore'] });
            } catch (error) {
                rejectPromise(error);
                return;
            }
            child.once('error', rejectPromise);
            child.once('close', resolvePromise);
            child.stdin.once('error', rejectPromise);
            if (stdin !== undefined) {
                child.stdin.end(stdin);
            } else {
                child.stdin.end();
            }
        });
    }

    protected fsPath(uri: string): string {
        return new URI(uri).path.fsPath();
    }
}
