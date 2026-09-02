import * as React from '@theia/core/shared/react';
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { Message } from '@theia/core/shared/@lumino/messaging';
import { CommandService, Disposable, DisposableCollection, MessageService } from '@theia/core/lib/common';
import { ApplicationShell, WidgetManager } from '@theia/core/lib/browser';
import URI from '@theia/core/lib/common/uri';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { FileStat } from '@theia/filesystem/lib/common/files';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { WindowService } from '@theia/core/lib/browser/window/window-service';
import { describeUnexpectedQuickExportFailure } from '../common/quick-export-cli';
import { quickExportStageLabel } from '../common/quick-export-ui';
import { AkariPreviewServerService, PreviewServerStatus } from '../common/preview-server-protocol';
import { buildPreviewOpenUrl, PreviewOpenVariant } from '../common/preview-server-cli';
import { AkariExportSessionService } from './akari-export-session-service';
import { AkariExportDialog } from './export-dialog/akari-export-dialog';

interface MenuAction {
    id: string;
    label: string;
    icon: string;
    run: () => void;
    disabled?: boolean;
    title?: string;
}

interface SkillEntry {
    name: string;
    description: string;
}

// AkariHomeWidget（akari-surfaces 拡張）の id 文字列。パッケージ間の import を
// 増やさないため定数として直接持つ（akari-project の 'files' 参照など、
// 既存コードにも同じ「文字列 id だけ知っている」パターンがある）。
const HOME_WIDGET_ID = 'akari-home-widget';

const SHOW_CHANGES_COMMAND = 'akari.project.showChanges';
const OPEN_ANNOTATIONS_COMMAND = 'akari.annotations.open';
const OPEN_TRANSCRIPT_COMMAND = 'akari.transcript.open';

const EDIT_JSON_RELATIVE_PATH = 'edit.json';
const EDIT_JSON_MISSING_TOOLTIP = 'edit.json がまだありません。編集を進めてから書き出してください。';
/** ブラウザプレビュー（preview-server）の状態ポーリング間隔（裁定 1-f: 1,000 ms）。 */
const PREVIEW_SERVER_POLL_INTERVAL_MS = 1000;
const PREVIEW_EDIT_JSON_MISSING_TOOLTIP = 'edit.json がまだありません。編集を進めてからプレビューしてください。';
const PREVIEW_WORKSPACE_MISSING_TOOLTIP = 'プロジェクトを開くとブラウザプレビューを起動できます。';
/**
 * アクティビティバー5番目のアイコン「メニュー」。
 *
 * - 「ひらく」: よく使う画面をワンクリックで開く（CommandService 経由。
 *   俯瞰だけは専用コマンドが無いため WidgetManager + ApplicationShell で
 *   直接 shell へ再アタッチする）。
 * - 「やらせる（スキル）」: 開いているプロジェクトの `.claude/skills/<name>/SKILL.md`
 *   の frontmatter（name / description）を列挙する v0 実装。ワンクリック実行は
 *   スコープ外 — パートナーペインでの依頼を促す文言のみ添える。
 * - 「書き出し」: 固定サイズのダイアログを開く。実行状態とポーリングは
 *   singleton のセッションサービスが所有し、左パネルは小さな状態表示だけを行う。
 */
@injectable()
export class AkariMenuWidget extends ReactWidget {
    static readonly ID = 'akari-menu-widget';

    @inject(CommandService)
    protected readonly commands!: CommandService;
    @inject(WidgetManager)
    protected readonly widgetManager!: WidgetManager;
    @inject(ApplicationShell)
    protected readonly shell!: ApplicationShell;
    @inject(FileService)
    protected readonly files!: FileService;
    @inject(WorkspaceService)
    protected readonly workspace!: WorkspaceService;
    @inject(AkariPreviewServerService)
    protected readonly previewServerService!: AkariPreviewServerService;
    @inject(WindowService)
    protected readonly windowService!: WindowService;
    @inject(MessageService)
    protected readonly messages!: MessageService;
    @inject(AkariExportSessionService)
    protected readonly exportSession!: AkariExportSessionService;
    @inject(AkariExportDialog)
    protected readonly exportDialog!: AkariExportDialog;

    protected skills: SkillEntry[] = [];
    protected skillsNotice = '';
    protected editJsonExists = false;
    protected editJsonWatch = new DisposableCollection();
    /** ワークスペースが開いているか（ブラウザプレビューの tooltip 分岐に使う）。 */
    protected workspaceOpened = false;
    /** ブラウザプレビュー（preview-server）のバックエンド状態のミラー。 */
    protected previewServerStatus: PreviewServerStatus = { phase: 'idle', logTail: '' };
    protected previewServerPollHandle: number | undefined;
    /** start / stop の RPC が返るまでボタンを二重押しさせないガード。 */
    protected previewServerBusy = false;

    @postConstruct()
    protected init(): void {
        this.id = AkariMenuWidget.ID;
        this.title.label = 'メニュー';
        this.title.caption = 'メニュー';
        this.title.iconClass = 'codicon codicon-menu';
        this.title.closable = false;
        this.toDispose.push(this.workspace.onWorkspaceChanged(() => {
            void this.loadSkills();
            void this.watchEditJson();
            void this.resetPreviewServerOnWorkspaceChange();
        }));
        this.toDispose.push(this.exportSession.onDidChange(() => this.update()));
        // widget dispose ではポーリングだけ止める（サーバーは止めない —
        // メニューを閉じても生かす。裁定 1-f）。
        this.toDispose.push(Disposable.create(() => this.stopPreviewServerPolling()));
        void this.loadSkills();
        void this.watchEditJson();
        void this.syncPreviewServerStatus();
        this.update();
    }

    protected override onAfterShow(msg: Message): void {
        super.onAfterShow(msg);
        void this.loadSkills();
    }

    protected get actions(): MenuAction[] {
        return [
            { id: OPEN_ANNOTATIONS_COMMAND, label: 'タイムライン', icon: 'codicon codicon-comment', run: () => this.runCommand(OPEN_ANNOTATIONS_COMMAND) },
            { id: OPEN_TRANSCRIPT_COMMAND, label: '文字起こし', icon: 'codicon codicon-comment-discussion', run: () => this.runCommand(OPEN_TRANSCRIPT_COMMAND) },
            { id: 'akari.menu.openOverview', label: 'ホーム', icon: 'codicon codicon-home', run: () => void this.openOverview() },
            { id: SHOW_CHANGES_COMMAND, label: '変更を見る', icon: 'codicon codicon-diff', run: () => this.runCommand(SHOW_CHANGES_COMMAND) },
            this.browserPreviewAction()
        ];
    }

    /**
     * 5 番目「ブラウザプレビュー」（裁定 1-a〜c）。ゲートは書き出しボタンと同じ
     * editJsonExists（シェル側で edit.json は作らない）。starting 中は disabled +
     * ラベル「起動中…」。
     */
    protected browserPreviewAction(): MenuAction {
        const starting = this.previewServerStatus.phase === 'starting';
        let title: string | undefined;
        if (!this.workspaceOpened) {
            title = PREVIEW_WORKSPACE_MISSING_TOOLTIP;
        } else if (!this.editJsonExists) {
            title = PREVIEW_EDIT_JSON_MISSING_TOOLTIP;
        }
        return {
            id: 'akari.menu.browserPreview',
            label: starting ? '起動中…' : 'ブラウザプレビュー',
            icon: 'codicon codicon-globe',
            disabled: !this.workspaceOpened || !this.editJsonExists || starting || this.previewServerBusy,
            title,
            run: () => void this.openBrowserPreview()
        };
    }

    protected runCommand(commandId: string): void {
        this.commands.executeCommand(commandId).catch(error => {
            console.warn(`[akari-shell-strip] menu action failed (${commandId}):`, error);
        });
    }

    /**
     * 俯瞰（AkariHomeWidget）を開く既存コマンドは無いため、shell への
     * 再アタッチで代替する。同 widget は closable=false のため通常は
     * 既にアタッチ済みだが、念のため未アタッチ時は左パネル同様の要領で
     * main エリアへ addWidget してから activate する。
     */
    protected async openOverview(): Promise<void> {
        try {
            const widget = await this.widgetManager.getOrCreateWidget(HOME_WIDGET_ID);
            if (!widget.isAttached) {
                this.shell.addWidget(widget, { area: 'main', rank: 10 });
            }
            await this.shell.activateWidget(widget.id);
        } catch (error) {
            console.warn('[akari-shell-strip] failed to reveal overview widget:', error);
        }
    }

    protected async loadSkills(): Promise<void> {
        const roots = await this.workspace.roots;
        const root = roots[0]?.resource;
        if (!root) {
            this.skills = [];
            this.skillsNotice = 'プロジェクトを開くと、使えるスキルがここに並びます。';
            this.update();
            return;
        }
        let stat: FileStat;
        try {
            stat = await this.files.resolve(root.resolve('.claude/skills'));
        } catch {
            this.skills = [];
            this.skillsNotice = 'このプロジェクトにはスキルがまだありません。';
            this.update();
            return;
        }
        const directories = (stat.children ?? []).filter(child => child.isDirectory);
        const parsed: SkillEntry[] = [];
        for (const directory of directories) {
            try {
                const content = await this.files.readFile(directory.resource.resolve('SKILL.md'));
                const entry = this.parseFrontmatter(content.value.toString());
                if (entry) {
                    parsed.push(entry);
                }
            } catch {
                // SKILL.md が無い/読めないディレクトリは静かにスキップする。
            }
        }
        parsed.sort((left, right) => left.name.localeCompare(right.name));
        this.skills = parsed;
        this.skillsNotice = parsed.length === 0 ? 'このプロジェクトにはスキルがまだありません。' : '';
        this.update();
    }

    /**
     * SKILL.md 先頭の `---`〜`---` frontmatter から name / description のみを
     * 拾う簡易パーサー。この用途の frontmatter は単一行の `key: value` のみで
     * 構成される（ブロックスカラー等は使わない）ため、外部 YAML 依存を増やさず
     * 自前で十分まかなえる。
     */
    protected parseFrontmatter(content: string): SkillEntry | undefined {
        const lines = content.split(/\r?\n/);
        if (lines[0]?.trim() !== '---') {
            return undefined;
        }
        let name: string | undefined;
        let description: string | undefined;
        for (let i = 1; i < lines.length; i++) {
            const line = lines[i];
            if (line.trim() === '---') {
                break;
            }
            const match = /^([a-zA-Z_-]+):\s?(.*)$/.exec(line);
            if (!match) {
                continue;
            }
            if (match[1] === 'name') {
                name = match[2].trim();
            } else if (match[1] === 'description') {
                description = match[2].trim();
            }
        }
        return name ? { name, description: description ?? '' } : undefined;
    }

    // --- 書き出しボタン（edit.json 有無ゲート） -------------------------------

    protected async watchEditJson(): Promise<void> {
        this.editJsonWatch.dispose();
        this.editJsonWatch = new DisposableCollection();
        const roots = await this.workspace.roots;
        const root = roots[0]?.resource;
        if (!root) {
            this.workspaceOpened = false;
            this.editJsonExists = false;
            this.update();
            return;
        }
        this.workspaceOpened = true;
        const editJsonUri = root.resolve(EDIT_JSON_RELATIVE_PATH);
        await this.refreshEditJsonExists(editJsonUri);
        try {
            this.editJsonWatch.push(await this.files.watch(root));
        } catch (error) {
            console.info('[akari-shell-strip] edit.json watch unavailable:', error);
        }
        this.editJsonWatch.push(this.files.onDidFilesChange(event => {
            if (event.contains(editJsonUri)) {
                void this.refreshEditJsonExists(editJsonUri);
            }
        }));
    }

    protected async refreshEditJsonExists(editJsonUri: URI): Promise<void> {
        let exists: boolean;
        try {
            exists = await this.files.exists(editJsonUri);
        } catch {
            exists = false;
        }
        if (exists === this.editJsonExists) {
            return;
        }
        this.editJsonExists = exists;
        this.update();
    }

    protected async openExportDialog(): Promise<void> {
        if (!this.editJsonExists) {
            return;
        }
        await this.exportSession.prepareCurrentProject();
        void this.exportDialog.open(false);
    }

    // --- ブラウザプレビュー（preview-server 起動・URL 表示・最新 / 従来切替） ----

    /** 押下の意味（裁定 1-b）: idle / failed なら起動して最新版を開く。running なら開くだけ。 */
    protected async openBrowserPreview(): Promise<void> {
        const status = this.previewServerStatus;
        if (status.phase === 'running' && status.url) {
            this.openPreviewInBrowser('latest');
            return;
        }
        if (status.phase === 'starting' || this.previewServerBusy || !this.editJsonExists) {
            return;
        }
        await this.startPreviewServer();
    }

    /** start() を running / failed まで待ち、running になったら最新版 URL を外部ブラウザで開く。 */
    protected async startPreviewServer(): Promise<void> {
        if (this.previewServerBusy) {
            return;
        }
        let roots: FileStat[];
        try {
            roots = await this.workspace.roots;
        } catch (error) {
            this.applyPreviewServerStatus({
                phase: 'failed',
                logTail: '',
                failureSummary: describeUnexpectedQuickExportFailure(error, 'プロジェクトルートを取得できませんでした')
            });
            return;
        }
        const root = roots[0]?.resource;
        if (!root) {
            this.applyPreviewServerStatus({
                phase: 'failed',
                logTail: '',
                failureSummary: 'プロジェクトルートを取得できないため、ブラウザプレビューを起動できませんでした'
            });
            return;
        }
        this.previewServerBusy = true;
        this.previewServerStatus = { phase: 'starting', projectRootUri: root.toString(), logTail: '' };
        this.update();
        this.beginPreviewServerPolling();
        let status: PreviewServerStatus;
        try {
            status = await this.previewServerService.start({ projectRootUri: root.toString() });
        } catch (error) {
            status = {
                phase: 'failed',
                logTail: '',
                failureSummary: describeUnexpectedQuickExportFailure(error, 'プレビューサーバーに接続できませんでした')
            };
        }
        this.previewServerBusy = false;
        this.applyPreviewServerStatus(status);
        if (status.phase === 'running' && status.url) {
            this.openPreviewInBrowser('latest');
        }
    }

    protected async stopPreviewServer(): Promise<void> {
        if (this.previewServerBusy) {
            return;
        }
        this.previewServerBusy = true;
        this.update();
        let status: PreviewServerStatus;
        try {
            status = await this.previewServerService.stop();
        } catch (error) {
            status = {
                phase: 'failed',
                logTail: '',
                failureSummary: describeUnexpectedQuickExportFailure(error, 'プレビューサーバーを停止できませんでした')
            };
        }
        this.previewServerBusy = false;
        this.applyPreviewServerStatus(status);
    }

    /** 裁定 1-g: ワークスペースが替わったら stop() を呼び、別プロジェクトのサーバーを残さない。 */
    protected async resetPreviewServerOnWorkspaceChange(): Promise<void> {
        this.stopPreviewServerPolling();
        this.previewServerStatus = { phase: 'idle', logTail: '' };
        this.update();
        try {
            await this.previewServerService.stop();
        } catch (error) {
            console.warn('[akari-shell-strip] preview server stop on workspace change failed:', error);
        }
    }

    /** widget 再生成時に、生かしてあるサーバー（メニューを閉じても止めない）の状態を拾う。 */
    protected async syncPreviewServerStatus(): Promise<void> {
        try {
            this.applyPreviewServerStatus(await this.previewServerService.getStatus());
        } catch (error) {
            console.info('[akari-shell-strip] preview server status unavailable:', error);
        }
    }

    protected applyPreviewServerStatus(status: PreviewServerStatus): void {
        this.previewServerStatus = status;
        if (status.phase === 'starting' || status.phase === 'running') {
            this.beginPreviewServerPolling();
        } else {
            this.stopPreviewServerPolling();
        }
        this.update();
    }

    /** 裁定 1-f: starting / running の間だけ 1,000 ms 間隔で getStatus() を呼ぶ。 */
    protected beginPreviewServerPolling(): void {
        if (this.previewServerPollHandle !== undefined) {
            return;
        }
        this.previewServerPollHandle = window.setInterval(
            () => void this.pollPreviewServerStatus(),
            PREVIEW_SERVER_POLL_INTERVAL_MS
        );
    }

    protected stopPreviewServerPolling(): void {
        if (this.previewServerPollHandle !== undefined) {
            window.clearInterval(this.previewServerPollHandle);
            this.previewServerPollHandle = undefined;
        }
    }

    protected async pollPreviewServerStatus(): Promise<void> {
        let status: PreviewServerStatus;
        try {
            status = await this.previewServerService.getStatus();
        } catch (error) {
            console.warn('[akari-shell-strip] preview server status poll failed:', error);
            return;
        }
        // start / stop の RPC が返るまでは、その戻り値を正とする（直前の phase を
        // 拾って idle / failed へ巻き戻さない）。
        if (this.previewServerBusy && status.phase !== 'starting') {
            return;
        }
        this.applyPreviewServerStatus(status);
    }

    protected openPreviewInBrowser(variant: PreviewOpenVariant): void {
        const base = this.previewServerStatus.url;
        if (!base) {
            return;
        }
        // {external: true} が無いと Electron 版 WindowService は内蔵ウィンドウで開いてしまう
        // （akari-home-widget.tsx の checkVersionNotice と同じ注記）。
        this.windowService.openNewWindow(buildPreviewOpenUrl(base, variant), { external: true });
    }

    protected async copyPreviewServerUrl(url: string): Promise<void> {
        try {
            await navigator.clipboard.writeText(url);
            void this.messages.info('URL をコピーしました');
        } catch (error) {
            console.warn('[akari-shell-strip] clipboard write failed:', error);
        }
    }

    /** 裁定 1-d: 「ひらく」節の直下・phase が idle 以外のときだけ描く状態ブロック。 */
    protected renderPreviewServerStatus(): React.ReactNode {
        const status = this.previewServerStatus;
        if (status.phase === 'idle') {
            return undefined;
        }
        return (
            <div
                data-akari-preview-server-status={status.phase}
                style={{ marginTop: '10px', border: '1px solid var(--theia-widget-border)', borderRadius: '6px', padding: '8px 10px' }}
            >
                {status.phase === 'starting' && (
                    <div style={{ fontSize: '0.85em' }}>プレビューサーバーを起動しています…</div>
                )}
                {status.phase === 'running' && status.url && (
                    <>
                        <div style={{ fontSize: '0.85em' }}>
                            <code
                                data-akari-preview-server-url={status.url}
                                title='クリックで URL をコピー'
                                style={{ cursor: 'pointer', userSelect: 'all' }}
                                onClick={() => void this.copyPreviewServerUrl(status.url!)}
                            >{status.url}</code>
                        </div>
                        <div style={{ display: 'flex', gap: '8px', marginTop: '6px', flexWrap: 'wrap' }}>
                            <button
                                className='theia-button secondary'
                                style={{ padding: '4px 8px', fontSize: '0.85em' }}
                                title={buildPreviewOpenUrl(status.url, 'latest')}
                                onClick={() => this.openPreviewInBrowser('latest')}
                            >
                                最新版で開く
                            </button>
                            <button
                                className='theia-button secondary'
                                style={{ padding: '4px 8px', fontSize: '0.85em' }}
                                title={buildPreviewOpenUrl(status.url, 'legacy')}
                                onClick={() => this.openPreviewInBrowser('legacy')}
                            >
                                従来版で開く（frameEngine=0）
                            </button>
                            <button
                                className='theia-button secondary'
                                style={{ padding: '4px 8px', fontSize: '0.85em' }}
                                disabled={this.previewServerBusy}
                                onClick={() => void this.stopPreviewServer()}
                            >
                                停止
                            </button>
                        </div>
                    </>
                )}
                {status.phase === 'failed' && (
                    <>
                        <div style={{ fontSize: '0.85em' }}>ブラウザプレビューを起動できませんでした</div>
                        {status.failureSummary && (
                            <pre style={{
                                fontSize: '0.8em', whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                                margin: '6px 0 0', opacity: 0.85, maxHeight: '120px', overflow: 'auto'
                            }}>{status.failureSummary}</pre>
                        )}
                        <button
                            className='theia-button secondary'
                            style={{ marginTop: '6px', padding: '4px 8px', fontSize: '0.85em' }}
                            disabled={this.previewServerBusy}
                            onClick={() => void this.startPreviewServer()}
                        >
                            再試行
                        </button>
                    </>
                )}
            </div>
        );
    }

    protected renderExportSection(): React.ReactNode {
        const status = this.exportSession.snapshot.status;
        const running = status.phase === 'linting' || status.phase === 'rendering';
        const visible = running || status.phase === 'done' || status.phase === 'failed' || status.phase === 'lint-failed';
        const percent = status.progressPercent ?? 0;
        const stage = quickExportStageLabel(status.progressStage);
        const label = running
            ? `${stage ?? (status.phase === 'linting' ? 'lint 確認中' : '準備')} · ${percent}%`
            : status.phase === 'done'
                ? '書き出し完了'
                : status.phase === 'lint-failed' ? 'lint NG' : '書き出し失敗';
        return (
            <section style={{ marginBottom: '22px' }}>
                <h3 style={{ margin: '0 0 8px', fontSize: '0.85em', opacity: 0.6, letterSpacing: '0.05em' }}>書き出し</h3>
                <button
                    className='theia-button secondary'
                    style={{ display: 'flex', alignItems: 'center', gap: '10px', justifyContent: 'flex-start', padding: '8px 10px', width: '100%' }}
                    disabled={!this.editJsonExists}
                    title={!this.editJsonExists ? EDIT_JSON_MISSING_TOOLTIP : undefined}
                    onClick={() => void this.openExportDialog()}
                >
                    <span className='codicon codicon-desktop-download' aria-hidden='true' />
                    <span>書き出し…</span>
                </button>
                {!this.editJsonExists && (
                    <p style={{ opacity: 0.6, fontSize: '0.85em', margin: '6px 0 0' }}>{EDIT_JSON_MISSING_TOOLTIP}</p>
                )}
                {visible && (
                    <div data-akari-export-mini-status={status.phase} style={{ marginTop: '8px', border: '1px solid var(--theia-widget-border)', borderRadius: '6px', padding: '7px 9px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.82em' }}>
                            <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
                            <button className='theia-button secondary' style={{ marginLeft: 'auto', padding: '2px 7px', fontSize: '0.82em' }} onClick={() => void this.openExportDialog()}>開く</button>
                        </div>
                        {running && (
                            <div style={{ height: '4px', borderRadius: '2px', background: 'rgba(128,128,128,0.25)', overflow: 'hidden', marginTop: '5px' }}>
                                <div style={{ height: '100%', width: `${percent}%`, background: 'var(--akari-accent, #f97316)', transition: 'width .2s linear' }} />
                            </div>
                        )}
                    </div>
                )}
            </section>
        );
    }

    protected override render(): React.ReactNode {
        return (
            <div style={{ padding: '14px', overflow: 'auto', height: '100%', boxSizing: 'border-box' }}>
                <section style={{ marginBottom: '22px' }}>
                    <h3 style={{ margin: '0 0 8px', fontSize: '0.85em', opacity: 0.6, letterSpacing: '0.05em' }}>ひらく</h3>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        {this.actions.map(action => (
                            <button
                                key={action.id}
                                className='theia-button secondary'
                                style={{ display: 'flex', alignItems: 'center', gap: '10px', justifyContent: 'flex-start', padding: '8px 10px' }}
                                disabled={action.disabled}
                                title={action.title}
                                onClick={action.run}
                            >
                                <span className={action.icon} aria-hidden='true' />
                                <span>{action.label}</span>
                            </button>
                        ))}
                    </div>
                    {this.renderPreviewServerStatus()}
                </section>
                {this.renderExportSection()}
                <section>
                    <h3 style={{ margin: '0 0 8px', fontSize: '0.85em', opacity: 0.6, letterSpacing: '0.05em' }}>やらせる（スキル）</h3>
                    {this.skillsNotice && <p style={{ opacity: 0.7, margin: '0 0 8px' }}>{this.skillsNotice}</p>}
                    {this.skills.length > 0 && (
                        <>
                            <p style={{ opacity: 0.6, fontSize: '0.85em', margin: '0 0 10px' }}>
                                パートナーペインでスキル名を伝えると実行を依頼できます。
                            </p>
                            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                {this.skills.map(skill => (
                                    <li key={skill.name} style={{
                                        border: '1px solid var(--theia-widget-border)', borderRadius: '6px', padding: '8px 10px'
                                    }}>
                                        <div style={{ fontWeight: 600 }}>{skill.name}</div>
                                        <div style={{ opacity: 0.75, fontSize: '0.85em', marginTop: '4px' }}>{skill.description}</div>
                                    </li>
                                ))}
                            </ul>
                        </>
                    )}
                </section>
            </div>
        );
    }
}
