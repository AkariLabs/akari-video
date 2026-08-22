import * as React from '@theia/core/shared/react';
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { Message } from '@theia/core/shared/@lumino/messaging';
import { CommandService, Disposable, DisposableCollection, MessageService } from '@theia/core/lib/common';
import { ApplicationShell, OpenerService, QuickInputService, WidgetManager, open } from '@theia/core/lib/browser';
import URI from '@theia/core/lib/common/uri';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { FileStat } from '@theia/filesystem/lib/common/files';
import { FileDialogService } from '@theia/filesystem/lib/browser';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import {
    DEFAULT_EXPORT_OUTPUT_NAME,
    EXPORT_RESOLUTION_PRESETS,
    composeExportRequestPacket
} from '../common/export-request-packet';
import { RenderProgressState, parseRenderProgress, RENDER_PROGRESS_UNKNOWN_LABEL } from '../common/render-progress';
import { AkariQuickExportService, QuickExportStartOutcome, QuickExportStatus } from '../common/quick-export-protocol';
import {
    describeUnexpectedQuickExportFailure,
    QUICK_EXPORT_OUTPUT_DIRECTORY,
    QuickExportEncoder,
    QuickExportQuality
} from '../common/quick-export-cli';
import { quickExportErrorNotification, shouldShowRenderJsonProgress } from '../common/quick-export-ui';

interface MenuAction {
    id: string;
    label: string;
    icon: string;
    run: () => void;
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

// パートナー拡張の公開コマンド ID とミラー（extension 間の npm 依存を作らない。
// akari-partner-command-contribution.ts の AkariPartnerCommands.INJECT_PROMPT と同一。
// akari-role-buckets-widget.tsx の PARTNER_INJECT_PROMPT_COMMAND_ID と同じミラー方式）。
// 未接続時の日本語トーストは INJECT_PROMPT コマンド自身が出す（本ウィジェットでは複製しない）。
const PARTNER_INJECT_PROMPT_COMMAND_ID = 'akari.partner.injectPrompt';

const EDIT_JSON_RELATIVE_PATH = 'edit.json';
const RENDER_JSON_RELATIVE_PATH = '.akari/render.json';
const EDIT_JSON_MISSING_TOOLTIP = 'edit.json がまだありません。編集を進めてから書き出してください。';
const QUICK_EXPORT_RUNNING_TOOLTIP = '書き出しを実行中です。完了までお待ちください。';
const QUICK_EXPORT_POLL_INTERVAL_MS = 500;
/** render-cut CLI に解像度を渡す引数は存在しない（出力解像度は edit.json の
 *  output.width/height 由来 — packages/render-cut/src/plan.mjs 参照）。
 *  「この場で書き出す」では正直にこの設定を使わないことを利用者に明示する
 *  （task 2026-07-25-export-options #4: 表現を「解像度は edit.json の出力設定に
 *  従います」へ整えた）。 */
const QUICK_EXPORT_RESOLUTION_NOTE = '解像度は edit.json の出力設定に従います（このプリセットはこの実行方法には反映されません）。';

const QUICK_EXPORT_QUALITY_CHOICES: Array<{ label: string; value: QuickExportQuality }> = [
    { label: '標準（standard・既定）', value: 'standard' },
    { label: '高画質（high・crf 18 相当）', value: 'high' },
    { label: '軽量（light・crf 26 相当）', value: 'light' }
];

const QUICK_EXPORT_ENCODER_CHOICES: Array<{ label: string; value: QuickExportEncoder }> = [
    { label: '自動（既定・ハードウェアが使えれば優先）', value: 'auto' },
    { label: 'ハードウェア（VideoToolbox）', value: 'videotoolbox' },
    { label: 'ソフトウェア（x264）', value: 'x264' }
];

const QUICK_EXPORT_FPS_CHOICES: Array<{ label: string; value: number | undefined }> = [
    { label: 'そのまま（既定・編集設定に従う）', value: undefined },
    { label: '24fps', value: 24 },
    { label: '30fps', value: 30 },
    { label: '60fps', value: 60 }
];

/**
 * アクティビティバー5番目のアイコン「メニュー」。
 *
 * - 「ひらく」: よく使う画面をワンクリックで開く（CommandService 経由。
 *   俯瞰だけは専用コマンドが無いため WidgetManager + ApplicationShell で
 *   直接 shell へ再アタッチする）。
 * - 「やらせる（スキル）」: 開いているプロジェクトの `.claude/skills/<name>/SKILL.md`
 *   の frontmatter（name / description）を列挙する v0 実装。ワンクリック実行は
 *   スコープ外 — パートナーペインでの依頼を促す文言のみ添える。
 * - 「書き出し」: ワンクリック書き出し（輸入リスト③・2026-07-25 両モード制へ
 *   改訂）。設定 3 項目（解像度プリセット / 出力ファイル名 / lint 再実行）+
 *   4 項目目「実行方法」を quick-pick 連鎖で確定させる。「エージェントに
 *   任せる」は依頼パケットを `akari.partner.injectPrompt`（ID 文字列呼び出し。
 *   ④と同じ疎結合規律）へ注入するのみ（実行はしない）。「この場で書き出す」
 *   は akari-shell-strip 自身のバックエンド（AkariQuickExportService）が
 *   edit-lint / render-cut CLI を直接子プロセス実行する（宣言済み入力で走る
 *   決定論的 CLI の直接実行と進捗表示は汎用基盤に含む、という裁定改訂に基づく）。
 *   進捗は `.akari/render.json` を読むだけの既存面（書き込みはしない・
 *   render-cut 側は無改造）と、直接実行専用の自前ステータス面が並存する。
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
    @inject(QuickInputService)
    protected readonly quickInputService!: QuickInputService;
    @inject(OpenerService)
    protected readonly openers!: OpenerService;
    @inject(AkariQuickExportService)
    protected readonly quickExportService!: AkariQuickExportService;
    @inject(FileDialogService)
    protected readonly fileDialogs!: FileDialogService;
    @inject(MessageService)
    protected readonly messages!: MessageService;

    protected skills: SkillEntry[] = [];
    protected skillsNotice = '';
    protected editJsonExists = false;
    protected renderProgress: RenderProgressState | undefined;
    protected editJsonWatch = new DisposableCollection();
    protected renderProgressWatch = new DisposableCollection();
    protected quickExportRunning = false;
    protected quickExportStatus: QuickExportStatus | undefined;
    protected quickExportPollHandle: number | undefined;
    /** 同じ終端失敗をポーリングのたびに通知しないためのガード。 */
    protected quickExportFailureNotified = false;
    /** 「ログを表示」の開閉状態（task 2026-07-25-export-options #5）。 */
    protected quickExportLogExpanded = false;

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
            void this.watchRenderProgress();
        }));
        this.toDispose.push(Disposable.create(() => this.stopQuickExportPolling()));
        void this.loadSkills();
        void this.watchEditJson();
        void this.watchRenderProgress();
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
            { id: SHOW_CHANGES_COMMAND, label: '変更を見る', icon: 'codicon codicon-diff', run: () => this.runCommand(SHOW_CHANGES_COMMAND) }
        ];
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
            this.editJsonExists = false;
            this.update();
            return;
        }
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

    /**
     * 設定 3 項目（解像度プリセット・出力ファイル名・lint 再実行）+ 4 項目目
     * 「実行方法」（この場で書き出す／エージェントに任せる）を quick-pick 連鎖で
     * 確定させる。「エージェントに任せる」は既存どおり依頼パケットを
     * `akari.partner.injectPrompt` へ ID 文字列呼び出しで注入する（無改造）。
     * 「この場で書き出す」は akari-shell-strip 自身のバックエンド
     * （AkariQuickExportService）が edit-lint / render-cut CLI を直接実行する
     * （オーナー裁定 2026-07-25 — 両モード制）。途中でキャンセルした場合は
     * 何もしない（askAgent と同じ規律）。パートナー未接続時のトーストは
     * INJECT_PROMPT コマンド自身が出す。
     */
    protected async startExportFlow(): Promise<void> {
        if (!this.editJsonExists || this.quickExportRunning) {
            return;
        }
        const resolution = await this.quickInputService.showQuickPick(
            EXPORT_RESOLUTION_PRESETS.map(preset => ({ label: preset.label, preset })),
            { placeholder: '解像度プリセットを選択' }
        );
        if (!resolution) {
            return;
        }
        const outputNameInput = await this.quickInputService.input({
            placeHolder: '出力ファイル名',
            value: DEFAULT_EXPORT_OUTPUT_NAME
        });
        if (outputNameInput === undefined) {
            return;
        }
        const outputName = outputNameInput.trim() || DEFAULT_EXPORT_OUTPUT_NAME;
        const lintChoice = await this.quickInputService.showQuickPick(
            [
                { label: 'lint を先に再実行する（既定）', rerunLint: true },
                { label: 'lint を再実行しない', rerunLint: false }
            ],
            { placeholder: 'lint を先に再実行しますか' }
        );
        if (!lintChoice) {
            return;
        }
        // 画質・エンジン・fps・出力先（task 2026-07-25-export-options #4）。
        // 「エージェントに任せる」を選んだ場合は使わない（既存の依頼パケットは無改造のまま）。
        const qualityChoice = await this.quickInputService.showQuickPick(
            QUICK_EXPORT_QUALITY_CHOICES,
            { placeholder: '画質を選択' }
        );
        if (!qualityChoice) {
            return;
        }
        const encoderChoice = await this.quickInputService.showQuickPick(
            QUICK_EXPORT_ENCODER_CHOICES,
            { placeholder: 'エンコーダ（自動/ハードウェア/ソフトウェア）を選択' }
        );
        if (!encoderChoice) {
            return;
        }
        const fpsChoice = await this.quickInputService.showQuickPick(
            QUICK_EXPORT_FPS_CHOICES,
            { placeholder: 'フレームレートを選択' }
        );
        if (!fpsChoice) {
            return;
        }
        const outputDestinationChoice = await this.quickInputService.showQuickPick(
            [
                { label: `既定（${QUICK_EXPORT_OUTPUT_DIRECTORY}/ 直下）`, choice: 'default' as const },
                { label: 'フォルダを選ぶ…', choice: 'choose' as const }
            ],
            { placeholder: '出力先を選択' }
        );
        if (!outputDestinationChoice) {
            return;
        }
        let outputDirectoryUri: string | undefined;
        if (outputDestinationChoice.choice === 'choose') {
            const destination = await this.fileDialogs.showOpenDialog({
                title: '書き出し先フォルダを選ぶ',
                canSelectFiles: false,
                canSelectFolders: true
            });
            if (!destination) {
                return;
            }
            outputDirectoryUri = destination.toString();
        }
        const executionMethod = await this.quickInputService.showQuickPick(
            [
                { label: 'この場で書き出す（推奨）', mode: 'local' as const },
                { label: 'エージェントに任せる', mode: 'agent' as const }
            ],
            { placeholder: '実行方法を選択' }
        );
        if (!executionMethod) {
            return;
        }
        if (executionMethod.mode === 'agent') {
            const packet = composeExportRequestPacket({
                resolutionLabel: resolution.preset.label,
                outputName,
                rerunLint: lintChoice.rerunLint
            });
            await this.commands.executeCommand(PARTNER_INJECT_PROMPT_COMMAND_ID, packet);
            return;
        }
        await this.startLocalQuickExport({
            outputName,
            rerunLint: lintChoice.rerunLint,
            quality: qualityChoice.value,
            encoder: encoderChoice.value,
            fps: fpsChoice.value,
            outputDirectoryUri
        });
    }

    // --- 「この場で書き出す」バックエンド呼び出し（edit-lint / render-cut CLI 直接実行） ----

    protected async startLocalQuickExport(settings: {
        outputName: string;
        rerunLint: boolean;
        quality: QuickExportQuality;
        encoder: QuickExportEncoder;
        fps: number | undefined;
        outputDirectoryUri: string | undefined;
    }): Promise<void> {
        if (this.quickExportRunning) {
            return;
        }
        this.quickExportFailureNotified = false;
        let roots: FileStat[];
        try {
            roots = await this.workspace.roots;
        } catch (error) {
            this.failLocalQuickExport(describeUnexpectedQuickExportFailure(error, 'プロジェクトルートを取得できませんでした'));
            return;
        }
        const root = roots[0]?.resource;
        if (!root) {
            this.failLocalQuickExport('プロジェクトルートを取得できないため、書き出しを開始できませんでした');
            return;
        }
        let outcome: QuickExportStartOutcome;
        try {
            outcome = await this.quickExportService.start({
                projectRootUri: root.toString(),
                outputName: settings.outputName,
                rerunLint: settings.rerunLint,
                quality: settings.quality,
                encoder: settings.encoder,
                fps: settings.fps,
                outputDirectoryUri: settings.outputDirectoryUri
            });
        } catch (error) {
            this.failLocalQuickExport(describeUnexpectedQuickExportFailure(error, '書き出しサービスに接続できませんでした'));
            return;
        }
        if (!outcome.accepted) {
            this.failLocalQuickExport('別の書き出しが実行中のため、開始できませんでした');
            return;
        }
        this.quickExportRunning = true;
        // start() は backend 側 status を先に linting/rendering へ進めてから accepted を返す。
        // 最初の poll を待たず同じ phase を置き、前回 render.json の完了表示を即座に隠す。
        this.quickExportStatus = {
            phase: settings.rerunLint ? 'linting' : 'rendering',
            logTail: ''
        };
        this.quickExportLogExpanded = false;
        this.quickExportFailureNotified = false;
        this.update();
        this.beginQuickExportPolling();
    }

    protected beginQuickExportPolling(): void {
        this.stopQuickExportPolling();
        this.quickExportPollHandle = window.setInterval(() => void this.pollQuickExportStatus(), QUICK_EXPORT_POLL_INTERVAL_MS);
        void this.pollQuickExportStatus();
    }

    protected stopQuickExportPolling(): void {
        if (this.quickExportPollHandle !== undefined) {
            window.clearInterval(this.quickExportPollHandle);
            this.quickExportPollHandle = undefined;
        }
    }

    protected async pollQuickExportStatus(): Promise<void> {
        let status: QuickExportStatus;
        try {
            status = await this.quickExportService.getStatus();
        } catch (error) {
            this.failLocalQuickExport(describeUnexpectedQuickExportFailure(error, '書き出しの進捗を取得できませんでした'));
            return;
        }
        this.quickExportStatus = status;
        if (status.phase === 'done' || status.phase === 'failed' || status.phase === 'lint-failed') {
            this.quickExportRunning = false;
            this.stopQuickExportPolling();
        }
        this.notifyQuickExportError(status);
        this.update();
    }

    protected notifyQuickExportError(status: QuickExportStatus): void {
        const notification = quickExportErrorNotification(status, this.quickExportFailureNotified);
        if (notification !== undefined) {
            this.quickExportFailureNotified = true;
            void this.messages.error(notification);
        }
    }

    /** RPC 失敗など status を取れない経路も必ず終端状態 + 通知にする。 */
    protected failLocalQuickExport(failureSummary: string): void {
        this.quickExportRunning = false;
        this.stopQuickExportPolling();
        this.quickExportStatus = { phase: 'failed', logTail: '', failureSummary };
        this.notifyQuickExportError(this.quickExportStatus);
        this.update();
    }

    protected quickExportPhaseLabel(status: QuickExportStatus): string {
        switch (status.phase) {
            case 'linting': return 'lint 確認中…';
            case 'lint-failed': return 'lint NG — 書き出しを中断しました';
            case 'rendering': return 'この場で書き出し中…';
            case 'done': return 'この場での書き出しが完了しました';
            case 'failed': return 'この場での書き出しに失敗しました';
            default: return '';
        }
    }

    // --- 進捗面（.akari/render.json 読み取り専用） ----------------------------

    protected async watchRenderProgress(): Promise<void> {
        this.renderProgressWatch.dispose();
        this.renderProgressWatch = new DisposableCollection();
        const roots = await this.workspace.roots;
        const root = roots[0]?.resource;
        if (!root) {
            this.renderProgress = undefined;
            this.update();
            return;
        }
        const renderJsonUri = root.resolve(RENDER_JSON_RELATIVE_PATH);
        await this.refreshRenderProgress(renderJsonUri);
        try {
            this.renderProgressWatch.push(await this.files.watch(renderJsonUri.parent));
        } catch (error) {
            console.info('[akari-shell-strip] render.json watch unavailable:', error);
        }
        this.renderProgressWatch.push(this.files.onDidFilesChange(event => {
            if (event.contains(renderJsonUri)) {
                void this.refreshRenderProgress(renderJsonUri);
            }
        }));
    }

    /**
     * render.json の読み取り + パースを丸ごと try/catch する（寛容リーダー）。
     * ファイル自体が無ければ進捗面を出さない（undefined）。存在するが壊れた
     * JSON / 未知の形は parseRenderProgress 側で 'unknown' フォールバックへ
     * 倒す — ここでは例外を外に漏らさないことだけを担保する。
     */
    protected async refreshRenderProgress(renderJsonUri: URI): Promise<void> {
        let exists: boolean;
        try {
            exists = await this.files.exists(renderJsonUri);
        } catch {
            exists = false;
        }
        if (!exists) {
            this.renderProgress = undefined;
            this.update();
            return;
        }
        try {
            const content = await this.files.readFile(renderJsonUri);
            const parsed: unknown = JSON.parse(content.value.toString());
            this.renderProgress = parseRenderProgress(parsed);
        } catch (error) {
            console.info('[akari-shell-strip] render.json unreadable — showing fallback:', error);
            this.renderProgress = { kind: 'unknown', label: RENDER_PROGRESS_UNKNOWN_LABEL };
        }
        this.update();
    }

    protected async openExportedArtifact(artifactPath: string): Promise<void> {
        const roots = await this.workspace.roots;
        const root = roots[0]?.resource;
        if (!root) {
            return;
        }
        try {
            await open(this.openers, root.resolve(artifactPath));
        } catch (error) {
            console.warn('[akari-shell-strip] failed to open exported artifact:', error);
        }
    }

    protected renderProgressPercent(progress: RenderProgressState): number {
        switch (progress.kind) {
            case 'in-progress': return progress.percent;
            case 'done': return progress.percent;
            case 'failed': return 100;
            case 'unknown': return 0;
            default: return 0;
        }
    }

    protected renderProgressBarColor(progress: RenderProgressState): string {
        if (progress.kind === 'failed') {
            return 'var(--theia-errorForeground, #f85149)';
        }
        if (progress.kind === 'done') {
            return 'var(--theia-focusBorder, #3fb950)';
        }
        return 'var(--theia-focusBorder, #3794ff)';
    }

    /** ms を mm:ss 表示に整える（1時間を超える見込みは無い工程なので h は出さない）。 */
    protected formatQuickExportClock(ms: number): string {
        const totalSeconds = Math.max(0, Math.round(ms / 1000));
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }

    protected toggleQuickExportLog(): void {
        this.quickExportLogExpanded = !this.quickExportLogExpanded;
        this.update();
    }

    protected renderQuickExportStatus(): React.ReactNode {
        const status = this.quickExportStatus;
        if (!status || status.phase === 'idle') {
            return undefined;
        }
        const running = status.phase === 'linting' || status.phase === 'rendering';
        const failed = status.phase === 'failed' || status.phase === 'lint-failed';
        // render-cut の --progress 由来（task 2026-07-25-export-options #5）: rendering フェーズで
        // 最初の PROGRESS 行が届くまでは percent が undefined のまま — その間は不確定バーのまま。
        const hasDetailedProgress = status.phase === 'rendering' && status.progressPercent !== undefined;
        return (
            <div style={{ marginTop: '10px', border: '1px solid var(--theia-widget-border)', borderRadius: '6px', padding: '8px 10px' }}>
                <style>{`
                    @keyframes akariQuickExportIndeterminate {
                        0% { left: -40%; }
                        100% { left: 100%; }
                    }
                `}</style>
                <div style={{ fontSize: '0.85em', marginBottom: '4px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>{this.quickExportPhaseLabel(status)}{hasDetailedProgress && `（${status.progressPercent}%）`}</span>
                    {status.lintIssueCount !== undefined && (
                        <span style={{
                            padding: '1px 7px', borderRadius: '10px', fontSize: '0.85em',
                            background: 'var(--theia-errorForeground, #f85149)', color: '#fff'
                        }}>
                            lint {status.lintIssueCount} 件
                        </span>
                    )}
                </div>
                <p style={{ opacity: 0.55, fontSize: '0.8em', margin: '0 0 6px' }}>{QUICK_EXPORT_RESOLUTION_NOTE}</p>
                {hasDetailedProgress ? (
                    <>
                        <div style={{ height: '6px', borderRadius: '3px', background: 'rgba(128,128,128,0.25)', overflow: 'hidden' }}>
                            <div style={{
                                height: '100%',
                                width: `${status.progressPercent}%`,
                                background: 'var(--theia-focusBorder, #3794ff)',
                                transition: 'width 0.2s ease'
                            }} />
                        </div>
                        <div style={{ fontSize: '0.78em', opacity: 0.65, marginTop: '3px', display: 'flex', justifyContent: 'space-between' }}>
                            <span>経過 {this.formatQuickExportClock(status.progressElapsedMs ?? 0)}</span>
                            <span>
                                {status.progressRemainingMs !== undefined
                                    ? `残り約 ${this.formatQuickExportClock(status.progressRemainingMs)}`
                                    : '残り時間を計算中…'}
                            </span>
                        </div>
                    </>
                ) : running && (
                    <div style={{ height: '6px', borderRadius: '3px', background: 'rgba(128,128,128,0.25)', overflow: 'hidden', position: 'relative' }}>
                        <div style={{
                            position: 'absolute', top: 0, height: '100%', width: '40%',
                            background: 'var(--theia-focusBorder, #3794ff)',
                            animation: 'akariQuickExportIndeterminate 1.1s ease-in-out infinite'
                        }} />
                    </div>
                )}
                {status.logTail && (
                    <div style={{ marginTop: '6px' }}>
                        <button
                            className='theia-button secondary'
                            style={{ padding: '2px 8px', fontSize: '0.78em' }}
                            onClick={() => this.toggleQuickExportLog()}
                        >
                            {this.quickExportLogExpanded ? 'ログを隠す' : 'ログを表示'}
                        </button>
                        {this.quickExportLogExpanded && (
                            <pre style={{
                                fontSize: '0.75em', whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                                margin: '6px 0 0', opacity: 0.8, maxHeight: '160px', overflow: 'auto',
                                background: 'rgba(128,128,128,0.08)', padding: '6px', borderRadius: '4px'
                            }}>{status.logTail}</pre>
                        )}
                    </div>
                )}
                {status.phase === 'done' && status.artifactPath && (
                    <div style={{ display: 'flex', gap: '8px', marginTop: '6px', flexWrap: 'wrap' }}>
                        <button
                            className='theia-button secondary'
                            style={{ padding: '4px 8px', fontSize: '0.85em' }}
                            onClick={() => void this.openExportedArtifact(status.artifactPath!)}
                        >
                            成果物を開く（{status.artifactPath}）
                        </button>
                        {status.reportPath && (
                            <button
                                className='theia-button secondary'
                                style={{ padding: '4px 8px', fontSize: '0.85em' }}
                                onClick={() => void this.openExportedArtifact(status.reportPath!)}
                            >
                                レポートを開く
                            </button>
                        )}
                    </div>
                )}
                {status.phase === 'lint-failed' && status.reportPath && (
                    <button
                        className='theia-button secondary'
                        style={{ marginTop: '6px', padding: '4px 8px', fontSize: '0.85em' }}
                        onClick={() => void this.openExportedArtifact(status.reportPath!)}
                    >
                        lint レポートを開く
                    </button>
                )}
                {failed && status.failureSummary && (
                    <pre style={{
                        fontSize: '0.8em', whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                        margin: '6px 0 0', opacity: 0.85, maxHeight: '120px', overflow: 'auto'
                    }}>{status.failureSummary}</pre>
                )}
            </div>
        );
    }

    protected renderExportSection(): React.ReactNode {
        const progress = shouldShowRenderJsonProgress(this.quickExportStatus?.phase)
            ? this.renderProgress
            : undefined;
        return (
            <section style={{ marginBottom: '22px' }}>
                <h3 style={{ margin: '0 0 8px', fontSize: '0.85em', opacity: 0.6, letterSpacing: '0.05em' }}>書き出し</h3>
                <button
                    className='theia-button secondary'
                    style={{ display: 'flex', alignItems: 'center', gap: '10px', justifyContent: 'flex-start', padding: '8px 10px', width: '100%' }}
                    disabled={!this.editJsonExists || this.quickExportRunning}
                    title={!this.editJsonExists ? EDIT_JSON_MISSING_TOOLTIP : (this.quickExportRunning ? QUICK_EXPORT_RUNNING_TOOLTIP : undefined)}
                    onClick={() => void this.startExportFlow()}
                >
                    <span className='codicon codicon-desktop-download' aria-hidden='true' />
                    <span>書き出し</span>
                </button>
                {!this.editJsonExists && (
                    <p style={{ opacity: 0.6, fontSize: '0.85em', margin: '6px 0 0' }}>{EDIT_JSON_MISSING_TOOLTIP}</p>
                )}
                {this.renderQuickExportStatus()}
                {progress && (
                    <div style={{ marginTop: '10px' }}>
                        <div style={{ fontSize: '0.85em', marginBottom: '4px' }}>
                            {progress.label}
                            {(progress.kind === 'in-progress' || progress.kind === 'done') && `（${this.renderProgressPercent(progress)}%）`}
                        </div>
                        <div style={{ height: '6px', borderRadius: '3px', background: 'rgba(128,128,128,0.25)', overflow: 'hidden' }}>
                            <div style={{
                                height: '100%',
                                width: `${this.renderProgressPercent(progress)}%`,
                                background: this.renderProgressBarColor(progress),
                                transition: 'width 0.2s ease'
                            }} />
                        </div>
                        {progress.kind === 'done' && (
                            <button
                                className='theia-button secondary'
                                style={{ marginTop: '8px', padding: '4px 8px', fontSize: '0.85em' }}
                                onClick={() => void this.openExportedArtifact(progress.artifactPath)}
                            >
                                成果物を開く（{progress.artifactPath}）
                            </button>
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
                                onClick={action.run}
                            >
                                <span className={action.icon} aria-hidden='true' />
                                <span>{action.label}</span>
                            </button>
                        ))}
                    </div>
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
