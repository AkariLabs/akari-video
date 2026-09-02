import { injectable } from '@theia/core/shared/inversify';
import { BackendApplicationContribution } from '@theia/core/lib/node/backend-application';
import URI from '@theia/core/lib/common/uri';
import { type ChildProcess, spawn } from 'child_process';
import { promises as fs } from 'fs';
import * as net from 'net';
import {
    AkariPreviewServerService,
    PreviewServerStartRequest,
    PreviewServerStatus
} from '../common/preview-server-protocol';
import {
    buildPreviewServerArgs,
    describePreviewServerFailure,
    parsePreviewServerReadyUrl,
    PREVIEW_SERVER_DEFAULT_PORT,
    PREVIEW_SERVER_ENTRY_RELATIVE_PATH,
    PREVIEW_SERVER_HOST,
    PREVIEW_SERVER_PORT_ATTEMPTS,
    PREVIEW_SERVER_READY_TIMEOUT_MS
} from '../common/preview-server-cli';
import { describeUnexpectedQuickExportFailure, summarizeStderrTail } from '../common/quick-export-cli';
import { packagedPackageEntryCandidates } from './packaged-cli-candidates';
import { childNodeEnvironment, electronResourcesPath } from './child-node-process';

const LOG_TAIL_MAX_CHARS = 4000;
/** stop 時の SIGTERM 後、SIGKILL へ切り替えるまでの猶予。 */
const PREVIEW_SERVER_STOP_GRACE_MS = 2000;

/** 1 回の spawn ごとの記録。stop / 差し替えと「予期しない終了」を区別するために持つ。 */
interface PreviewServerSession {
    readonly child: ChildProcess;
    readonly port: number;
    readonly projectRootUri: string;
    stdout: string;
    stderr: string;
    closed: boolean;
    exitCode: number | null;
    /** stop() / 差し替え / シェル終了で自分から止めたか（close を failed にしない）。 */
    stopRequested: boolean;
}

/**
 * `packages/preview-server/src/server.mjs`（`akari.sh --preview` と同じサーバー）を
 * Electron バックエンドから子プロセス起動する薄いサービス（preview-server 無改造・
 * CLI 呼び出しのみ — task.md 境界）。起動列・env は quick-export の spawnNodeScript と
 * 同じ流儀（ELECTRON_RUN_AS_NODE + ffmpeg/ffprobe の明示 env — HEVC プロキシ生成が
 * 動くための要件）。シェル終了時は BackendApplicationContribution.onStop と
 * `process.once('exit')` の二段で子を道連れにする（孤児プロセスを残さない）。
 */
@injectable()
export class AkariPreviewServerServiceImpl implements AkariPreviewServerService, BackendApplicationContribution {
    protected status: PreviewServerStatus = { phase: 'idle', logTail: '' };
    protected logBuffer = '';
    protected session: PreviewServerSession | undefined;
    /** starting 中の再入を待たせる（二重 spawn しない）。 */
    protected pending: Promise<PreviewServerStatus> | undefined;
    protected exitHookInstalled = false;
    /** テストからの上書き用（実 CLI を起動しない）。 */
    protected readonly fsImpl: typeof fs = fs;
    /** テストからの上書き用（実時間 10 秒を待たない）。 */
    protected readyTimeoutMs = PREVIEW_SERVER_READY_TIMEOUT_MS;

    async start(request: PreviewServerStartRequest): Promise<PreviewServerStatus> {
        // starting 中の再入は待って結果を返す（projectRoot が違っても待つ — 呼び直しは
        // フロントエンドの onWorkspaceChanged → stop() 経由で行われる）。
        if (this.pending) {
            return this.pending;
        }
        // 同じ projectRoot で running なら何もせず status を返す（二重起動しない）。
        if (this.status.phase === 'running' && this.session && !this.session.closed
            && this.status.projectRootUri === request.projectRootUri) {
            return this.status;
        }
        this.pending = this.launch(request).finally(() => {
            this.pending = undefined;
        });
        return this.pending;
    }

    async getStatus(): Promise<PreviewServerStatus> {
        return this.status;
    }

    async stop(): Promise<PreviewServerStatus> {
        if (this.pending) {
            await this.pending.catch(() => undefined);
        }
        const session = this.session;
        this.session = undefined;
        if (session) {
            await this.terminate(session);
        }
        this.status = { phase: 'idle', logTail: this.logBuffer };
        return this.status;
    }

    /**
     * シェル終了時（BackendApplicationContribution）。`async stop()` は最初の await まで
     * 同期実行され、その中で child.kill まで届く（terminate の Promise executor は同期）
     * ので、`process.on('exit')` 経由の呼び出しでも kill 自体は必ず走る。
     */
    onStop(): Promise<void> {
        this.killSync();
        return this.stop().then(() => undefined);
    }

    protected async launch(request: PreviewServerStartRequest): Promise<PreviewServerStatus> {
        // 別 root で running（または残っている child）なら stop してから起動する。
        const previous = this.session;
        if (previous) {
            this.session = undefined;
            await this.terminate(previous);
        }
        this.logBuffer = '';
        this.status = { phase: 'starting', projectRootUri: request.projectRootUri, logTail: '' };
        let projectRoot: string;
        try {
            projectRoot = this.fsPath(request.projectRootUri);
        } catch (error) {
            return this.fail(describeUnexpectedQuickExportFailure(error, 'プロジェクトルートを解決できませんでした'));
        }
        const entry = await this.findServerEntry();
        if (!entry) {
            return this.fail('preview-server が見つかりませんでした（packages/preview-server/src/server.mjs 不在）');
        }
        const port = await this.findFreePort();
        if (port === undefined) {
            const first = PREVIEW_SERVER_DEFAULT_PORT;
            const last = PREVIEW_SERVER_DEFAULT_PORT + PREVIEW_SERVER_PORT_ATTEMPTS - 1;
            return this.fail(`ポート ${first}〜${last} がすべて使用中です`);
        }
        const args = buildPreviewServerArgs(projectRoot, port);
        let child: ChildProcess;
        try {
            child = this.spawnServer(entry, args);
        } catch (error) {
            return this.fail(describeUnexpectedQuickExportFailure(error, 'プレビューサーバーを起動できませんでした'));
        }
        const session: PreviewServerSession = {
            child,
            port,
            projectRootUri: request.projectRootUri,
            stdout: '',
            stderr: '',
            closed: false,
            exitCode: null,
            stopRequested: false
        };
        this.session = session;
        this.installExitHook();
        const outcome = await this.waitForReady(session);
        if (this.session !== session) {
            // 待っている間に stop / シェル終了が走った。
            return this.status;
        }
        if (outcome === 'ready') {
            if (session.closed) {
                // URL 行と close がほぼ同時に来た（ready 直後に落ちた）レース。
                this.session = undefined;
                return this.fail(describePreviewServerFailure(session.exitCode, session.stderr, port));
            }
            const url = parsePreviewServerReadyUrl(session.stdout);
            this.status = {
                phase: 'running',
                projectRootUri: request.projectRootUri,
                url,
                port,
                pid: child.pid,
                logTail: this.logBuffer
            };
            return this.status;
        }
        if (outcome === 'timeout') {
            this.session = undefined;
            await this.terminate(session);
            const stderrSummary = summarizeStderrTail(session.stderr);
            return this.fail(
                `プレビューサーバーが ${this.readyTimeoutMs / 1000} 秒以内に起動しませんでした`
                + (stderrSummary ? `\n${stderrSummary}` : '')
            );
        }
        // 準備完了前に子が終了した（EADDRINUSE 等）。
        this.session = undefined;
        return this.fail(describePreviewServerFailure(session.exitCode, session.stderr, port));
    }

    /** stdout に URL 行が現れるまで待つ。先に close / タイムアウトならその旨を返す。 */
    protected waitForReady(session: PreviewServerSession): Promise<'ready' | 'exited' | 'timeout'> {
        const { child } = session;
        return new Promise(resolvePromise => {
            let settled = false;
            const settle = (outcome: 'ready' | 'exited' | 'timeout'): void => {
                if (!settled) {
                    settled = true;
                    clearTimeout(timer);
                    resolvePromise(outcome);
                }
            };
            const timer = setTimeout(() => settle('timeout'), this.readyTimeoutMs);
            child.stdout?.on('data', chunk => {
                const text = String(chunk);
                session.stdout = (session.stdout + text).slice(-LOG_TAIL_MAX_CHARS);
                this.appendLog(text);
                if (parsePreviewServerReadyUrl(session.stdout) !== undefined) {
                    settle('ready');
                }
            });
            child.stderr?.on('data', chunk => {
                const text = String(chunk);
                session.stderr = (session.stderr + text).slice(-LOG_TAIL_MAX_CHARS);
                this.appendLog(text);
            });
            child.on('error', error => {
                session.stderr += `\n${error.message}`;
                this.appendLog(`${error.message}\n`);
                session.closed = true;
                settle('exited');
            });
            child.on('close', (code, signal) => {
                session.closed = true;
                session.exitCode = code;
                settle('exited');
                this.handleUnexpectedClose(session, code, signal);
            });
        });
    }

    /** running 中に子の close が来たら failed（stop / 差し替え由来の close は除く）。 */
    protected handleUnexpectedClose(
        session: PreviewServerSession,
        code: number | null,
        _signal: NodeJS.Signals | null
    ): void {
        if (this.session !== session || session.stopRequested) {
            return;
        }
        if (this.status.phase === 'running') {
            this.session = undefined;
            this.fail(`プレビューサーバーが予期せず終了しました\n${describePreviewServerFailure(code, session.stderr, session.port)}`);
        }
    }

    protected fail(failureSummary: string): PreviewServerStatus {
        this.appendLog(`${failureSummary}\n`);
        this.status = {
            phase: 'failed',
            projectRootUri: this.status.projectRootUri,
            logTail: this.logBuffer,
            failureSummary
        };
        return this.status;
    }

    // --- ポート探索 -----------------------------------------------------------

    /** 4567〜4576 を順に試し、最初に開いた番号を返す。全滅なら undefined。 */
    protected async findFreePort(): Promise<number | undefined> {
        for (let attempt = 0; attempt < PREVIEW_SERVER_PORT_ATTEMPTS; attempt++) {
            const port = PREVIEW_SERVER_DEFAULT_PORT + attempt;
            if (await this.probePort(port)) {
                return port;
            }
        }
        return undefined;
    }

    /** テストからの差し替え点（net を実際に listen しない）。 */
    protected probePort(port: number): Promise<boolean> {
        return new Promise(resolvePromise => {
            const probe = net.createServer();
            probe.unref();
            probe.once('error', () => resolvePromise(false));
            probe.listen(port, PREVIEW_SERVER_HOST, () => {
                probe.close(() => resolvePromise(true));
            });
        });
    }

    // --- 起動・停止 -----------------------------------------------------------

    /**
     * quick-export の spawnNodeScript と同じ流儀（process.execPath +
     * ELECTRON_RUN_AS_NODE=1 + ffmpeg/ffprobe の明示 env）。テストからの差し替え点。
     */
    protected spawnServer(entry: string, args: string[]): ChildProcess {
        return spawn(process.execPath, [entry, ...args], {
            env: this.childEnvironment(),
            stdio: ['ignore', 'pipe', 'pipe'],
            windowsHide: true
        });
    }

    protected childEnvironment(): NodeJS.ProcessEnv {
        return childNodeEnvironment(this.resourcesPath());
    }

    protected resourcesPath(): string | undefined {
        return electronResourcesPath();
    }

    /**
     * SIGTERM → 2 秒経っても生きていれば SIGKILL。win32 は child.kill()
     * （TerminateProcess）だけでよい。close が来ないケースでも stop() を
     * 永久に待たせない（猶予 2 倍で諦めて返す — 実害は無い: 子は kill 済み）。
     */
    protected terminate(session: PreviewServerSession): Promise<void> {
        session.stopRequested = true;
        if (session.closed) {
            return Promise.resolve();
        }
        const { child } = session;
        return new Promise(resolvePromise => {
            let finished = false;
            const finish = (): void => {
                if (!finished) {
                    finished = true;
                    clearTimeout(forceTimer);
                    clearTimeout(giveUpTimer);
                    resolvePromise();
                }
            };
            const forceTimer = setTimeout(() => {
                if (!session.closed && process.platform !== 'win32') {
                    this.killChild(child, 'SIGKILL');
                }
            }, PREVIEW_SERVER_STOP_GRACE_MS);
            const giveUpTimer = setTimeout(finish, PREVIEW_SERVER_STOP_GRACE_MS * 2);
            child.once('close', finish);
            this.killChild(child, 'SIGTERM');
        });
    }

    protected killChild(child: ChildProcess, signal: NodeJS.Signals): void {
        try {
            if (process.platform === 'win32') {
                // win32 に SIGTERM/SIGKILL の区別は無い（TerminateProcess）。
                child.kill();
            } else {
                child.kill(signal);
            }
        } catch {
            // 既に終了している。
        }
    }

    /** 多重防御: プロセス終了時に同期 kill（onStop が届かない経路への保険）。 */
    protected installExitHook(): void {
        if (this.exitHookInstalled) {
            return;
        }
        this.exitHookInstalled = true;
        process.once('exit', () => this.killSync());
    }

    protected killSync(): void {
        const session = this.session;
        if (session && !session.closed) {
            session.stopRequested = true;
            this.killChild(session.child, 'SIGTERM');
        }
    }

    // --- 入口解決・ログ -------------------------------------------------------

    /** テストからの差し替え点。 */
    protected async findServerEntry(): Promise<string | undefined> {
        return this.findEntry(packagedPackageEntryCandidates(
            'preview-server',
            PREVIEW_SERVER_ENTRY_RELATIVE_PATH,
            __dirname,
            this.resourcesPath()
        ));
    }

    /** quick-export の findCli と同じ — どの候補で当たったか / 試した一覧をログへ残す。 */
    protected async findEntry(candidates: readonly string[]): Promise<string | undefined> {
        for (const [index, candidate] of candidates.entries()) {
            try {
                if ((await this.fsImpl.stat(candidate)).isFile()) {
                    this.appendLog(`preview-server 解決: 候補 ${index + 1}/${candidates.length} = ${candidate}\n`);
                    return candidate;
                }
            } catch {
                // 次の候補（パッケージ版配置 / 祖先探索 / 後方互換配置）を試す。
            }
        }
        this.appendLog(`preview-server の解決に失敗（試した候補 ${candidates.length} 件）:\n${candidates.map(c => `  - ${c}`).join('\n')}\n`);
        return undefined;
    }

    protected appendLog(chunk: string): void {
        this.logBuffer = (this.logBuffer + chunk).slice(-LOG_TAIL_MAX_CHARS);
        if (this.status.phase !== 'idle') {
            this.status = { ...this.status, logTail: this.logBuffer };
        }
    }

    protected fsPath(uri: string): string {
        return new URI(uri).path.fsPath();
    }
}
