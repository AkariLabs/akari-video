import * as React from '@theia/core/shared/react';
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { Message } from '@theia/core/shared/@lumino/messaging';
import { CommandService, Disposable, DisposableCollection, MessageService } from '@theia/core/lib/common';
import { ApplicationShell, OpenerService, QuickInputService, WidgetManager, open } from '@theia/core/lib/browser';
import URI from '@theia/core/lib/common/uri';
import { OS } from '@theia/core/lib/common/os';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { FileOperationResult, FileStat, toFileOperationResult } from '@theia/filesystem/lib/common/files';
import { FileDialogService } from '@theia/filesystem/lib/browser';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { WindowService } from '@theia/core/lib/browser/window/window-service';
import { PreferenceScope, PreferenceService } from '@theia/core/lib/common/preferences';
import {
    DEFAULT_EXPORT_OUTPUT_NAME,
    composeExportRequestPacket
} from '../common/export-request-packet';
import { RenderProgressState, parseRenderProgress, RENDER_PROGRESS_UNKNOWN_LABEL } from '../common/render-progress';
import { AkariQuickExportService, QuickExportStartOutcome, QuickExportStatus } from '../common/quick-export-protocol';
import {
    buildQuickExportEncoderChoices,
    describeUnexpectedQuickExportFailure,
    nextAvailableOutputName,
    QUICK_EXPORT_OUTPUT_DIRECTORY,
    QuickExportEncoder,
    QuickExportQuality
} from '../common/quick-export-cli';
import { quickExportErrorNotification, shouldShowRenderJsonProgress } from '../common/quick-export-ui';
import { AkariPreviewServerService, PreviewServerStatus } from '../common/preview-server-protocol';
import { buildPreviewOpenUrl, PreviewOpenVariant } from '../common/preview-server-cli';
import {
    AKARI_EXPORT_ENCODER,
    AKARI_EXPORT_FPS,
    AKARI_EXPORT_OUTPUT_DIRECTORY,
    AKARI_EXPORT_QUALITY
} from './akari-export-preferences';

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
/** ブラウザプレビュー（preview-server）の状態ポーリング間隔（裁定 1-f: 1,000 ms）。 */
const PREVIEW_SERVER_POLL_INTERVAL_MS = 1000;
const PREVIEW_EDIT_JSON_MISSING_TOOLTIP = 'edit.json がまだありません。編集を進めてからプレビューしてください。';
const PREVIEW_WORKSPACE_MISSING_TOOLTIP = 'プロジェクトを開くとブラウザプレビューを起動できます。';
/** render-cut CLI に解像度を渡す引数は存在しない（出力解像度は edit.json の
 *  output.width/height 由来 — packages/render-cut/src/plan.mjs 参照）。
 *  「この場で書き出す」では正直にこの設定を使わないことを利用者に明示する
 *  （task 2026-07-25-export-options #4: 表現を「解像度は edit.json の出力設定に
 *  従います」へ整えた）。 */
const QUICK_EXPORT_RESOLUTION_NOTE = '解像度は edit.json の出力設定に従います。';

const QUICK_EXPORT_QUALITY_CHOICES: Array<{ label: string; value: QuickExportQuality }> = [
    { label: '標準（standard・既定）', value: 'standard' },
    { label: '高画質（high・crf 18 相当）', value: 'high' },
    { label: '軽量（light・crf 26 相当）', value: 'light' }
];

const QUICK_EXPORT_ENCODER_CHOICES: Array<{ label: string; value: QuickExportEncoder }> =
    buildQuickExportEncoderChoices(OS.type() === OS.Type.OSX ? 'darwin' : OS.type() === OS.Type.Windows ? 'win32' : 'linux');

const QUICK_EXPORT_FPS_CHOICES: Array<{ label: string; value: number | undefined }> = [
    { label: 'そのまま（既定・編集設定に従う）', value: undefined },
    { label: '24fps', value: 24 },
    { label: '30fps', value: 30 },
    { label: '60fps', value: 60 }
];

interface ExportPreferences {
    readonly quality: QuickExportQuality;
    readonly encoder: QuickExportEncoder;
    readonly fps: number | undefined;
    readonly outputDirectoryUri: string | undefined;
}

/**
 * アクティビティバー5番目のアイコン「メニュー」。
 *
 * - 「ひらく」: よく使う画面をワンクリックで開く（CommandService 経由。
 *   俯瞰だけは専用コマンドが無いため WidgetManager + ApplicationShell で
 *   直接 shell へ再アタッチする）。
 * - 「やらせる（スキル）」: 開いているプロジェクトの `.claude/skills/<name>/SKILL.md`
 *   の frontmatter（name / description）を列挙する v0 実装。ワンクリック実行は
 *   スコープ外 — パートナーペインでの依頼を促す文言のみ添える。
 * - 「書き出し」: 保存済み設定で質問せずローカル書き出しを開始する。
 *   「詳細設定で書き出す…」だけが画質・エンコーダ・fps・出力先・実行方法を
 *   quick-pick で確定させる。「エージェントに
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
    @inject(AkariPreviewServerService)
    protected readonly previewServerService!: AkariPreviewServerService;
    @inject(WindowService)
    protected readonly windowService!: WindowService;
    @inject(FileDialogService)
    protected readonly fileDialogs!: FileDialogService;
    @inject(MessageService)
    protected readonly messages!: MessageService;
    @inject(PreferenceService)
    protected readonly preferences!: PreferenceService;

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
    /** 同じ成果物の engine fallback / 不適格警告を一度だけ通知するための署名。 */
    protected readonly renderEngineWarningSignatures = new Set<string>();
    /** 「ログを表示」の開閉状態（task 2026-07-25-export-options #5）。 */
    protected quickExportLogExpanded = false;
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
            void this.watchRenderProgress();
            void this.resetPreviewServerOnWorkspaceChange();
        }));
        this.toDispose.push(Disposable.create(() => this.stopQuickExportPolling()));
        // widget dispose ではポーリングだけ止める（サーバーは止めない —
        // メニューを閉じても生かす。裁定 1-f）。
        this.toDispose.push(Disposable.create(() => this.stopPreviewServerPolling()));
        void this.loadSkills();
        void this.watchEditJson();
        void this.watchRenderProgress();
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

    /** 主ボタンは質問を出さず、保存済み設定と安全な固定値で直ちに開始する。 */
    protected async startExportFlow(): Promise<void> {
        if (!this.editJsonExists || this.quickExportRunning) {
            return;
        }
        const settings = this.readExportPreferences();
        await this.startLocalQuickExport({
            outputName: DEFAULT_EXPORT_OUTPUT_NAME,
            rerunLint: true,
            ...settings
        });
    }

    /** 画質・エンコーダ・fps・出力先・実行方法だけを選ぶ詳細導線。 */
    protected async startDetailedExportFlow(): Promise<void> {
        if (!this.editJsonExists || this.quickExportRunning) {
            return;
        }
        const current = this.readExportPreferences();
        const qualityItems = QUICK_EXPORT_QUALITY_CHOICES.map(choice => ({ ...choice }));
        const qualityChoice = await this.quickInputService.showQuickPick(
            qualityItems,
            {
                placeholder: '画質を選択',
                activeItem: qualityItems.find(choice => choice.value === current.quality)
            }
        );
        if (!qualityChoice) {
            return;
        }
        const encoderItems = QUICK_EXPORT_ENCODER_CHOICES.map(choice => ({ ...choice }));
        const encoderChoice = await this.quickInputService.showQuickPick(
            encoderItems,
            {
                placeholder: 'エンコーダ（自動/ハードウェア/ソフトウェア）を選択',
                activeItem: encoderItems.find(choice => choice.value === current.encoder)
            }
        );
        if (!encoderChoice) {
            return;
        }
        const fpsItems = QUICK_EXPORT_FPS_CHOICES.map(choice => ({ ...choice }));
        const fpsChoice = await this.quickInputService.showQuickPick(
            fpsItems,
            {
                placeholder: 'フレームレートを選択',
                activeItem: fpsItems.find(choice => choice.value === current.fps)
            }
        );
        if (!fpsChoice) {
            return;
        }
        const outputDestinationItems = [
            ...(current.outputDirectoryUri ? [{
                    label: `現在の既定（${current.outputDirectoryUri}）`,
                    choice: 'current' as const
                }] : []),
            {
                label: `プロジェクトの ${QUICK_EXPORT_OUTPUT_DIRECTORY}/ 直下`,
                choice: 'default' as const
            },
            { label: 'フォルダを選ぶ…', choice: 'choose' as const }
        ];
        const outputDestinationChoice = await this.quickInputService.showQuickPick(
            outputDestinationItems,
            {
                placeholder: '出力先を選択',
                activeItem: outputDestinationItems.find(item => item.choice === (
                    current.outputDirectoryUri ? 'current' : 'default'
                ))
            }
        );
        if (!outputDestinationChoice) {
            return;
        }
        let outputDirectoryUri = outputDestinationChoice.choice === 'current'
            ? current.outputDirectoryUri
            : undefined;
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
        const executionItems = [
            { label: 'この場で書き出す（推奨）', mode: 'local' as const },
            { label: 'エージェントに任せる', mode: 'agent' as const }
        ];
        const executionMethod = await this.quickInputService.showQuickPick(
            executionItems,
            { placeholder: '実行方法を選択', activeItem: executionItems[0] }
        );
        if (!executionMethod) {
            return;
        }
        const saveItems = [
            { label: 'はい、この設定を既定にする', save: true },
            { label: 'いいえ、今回だけ使う', save: false }
        ];
        const saveChoice = await this.quickInputService.showQuickPick(
            saveItems,
            { placeholder: 'この設定を既定にしますか', activeItem: saveItems[1] }
        );
        if (!saveChoice) {
            return;
        }
        const selected: ExportPreferences = {
            quality: qualityChoice.value,
            encoder: encoderChoice.value,
            fps: fpsChoice.value,
            outputDirectoryUri
        };
        if (saveChoice.save) {
            await this.saveExportPreferences(selected);
        }
        if (executionMethod.mode === 'agent') {
            let outputName: string;
            try {
                outputName = await this.chooseAvailableOutputName(DEFAULT_EXPORT_OUTPUT_NAME, outputDirectoryUri);
            } catch (error) {
                void this.messages.error(describeUnexpectedQuickExportFailure(error, '書き出し先を確認できませんでした'));
                return;
            }
            const packet = composeExportRequestPacket({
                resolutionLabel: 'edit.json のまま',
                outputName,
                rerunLint: true
            });
            await this.commands.executeCommand(PARTNER_INJECT_PROMPT_COMMAND_ID, packet);
            return;
        }
        await this.startLocalQuickExport({
            outputName: DEFAULT_EXPORT_OUTPUT_NAME,
            rerunLint: true,
            ...selected
        });
    }

    protected readExportPreferences(): ExportPreferences {
        const quality = this.preferences.get<QuickExportQuality>(AKARI_EXPORT_QUALITY, 'standard');
        const encoder = this.preferences.get<QuickExportEncoder>(AKARI_EXPORT_ENCODER, 'auto');
        const fps = this.preferences.get<number | undefined>(AKARI_EXPORT_FPS);
        const outputDirectory = this.preferences.get<string>(AKARI_EXPORT_OUTPUT_DIRECTORY, '').trim();
        return {
            quality: QUICK_EXPORT_QUALITY_CHOICES.some(choice => choice.value === quality) ? quality : 'standard',
            encoder: QUICK_EXPORT_ENCODER_CHOICES.some(choice => choice.value === encoder) ? encoder : 'auto',
            fps: QUICK_EXPORT_FPS_CHOICES.some(choice => choice.value === fps) ? fps : undefined,
            outputDirectoryUri: outputDirectory || undefined
        };
    }

    protected async saveExportPreferences(settings: ExportPreferences): Promise<void> {
        await this.preferences.set(AKARI_EXPORT_QUALITY, settings.quality, PreferenceScope.User);
        await this.preferences.set(AKARI_EXPORT_ENCODER, settings.encoder, PreferenceScope.User);
        await this.preferences.set(AKARI_EXPORT_FPS, settings.fps, PreferenceScope.User);
        await this.preferences.set(AKARI_EXPORT_OUTPUT_DIRECTORY, settings.outputDirectoryUri ?? '', PreferenceScope.User);
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
        let outputName: string;
        try {
            outputName = await this.chooseAvailableOutputName(settings.outputName, settings.outputDirectoryUri, root);
        } catch (error) {
            this.failLocalQuickExport(describeUnexpectedQuickExportFailure(error, '書き出し先を確認できませんでした'));
            return;
        }
        this.renderProgress = undefined;
        let outcome: QuickExportStartOutcome;
        try {
            outcome = await this.quickExportService.start({
                projectRootUri: root.toString(),
                outputName,
                rerunLint: settings.rerunLint,
                quality: settings.quality,
                engine: 'auto',
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

    protected async chooseAvailableOutputName(
        baseName: string,
        outputDirectoryUri: string | undefined,
        knownRoot?: URI
    ): Promise<string> {
        let root = knownRoot;
        if (!root) {
            const roots = await this.workspace.roots;
            root = roots[0]?.resource;
        }
        if (!root) {
            return nextAvailableOutputName(baseName, []);
        }
        const directory = outputDirectoryUri
            ? new URI(outputDirectoryUri)
            : root.resolve(QUICK_EXPORT_OUTPUT_DIRECTORY);
        let stat: FileStat;
        try {
            stat = await this.files.resolve(directory);
        } catch (error) {
            if (error instanceof Error && toFileOperationResult(error) === FileOperationResult.FILE_NOT_FOUND) {
                return nextAvailableOutputName(baseName, []);
            }
            throw error;
        }
        const existingNames = (stat.children ?? [])
            .filter(child => !child.isDirectory)
            .map(child => child.resource.path.base);
        return nextAvailableOutputName(baseName, existingNames);
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
        if (status.phase === 'done') {
            const roots = await this.workspace.roots;
            const root = roots[0]?.resource;
            if (root) {
                await this.refreshRenderProgress(root.resolve(RENDER_JSON_RELATIVE_PATH));
            }
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
            case 'rendering': return this.renderProgress?.kind === 'in-progress'
                ? this.renderProgress.label
                : 'この場で書き出し中…';
            case 'done': return this.renderProgress?.kind === 'done'
                ? this.renderProgress.label
                : '書き出し完了';
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
            this.notifyRenderEngineWarning(this.renderProgress);
        } catch (error) {
            console.info('[akari-shell-strip] render.json unreadable — showing fallback:', error);
            this.renderProgress = { kind: 'unknown', label: RENDER_PROGRESS_UNKNOWN_LABEL };
        }
        this.update();
    }

    protected notifyRenderEngineWarning(progress: RenderProgressState): void {
        if (progress.kind !== 'done' || !progress.engine
            || (!progress.engine.fallbackReason && !progress.engine.ineligible?.length)) {
            return;
        }
        const signature = `${progress.artifactPath}\n${progress.label}`;
        if (this.renderEngineWarningSignatures.has(signature)) {
            return;
        }
        this.renderEngineWarningSignatures.add(signature);
        if (progress.engine.ineligible?.length) {
            console.info('[akari-shell-strip] gpu ineligible', progress.engine.ineligible);
        }
        void this.messages.warn(progress.label);
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
                <button
                    className='theia-button secondary'
                    style={{ display: 'flex', alignItems: 'center', gap: '10px', justifyContent: 'flex-start', padding: '8px 10px', width: '100%', marginTop: '6px' }}
                    disabled={!this.editJsonExists || this.quickExportRunning}
                    title={!this.editJsonExists ? EDIT_JSON_MISSING_TOOLTIP : (this.quickExportRunning ? QUICK_EXPORT_RUNNING_TOOLTIP : undefined)}
                    onClick={() => void this.startDetailedExportFlow()}
                >
                    <span className='codicon codicon-settings-gear' aria-hidden='true' />
                    <span>詳細設定で書き出す…</span>
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
