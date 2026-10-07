/**
 * 出力プレビュー初期化の診断集約（シェル側）。
 *
 * 目的は**原因の判定ではなく証跡の可視化**（不具合メモ 第11・12項）。
 *  1. 段（Webview 生成 → 編集モデル読込 → ページ HTML 設定 → スクリプト読込 →
 *     エンジン初期化 → メディア供給 → 初回描画）の到達状況を widget ごとに持つ
 *  2. 初回描画まで到達しないまま時間切れになったら、widget の DOM 上に診断バンドを出す
 *     （ページ側が死んでいて何も描けない「灰色」でも、ホスト側の DOM なら出せる）
 *  3. 同じ内容を `~/.akari/logs/akari-preview-diagnostics.log`（JSON Lines）へ残す。
 *     現状 `~/.theia/logs` に読めるログが無く、利用者に DevTools（Alt+F12）を開かせないと
 *     何も分からないため、ファイルに残すことが切り分けの前提になる
 *
 * ここは @theia に依存しない（テストが Theia 無しで動くように、必要な外界は
 * すべて `PreviewDiagnosticsIo` / `PreviewDiagnosticsLogIo` 経由の構造的インターフェースで受ける）。
 */

import {
    PREVIEW_INIT_STAGES,
    PreviewDiagnosticEvent,
    PreviewDiagnosticsContext,
    PreviewDiagnosticsLogEntry,
    PreviewInitStageId,
    PreviewInitStageStatus,
    PreviewInitSummary,
    PreviewInitTrace,
    PreviewRendererGone,
    PREVIEW_DIAGNOSTICS_LOG_MAX_BYTES,
    createPreviewInitTrace,
    describeKeyEventConversionFailure,
    describePreviewWebviewRole,
    describePreviewRendererGoneReason,
    formatPreviewInitReport,
    isSuspiciousKeyEventShape,
    markPreviewInitStage,
    previewDiagnosticsLogLine,
    recordPreviewDiagnosticEvent,
    summarizePreviewInit,
    summaryForLog
} from '../common/preview-init-diagnostics';

/** 診断ログの保存先（ホームディレクトリ相対）。第11項で利用者が最初に見に行く場所に合わせる。 */
export const PREVIEW_DIAGNOSTICS_LOG_RELATIVE_PATH = '.akari/logs/akari-preview-diagnostics.log';

/** 初回描画を待つ時間。frame-engine 側の watchdog（既定 15s）より後に鳴らす。 */
export const PREVIEW_DIAGNOSTICS_WATCHDOG_MS = 20000;
export const PREVIEW_DIAGNOSTICS_HEARTBEAT_CHECK_MS = 5000;

/** 1 ファイルに貯める上限。超えたら古い行を落とす（診断ログでディスクを埋めない）。 */
export { PREVIEW_DIAGNOSTICS_LOG_MAX_BYTES };

/** キー変換失敗の記録上限（1 セッション）。第12項の「Console が埋まる」を再現しない。 */
export const PREVIEW_DIAGNOSTICS_KEY_LOG_LIMIT = 20;

export interface PreviewDiagnosticsLogIo {
    /** 保存先ファイルの URI 文字列を返す（ホーム解決を含む）。 */
    resolveLogUri(): Promise<string>;
    readText(uri: string): Promise<string | undefined>;
    writeText(uri: string, text: string): Promise<void>;
    /** Electron main に JSON Lines を追記する経路。あれば readText / writeText を使わない。 */
    appendLines?(lines: string[]): Promise<void>;
    warn(message: string, error?: unknown): void;
}

/** JSON Lines 追記器。Electron では main へ渡し、それ以外は FileService で上限付き保存する。 */
export class PreviewDiagnosticsLog {
    protected text: string | undefined;
    protected uri: string | undefined;
    protected tail: Promise<void> = Promise.resolve();
    protected disabled = false;
    /** 未書き出しの行。直列チェーンの先頭の書き出しがまとめて掃き出す（毎行 1 書き込みにしない）。 */
    protected pending: string[] = [];

    constructor(protected readonly io: PreviewDiagnosticsLogIo) {}

    /** 書き込みは待たない（プレビューの初期化を診断で遅らせない）。 */
    append(entry: PreviewDiagnosticsLogEntry): void {
        this.pending.push(previewDiagnosticsLogLine(entry));
        this.tail = this.tail.then(() => this.drain()).catch(error => {
            this.io.warn('[akari-preview] 診断ログの書き込みに失敗しました', error);
        });
    }

    /** テストと「書き終わったか」の確認用。 */
    settled(): Promise<void> {
        return this.tail;
    }

    /** 画面に出す保存先パス（未解決なら undefined）。 */
    location(): string | undefined {
        return this.uri;
    }

    protected async drain(): Promise<void> {
        if (this.disabled || this.pending.length === 0) return;
        if (this.uri === undefined) {
            try {
                this.uri = await this.io.resolveLogUri();
            } catch (error) {
                this.disabled = true;
                this.io.warn('[akari-preview] 診断ログの保存先を解決できませんでした', error);
                return;
            }
        }
        if (this.io.appendLines) {
            await this.io.appendLines(this.pending.splice(0, this.pending.length));
            return;
        }
        if (this.text === undefined) {
            let existing: string | undefined;
            try {
                existing = await this.io.readText(this.uri);
            } catch {
                existing = undefined;
            }
            this.text = typeof existing === 'string' ? existing : '';
        }
        // URI 解決・既存読み取りを待っている間に積まれた行もまとめて書く。
        const lines = this.pending.splice(0, this.pending.length);
        let next = this.text + lines.map(line => line + '\n').join('');
        if (next.length > PREVIEW_DIAGNOSTICS_LOG_MAX_BYTES) {
            const lines = next.split('\n');
            while (lines.join('\n').length > PREVIEW_DIAGNOSTICS_LOG_MAX_BYTES && lines.length > 1) {
                lines.shift();
            }
            next = lines.join('\n');
        }
        this.text = next;
        await this.io.writeText(this.uri, next);
    }
}

export interface PreviewDiagnosticsOverlayModel {
    title: string;
    stageLines: string[];
    firstErrorLine: string;
    /** 利用者が「診断をコピー」で持ち出す本文（ログの 1 行と同じ内容の人間向け整形）。 */
    reportText: string;
    footerLines: string[];
    canReopen?: boolean;
}

export interface PreviewDiagnosticsOverlay {
    show(model: PreviewDiagnosticsOverlayModel): void;
    hide(): void;
}

/** 画面（とコピー用テキスト）に出す内容。原因を断定する語を入れない。 */
export function buildPreviewDiagnosticsOverlayModel(
    summary: PreviewInitSummary,
    context: PreviewDiagnosticsContext,
    logPath?: string,
    unresponsive = false
): PreviewDiagnosticsOverlayModel {
    const blocked = summary.failedStage ?? summary.stalledStage;
    const title = summary.rendererGone
        ? 'プレビューの表示処理が停止しました'
            + (summary.rendererGone.reason === 'unknown' ? ''
                : '（理由: ' + describePreviewRendererGoneReason(summary.rendererGone.reason) + '）')
        : unresponsive
            ? 'プレビューが応答していません'
                + (summary.complete ? '' : ' — 止まった段: ' + (blocked ? blocked.label : '不明'))
        : summary.complete
        ? 'プレビュー初期化は完了しています'
        : 'プレビューの初期化が完了しません — 止まった段: '
            + (blocked ? blocked.label : '不明');
    const stageLines = summary.stages.map(stage =>
        (stage.status === 'ok' ? '✓ ' : stage.status === 'failed' ? '✕ ' : '… ')
        + stage.label
        + (stage.detail ? ' — ' + stage.detail : '')
    );
    const firstErrorLine = summary.rendererGone
        ? '最初の例外: 例外ではなくプロセスの停止を検知しました'
        : summary.firstError
        ? '最初の例外: [' + summary.firstError.kind + '] ' + summary.firstError.message
        : '最初の例外: 記録なし（例外なしで止まっています）';
    const footerLines: string[] = [];
    footerLines.push('入口: ' + context.entry + (context.webviewRole ? ' / ' + context.webviewRole : ''));
    if (context.webviewId) footerLines.push('Webview ID: ' + context.webviewId);
    if (logPath) footerLines.push('診断ログ: ' + logPath);
    if (summary.rendererGone) {
        if (summary.rendererGone.reason === 'unknown') {
            footerLines.push('停止の理由は取得できませんでした');
        }
        footerLines.push('停止: reason=' + summary.rendererGone.reason
            + ' exitCode=' + (summary.rendererGone.exitCode ?? '不明')
            + ' 時刻=' + summary.rendererGone.at);
        footerLines.push('停止の時点で ok だった段: '
            + summary.stages.filter(stage => stage.status === 'ok').map(stage => stage.label).join('、'));
        if (!summary.complete && blocked) {
            footerLines.push('停止の時点で未完了だった段: ' + blocked.label);
        }
    } else {
        footerLines.push('これは失敗段の記録です（原因の断定ではありません）。');
    }
    return {
        title,
        stageLines,
        firstErrorLine,
        reportText: formatPreviewInitReport(summary, { ...context, unresponsive }),
        footerLines,
        canReopen: !!summary.rendererGone
    };
}

export interface PreviewDiagnosticsIo {
    now(): number;
    nowIso(): string;
    setTimeout(handler: () => void, ms: number): unknown;
    clearTimeout(handle: unknown): void;
    warn(message: string, error?: unknown): void;
    /** 「コピー」用。失敗しても診断表示は壊さない。 */
    copyText?(text: string): void;
}

export interface PreviewDiagnosticsSubject {
    /** Console に出るものと同じ Webview widget の id。 */
    id: string;
    kind: 'raw' | 'output';
    editUri?: string;
    overlay?: PreviewDiagnosticsOverlay;
    /** 監視までの猶予（ms）。省略時は PREVIEW_DIAGNOSTICS_WATCHDOG_MS。 */
    watchdogMs?: number;
    /** タブ非表示やウィンドウ最小化中は心拍の欠落を数えない。 */
    isActive?: () => boolean;
}

export function shouldDeliverPreviewRendererGone(
    widget: {
        isDisposed: boolean;
        isAttached: boolean;
        akariPreviewDiagnostics?: PreviewDiagnosticsSession;
    } | undefined,
    notice: { at: string; observedAt: number }
): boolean {
    return !!widget && !widget.isDisposed && widget.isAttached
        && !!widget.akariPreviewDiagnostics?.acceptsRendererGoneNotice(notice.at, notice.observedAt);
}

/** webview から届く報告の形（`akari-preview-diagnostics` メッセージ）。 */
export interface PreviewDiagnosticsReport {
    type: 'akari-preview-diagnostics';
    phase: 'ready' | 'stuck' | 'stage' | 'event' | 'heartbeat';
    trace?: PreviewInitTrace;
    stage?: PreviewInitStageId;
    status?: PreviewInitStageStatus;
    detail?: string;
    event?: PreviewDiagnosticEvent;
    frameEngine?: boolean;
    assetOrigin?: string;
    userAgent?: string;
    pressureObserver?: string;
}

export function isPreviewDiagnosticsReport(message: unknown): message is PreviewDiagnosticsReport {
    const candidate = message as PreviewDiagnosticsReport | null | undefined;
    return !!candidate && candidate.type === 'akari-preview-diagnostics'
        && (candidate.phase === 'ready' || candidate.phase === 'stuck'
            || candidate.phase === 'stage' || candidate.phase === 'event' || candidate.phase === 'heartbeat');
}

export class PreviewDiagnosticsSession {
    readonly trace: PreviewInitTrace = createPreviewInitTrace(PREVIEW_INIT_STAGES);
    readonly role: string;
    readonly createdAt: number;
    protected watchdog: unknown;
    protected heartbeatWatchdog: unknown;
    protected watchdogFired = false;
    protected reported = false;
    protected overlayVisible = false;
    protected frameEngine: boolean | undefined;
    protected assetOrigin: string | undefined;
    protected userAgent: string | undefined;
    protected disposed = false;
    protected unresponsive = false;
    protected ready = false;
    protected missingHeartbeatMs = 0;

    constructor(
        protected readonly io: PreviewDiagnosticsIo,
        protected readonly log: PreviewDiagnosticsLog,
        readonly subject: PreviewDiagnosticsSubject
    ) {
        this.createdAt = this.io.now();
        this.role = describePreviewWebviewRole(subject.id).label;
        this.log.append({
            at: this.io.nowIso(),
            entry: 'desktop-webview',
            event: 'webview-registered',
            webviewId: subject.id,
            webviewRole: this.role,
            ...(subject.editUri === undefined ? {} : { editUri: subject.editUri })
        });
    }

    context(): PreviewDiagnosticsContext {
        return {
            entry: 'desktop-webview',
            webviewId: this.subject.id,
            webviewRole: this.role,
            at: this.io.nowIso(),
            ...(this.subject.editUri === undefined ? {} : { editUri: this.subject.editUri }),
            ...(this.frameEngine === undefined ? {} : { frameEngine: this.frameEngine }),
            ...(this.assetOrigin === undefined ? {} : { assetOrigin: this.assetOrigin }),
            ...(this.userAgent === undefined ? {} : { userAgent: this.userAgent })
        };
    }

    describeFace(options: { frameEngine?: boolean; assetOrigin?: string }): void {
        if (options.frameEngine !== undefined) this.frameEngine = options.frameEngine;
        if (options.assetOrigin !== undefined) this.assetOrigin = options.assetOrigin;
    }

    markStage(stage: PreviewInitStageId, status: PreviewInitStageStatus, detail?: string): void {
        if (this.disposed || this.trace.rendererGone) return;
        markPreviewInitStage(this.trace, stage, status, { at: this.io.now(), ...(detail === undefined ? {} : { detail }) });
        if (status !== 'pending') {
            this.log.append({
                at: this.io.nowIso(),
                entry: 'desktop-webview',
                event: 'stage',
                webviewId: this.subject.id,
                webviewRole: this.role,
                stage,
                status,
                ...(detail === undefined ? {} : { message: detail }),
                ...(this.subject.editUri === undefined ? {} : { editUri: this.subject.editUri })
            });
        }
        if (status === 'failed') this.surface('stage-failed');
        if (stage === 'page-html-set' && status === 'ok') this.arm();
        if (stage === 'first-frame' && status === 'ok') this.settle();
    }

    /** ページ側から届いた報告を取り込む。信用せず形だけ検査する（webview は別プロセス）。 */
    ingest(report: PreviewDiagnosticsReport): void {
        if (this.disposed || this.trace.rendererGone) return;
        if (report.phase === 'heartbeat') {
            if (this.ready) {
                this.missingHeartbeatMs = 0;
                if (this.unresponsive && this.overlayVisible) {
                    this.subject.overlay?.hide();
                    this.overlayVisible = false;
                    this.unresponsive = false;
                }
                this.armHeartbeat();
            }
            return;
        }
        if (report.frameEngine !== undefined) this.frameEngine = report.frameEngine === true;
        if (typeof report.assetOrigin === 'string') this.assetOrigin = report.assetOrigin;
        if (typeof report.userAgent === 'string') this.userAgent = report.userAgent.slice(0, 300);
        if (typeof report.pressureObserver === 'string') {
            recordPreviewDiagnosticEvent(this.trace, {
                kind: 'note',
                message: 'compute-pressure ガード: ' + report.pressureObserver,
                at: this.io.now()
            });
        }
        if (report.phase === 'stage' && report.stage && report.status) {
            markPreviewInitStage(this.trace, report.stage, report.status, {
                at: this.io.now(),
                ...(report.detail === undefined ? {} : { detail: report.detail })
            });
        }
        if (report.phase === 'event' && report.event) {
            recordPreviewDiagnosticEvent(this.trace, report.event);
        }
        if (report.trace) this.mergeTrace(report.trace);
        this.reported = true;
        if (report.phase === 'ready') {
            this.settle();
            return;
        }
        if (report.phase === 'stuck') {
            this.surface('webview-stuck');
        }
    }

    protected mergeTrace(incoming: PreviewInitTrace): void {
        const stages = Array.isArray(incoming.stages) ? incoming.stages : [];
        for (const stage of stages) {
            if (!stage || typeof stage.id !== 'string') continue;
            if (stage.status !== 'ok' && stage.status !== 'failed') continue;
            markPreviewInitStage(this.trace, stage.id as PreviewInitStageId, stage.status, {
                at: this.io.now(),
                ...(stage.detail === undefined ? {} : { detail: String(stage.detail) })
            });
        }
        const events = Array.isArray(incoming.events) ? incoming.events : [];
        for (const event of events) {
            if (!event || typeof event.message !== 'string') continue;
            recordPreviewDiagnosticEvent(this.trace, event);
        }
    }

    protected arm(): void {
        if (this.watchdog !== undefined || this.watchdogFired || this.trace.rendererGone) return;
        const delay = typeof this.subject.watchdogMs === 'number' && this.subject.watchdogMs > 0
            ? this.subject.watchdogMs
            : PREVIEW_DIAGNOSTICS_WATCHDOG_MS;
        this.watchdog = this.io.setTimeout(() => {
            this.watchdog = undefined;
            this.watchdogFired = true;
            const summary = summarizePreviewInit(this.trace);
            if (summary.complete) return;
            if (!this.reported) {
                recordPreviewDiagnosticEvent(this.trace, {
                    kind: 'note',
                    at: this.io.now(),
                    message: 'ページ側から診断の報告が届いていません'
                        + '（ページのスクリプトが実行されていない可能性。断定はできません）'
                });
            }
            this.surface('watchdog');
        }, delay);
    }

    protected settle(): void {
        if (this.trace.rendererGone) return;
        if (this.watchdog !== undefined) {
            this.io.clearTimeout(this.watchdog);
            this.watchdog = undefined;
        }
        const summary = summarizePreviewInit(this.trace);
        if (summary.complete) {
            this.ready = true;
            this.missingHeartbeatMs = 0;
            this.armHeartbeat();
        }
        if (summary.complete && this.overlayVisible) {
            this.subject.overlay?.hide();
            this.overlayVisible = false;
        }
        this.log.append(this.entryFor('report', summary));
    }

    protected armHeartbeat(): void {
        if (this.heartbeatWatchdog !== undefined) this.io.clearTimeout(this.heartbeatWatchdog);
        this.heartbeatWatchdog = this.io.setTimeout(() => {
            this.heartbeatWatchdog = undefined;
            if (this.disposed || this.trace.rendererGone || !this.ready) return;
            this.missingHeartbeatMs = (this.subject.isActive?.() ?? true)
                ? this.missingHeartbeatMs + PREVIEW_DIAGNOSTICS_HEARTBEAT_CHECK_MS : 0;
            if (!this.unresponsive && this.missingHeartbeatMs >= PREVIEW_DIAGNOSTICS_WATCHDOG_MS) {
                this.surface('watchdog');
            }
            this.armHeartbeat();
        }, PREVIEW_DIAGNOSTICS_HEARTBEAT_CHECK_MS);
    }

    /** 画面へ出す（既に出ていれば最新内容で描き替える）。 */
    protected surface(cause: 'watchdog' | 'stage-failed' | 'webview-stuck'): void {
        if (this.trace.rendererGone) return;
        this.unresponsive = cause === 'watchdog';
        const summary = summarizePreviewInit(this.trace);
        this.log.append({
            ...this.entryFor(cause === 'watchdog' ? 'watchdog' : 'report', summary),
            message: cause
        });
        const overlay = this.subject.overlay;
        if (!overlay) return;
        overlay.show(buildPreviewDiagnosticsOverlayModel(summary, this.context(), this.log.location(), this.unresponsive));
        this.overlayVisible = true;
    }

    rendererGone(gone: PreviewRendererGone): void {
        if (this.disposed || this.trace.rendererGone) return;
        this.trace.rendererGone = gone;
        this.unresponsive = false;
        if (this.watchdog !== undefined) {
            this.io.clearTimeout(this.watchdog);
            this.watchdog = undefined;
        }
        if (this.heartbeatWatchdog !== undefined) {
            this.io.clearTimeout(this.heartbeatWatchdog);
            this.heartbeatWatchdog = undefined;
        }
        const summary = summarizePreviewInit(this.trace);
        this.log.append({
            ...this.entryFor('renderer-gone', summary),
            at: gone.at,
            rendererGone: gone
        });
        this.subject.overlay?.show(buildPreviewDiagnosticsOverlayModel(summary, this.context(), this.log.location()));
        this.overlayVisible = !!this.subject.overlay;
    }

    acceptsRendererGoneNotice(at: string, observedAt: number): boolean {
        const noticeAt = Date.parse(at);
        return !this.disposed && !this.trace.rendererGone
            && Number.isFinite(noticeAt) && noticeAt >= this.createdAt
            && Number.isFinite(observedAt) && observedAt >= this.createdAt;
    }

    protected entryFor(
        event: PreviewDiagnosticsLogEntry['event'],
        summary: PreviewInitSummary
    ): PreviewDiagnosticsLogEntry {
        return {
            at: this.io.nowIso(),
            entry: 'desktop-webview',
            event,
            webviewId: this.subject.id,
            webviewRole: this.role,
            ...(this.subject.editUri === undefined ? {} : { editUri: this.subject.editUri }),
            ...(this.frameEngine === undefined ? {} : { frameEngine: this.frameEngine }),
            ...(this.assetOrigin === undefined ? {} : { assetOrigin: this.assetOrigin }),
            ...(this.userAgent === undefined ? {} : { userAgent: this.userAgent }),
            summary: summaryForLog(summary)
        };
    }

    /** 段に紐づかない事実（メッセージカード表示など）を診断とログへ残す。 */
    note(message: string): void {
        if (this.disposed) return;
        recordPreviewDiagnosticEvent(this.trace, { kind: 'note', message, at: this.io.now() });
        this.log.append({
            at: this.io.nowIso(),
            entry: 'desktop-webview',
            event: 'note',
            webviewId: this.subject.id,
            webviewRole: this.role,
            ...(this.subject.editUri === undefined ? {} : { editUri: this.subject.editUri }),
            message
        });
    }

    /** 再読込（setHTML のやり直し）で段をやり直す。ホスト側で到達済みの段は保持する。 */
    restartPageStages(): void {
        this.trace.rendererGone = undefined;
        this.unresponsive = false;
        this.ready = false;
        this.missingHeartbeatMs = 0;
        if (this.heartbeatWatchdog !== undefined) {
            this.io.clearTimeout(this.heartbeatWatchdog);
            this.heartbeatWatchdog = undefined;
        }
        if (this.overlayVisible) {
            this.subject.overlay?.hide();
            this.overlayVisible = false;
        }
        for (const stage of this.trace.stages) {
            if (stage.side !== 'webview') continue;
            stage.status = 'pending';
            stage.detail = undefined;
        }
        this.reported = false;
        this.watchdogFired = false;
        if (this.watchdog !== undefined) {
            this.io.clearTimeout(this.watchdog);
            this.watchdog = undefined;
        }
    }

    dispose(): void {
        this.disposed = true;
        if (this.watchdog !== undefined) {
            this.io.clearTimeout(this.watchdog);
            this.watchdog = undefined;
        }
        if (this.heartbeatWatchdog !== undefined) {
            this.io.clearTimeout(this.heartbeatWatchdog);
            this.heartbeatWatchdog = undefined;
        }
        if (this.overlayVisible) {
            this.subject.overlay?.hide();
            this.overlayVisible = false;
        }
    }

    /** 「診断をコピー」。クリップボードが使えない環境でも表示は保つ。 */
    copyReport(): string {
        const text = formatPreviewInitReport(summarizePreviewInit(this.trace), {
            ...this.context(), unresponsive: this.unresponsive
        });
        try {
            this.io.copyText?.(text);
        } catch (error) {
            this.io.warn('[akari-preview] 診断のコピーに失敗しました', error);
        }
        return text;
    }
}

export class PreviewDiagnosticsCenter {
    protected keyFailures = 0;

    constructor(
        protected readonly io: PreviewDiagnosticsIo,
        readonly log: PreviewDiagnosticsLog
    ) {}

    register(subject: PreviewDiagnosticsSubject): PreviewDiagnosticsSession {
        return new PreviewDiagnosticsSession(this.io, this.log, subject);
    }

    /**
     * 第12項: キー変換失敗の「発火条件」を残す。`Cannot get key code from the keyboard event`
     * 自体は @theia/core（app.asar 内）が出しているのでここからは止められない。ここでは
     * **同じ瞬間のイベントの形**（key / code / keyCode / IME 合成）を上限付きで残し、
     * 次の採取で条件を絞れるようにする。灰色との因果は未確認。
     */
    recordKeyConversionFailure(event: unknown, reason?: unknown): void {
        if (this.keyFailures >= PREVIEW_DIAGNOSTICS_KEY_LOG_LIMIT) return;
        this.keyFailures += 1;
        const described = describeKeyEventConversionFailure(event, reason);
        this.log.append({
            at: this.io.nowIso(),
            entry: 'desktop-host',
            event: 'key-conversion',
            message: described.message
        });
    }

    /** keydown / keyup の「疑わしい形」を捕まえるだけの観測リスナー（本筋を妨げない）。 */
    observeKeyEvent(event: unknown): boolean {
        if (!isSuspiciousKeyEventShape(event)) return false;
        this.recordKeyConversionFailure(event, 'KeyCode 変換が落ちうる形のキーイベント（観測のみ）');
        return true;
    }

    note(message: string): void {
        this.log.append({
            at: this.io.nowIso(),
            entry: 'desktop-host',
            event: 'note',
            message
        });
    }
}

/**
 * widget の DOM に載せる診断バンド。ページ側が何も描けない（灰色）ときでも見えるように、
 * iframe の外・widget ノード直下へ置き、スタイルはすべてインラインで持つ。
 * 折りたたみ既定なので、成功時の見た目は変わらない（そもそも成功時は出さない）。
 */
export function createDomPreviewDiagnosticsOverlay(
    node: HTMLElement,
    handlers: { onCopy: () => void; onReopen?: () => void }
): PreviewDiagnosticsOverlay {
    const document = node.ownerDocument;
    let root: HTMLElement | undefined;
    let expanded = false;
    let current: PreviewDiagnosticsOverlayModel | undefined;

    const applyBand = (band: HTMLElement): void => {
        band.style.display = 'flex';
        band.style.alignItems = 'center';
        band.style.gap = '8px';
        band.style.padding = '6px 10px';
        band.style.background = 'rgba(96,24,24,0.94)';
        band.style.color = '#ffecec';
        band.style.font = '12px/1.5 system-ui, sans-serif';
    };

    const render = (): void => {
        if (!root || !current) return;
        root.textContent = '';
        const band = document.createElement('div');
        applyBand(band);
        const title = document.createElement('span');
        title.textContent = current.title;
        title.style.flex = '1 1 auto';
        title.style.overflow = 'hidden';
        title.style.textOverflow = 'ellipsis';
        title.style.whiteSpace = 'nowrap';
        const detailsButton = document.createElement('button');
        detailsButton.type = 'button';
        detailsButton.textContent = expanded ? '詳細を隠す' : '詳細';
        detailsButton.dataset.akariPreviewDiagnostics = 'toggle';
        const copyButton = document.createElement('button');
        copyButton.type = 'button';
        copyButton.textContent = '診断をコピー';
        copyButton.dataset.akariPreviewDiagnostics = 'copy';
        const reopenButton = document.createElement('button');
        reopenButton.type = 'button';
        reopenButton.textContent = '開き直す';
        reopenButton.dataset.akariPreviewDiagnostics = 'reopen';
        for (const button of [detailsButton, copyButton, reopenButton]) {
            button.style.border = '1px solid rgba(255,255,255,0.45)';
            button.style.borderRadius = '4px';
            button.style.padding = '2px 8px';
            button.style.background = 'transparent';
            button.style.color = 'inherit';
            button.style.cursor = 'pointer';
            button.style.font = 'inherit';
        }
        detailsButton.addEventListener('click', () => {
            expanded = !expanded;
            render();
        });
        copyButton.addEventListener('click', () => handlers.onCopy());
        reopenButton.addEventListener('click', () => handlers.onReopen?.());
        band.append(title, detailsButton, copyButton);
        if (current.canReopen && handlers.onReopen) band.append(reopenButton);
        root.append(band);
        if (!expanded) return;
        const body = document.createElement('pre');
        body.dataset.akariPreviewDiagnostics = 'detail';
        body.style.margin = '0';
        body.style.maxHeight = '40vh';
        body.style.overflow = 'auto';
        body.style.padding = '8px 10px';
        body.style.background = 'rgba(16,16,16,0.96)';
        body.style.color = '#e8e8e8';
        body.style.font = '11px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace';
        body.style.whiteSpace = 'pre-wrap';
        body.textContent = [
            ...current.stageLines,
            current.firstErrorLine,
            ...current.footerLines
        ].join('\n');
        root.append(body);
    };

    return {
        show(model: PreviewDiagnosticsOverlayModel): void {
            current = model;
            if (!root) {
                root = document.createElement('div');
                root.id = 'akari-preview-diagnostics-band';
                root.dataset.akariPreviewDiagnostics = 'band';
                root.style.position = 'absolute';
                root.style.left = '0';
                root.style.top = '0';
                root.style.right = '0';
                root.style.zIndex = '2147483000';
                root.style.pointerEvents = 'auto';
                node.append(root);
            }
            render();
        },
        hide(): void {
            expanded = false;
            current = undefined;
            root?.remove();
            root = undefined;
        }
    };
}
