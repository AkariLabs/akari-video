import { open, OpenerService, StorageService } from '@theia/core/lib/browser';
import { WindowService } from '@theia/core/lib/browser/window/window-service';
import { FileUri } from '@theia/core/lib/common/file-uri';
import { PreferenceScope, PreferenceService } from '@theia/core/lib/common/preferences';
import URI from '@theia/core/lib/common/uri';
import { CommandService, Disposable, DisposableCollection, Emitter, Event, MessageService } from '@theia/core/lib/common';
import { FileDialogService } from '@theia/filesystem/lib/browser';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { FileOperationResult, FileStat, toFileOperationResult } from '@theia/filesystem/lib/common/files';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import {
    DEFAULT_EXPORT_OUTPUT_NAME,
    composeExportRequestPacket,
    defaultExportOutputNameForCodec
} from '../common/export-request-packet';
import {
    composeExportHandOffPacket,
    EXPORT_SHARE_TARGETS,
    ExportShareTargetId
} from '../common/export-share';
import { estimateExport, ExportLastRun, formatEstimate, FormattedExportEstimate } from '../common/export-estimate';
import { ExportSettings, isMasterSelectable, resolveOutputResolution } from '../common/export-settings';
import { describeThisVideo, ThisVideoDescription } from '../common/export-this-video';
import {
    describeUnexpectedQuickExportFailure,
    nextAvailableOutputName,
    QUICK_EXPORT_OUTPUT_DIRECTORY,
    QuickExportCodec,
    QuickExportEncoder,
    QuickExportQuality
} from '../common/quick-export-cli';
import {
    AkariQuickExportService,
    QuickExportRecheckResult,
    QuickExportStartOutcome,
    QuickExportStatus
} from '../common/quick-export-protocol';
import { shouldRecheckLintForPath, shouldWatchForLintRecheck } from '../common/export-lint-recheck';
import { quickExportErrorNotification } from '../common/quick-export-ui';
import { parseRenderProgress, RenderProgressState } from '../common/render-progress';
import {
    AKARI_EXPORT_CODEC,
    AKARI_EXPORT_ENCODER,
    AKARI_EXPORT_FPS,
    AKARI_EXPORT_OUTPUT_DIRECTORY,
    AKARI_EXPORT_QUALITY
} from './akari-export-preferences';
import {
    formatLintFailureForUi,
    UiLintFinding
} from 'akari-annotations/lib/common/lint-message-ja';

const PARTNER_INJECT_PROMPT_COMMAND_ID = 'akari.partner.injectPrompt';
const LAST_RUN_STORAGE_KEY = 'akari.export.lastRun';
const POLL_INTERVAL_MS = 500;
/** 編集ドキュメントの変更をまとめてから再検査するまでの待ち（保存の連打を 1 本にする）。 */
const LINT_RECHECK_DEBOUNCE_MS = 700;
const CAPTIONS_RELATIVE_PATH = 'captions.json';
const RENDER_JSON_RELATIVE_PATH = '.akari/render.json';

export interface StoredExportLastRun extends ExportLastRun {
    readonly at: string;
}

export interface ExportSessionSnapshot {
    readonly settings: ExportSettings;
    readonly status: QuickExportStatus;
    readonly video: ThisVideoDescription;
    readonly editJson: unknown;
    readonly outputName: string;
    readonly projectLabel: string;
    readonly setupRequested: boolean;
    readonly lastRun?: StoredExportLastRun;
    readonly renderProgress?: RenderProgressState;
    /** lint の再検査が走っている間だけ true（ボタンの二度押し防止と「検査中…」表示）。 */
    readonly lintRechecking: boolean;
}

const DEFAULT_SETTINGS: ExportSettings = {
    quality: 'standard',
    engine: 'auto',
    encoder: 'auto',
    codec: 'h264',
    fps: undefined,
    resolution: 'native',
    customWidth: undefined,
    outputDirectoryUri: undefined,
    rerunLint: true,
    saveAsDefault: false
};

const ENCODERS: readonly QuickExportEncoder[] = [
    'auto', 'videotoolbox', 'nvenc', 'qsv', 'amf', 'mf', 'x264'
];

const QUALITIES: readonly QuickExportQuality[] = ['master', 'high', 'standard', 'light'];
const CODECS: readonly QuickExportCodec[] = ['h264', 'hevc', 'prores422', 'png'];

@injectable()
export class AkariExportSessionService implements Disposable {
    @inject(AkariQuickExportService)
    protected readonly quickExportService!: AkariQuickExportService;
    @inject(WorkspaceService)
    protected readonly workspace!: WorkspaceService;
    @inject(FileService)
    protected readonly files!: FileService;
    @inject(FileDialogService)
    protected readonly fileDialogs!: FileDialogService;
    @inject(PreferenceService)
    protected readonly preferences!: PreferenceService;
    @inject(StorageService)
    protected readonly storage!: StorageService;
    @inject(CommandService)
    protected readonly commands!: CommandService;
    @inject(OpenerService)
    protected readonly openers!: OpenerService;
    @inject(MessageService)
    protected readonly messages!: MessageService;
    @inject(WindowService)
    protected readonly windows!: WindowService;

    protected readonly changeEmitter = new Emitter<void>();
    readonly onDidChange: Event<void> = this.changeEmitter.event;
    protected readonly toDispose = new DisposableCollection(this.changeEmitter);

    protected settings: ExportSettings = DEFAULT_SETTINGS;
    protected status: QuickExportStatus = { phase: 'idle', logTail: '' };
    protected video: ThisVideoDescription = {
        orientation: 'landscape', width: undefined, height: undefined, fps: undefined
    };
    protected editJson: unknown = {};
    protected outputName = DEFAULT_EXPORT_OUTPUT_NAME;
    protected projectLabel = '';
    protected projectRoot: URI | undefined;
    protected lastRun: StoredExportLastRun | undefined;
    protected renderProgress: RenderProgressState | undefined;
    protected setupRequested = false;
    protected pollHandle: number | undefined;
    protected failureNotified = false;
    protected dialogVisible = false;
    protected lintRechecking = false;
    protected lintWatch = new DisposableCollection();
    /** 現在 watch しているプロジェクト（未 watch は undefined）。付け外しの冪等判定に使う。 */
    protected lintWatchRoot: string | undefined;
    protected lintRecheckTimer: number | undefined;

    @postConstruct()
    protected init(): void {
        this.toDispose.push(this.workspace.onWorkspaceChanged(() => void this.refreshProject()));
        this.toDispose.push(this.preferences.onPreferenceChanged(change => {
            if (change.preferenceName.startsWith('akari.export.')) {
                this.updateSettingFromPreference(change.preferenceName);
            }
        }));
        void this.preferences.ready.then(() => {
            this.settings = this.readPreferences();
            this.refreshOutputNameForCodec();
            this.fireChanged();
        });
        void this.refreshProject();
        void this.syncStatus();
    }

    dispose(): void {
        this.stopPolling();
        this.cancelPendingLintRecheck();
        this.lintWatch.dispose();
        this.toDispose.dispose();
    }

    get snapshot(): ExportSessionSnapshot {
        return {
            settings: this.settings,
            status: this.status,
            video: this.video,
            editJson: this.editJson,
            outputName: this.outputName,
            projectLabel: this.projectLabel,
            setupRequested: this.setupRequested,
            lastRun: this.lastRun,
            renderProgress: this.renderProgress,
            lintRechecking: this.lintRechecking
        };
    }

    get running(): boolean {
        return this.status.phase === 'linting' || this.status.phase === 'rendering';
    }

    async prepareCurrentProject(): Promise<void> {
        await this.refreshProject();
        await this.syncStatus();
    }

    /**
     * 書き出しダイアログの表示・非表示（AkariExportDialog の attach / detach）。
     *
     * 出自（2026-09-03 オーナー実機報告）: lint 停止画面はバックエンドが保持している
     * 検査結果をそのまま出すため、パートナーが edit.json を直しても古い所見が残り、
     * 閉じて開き直しても同じ画面が出ていた。開いた瞬間に 1 回検査し直し、
     * 開いている間は編集ドキュメントの変更を見て自動で検査し直す。
     */
    setDialogVisible(visible: boolean): void {
        if (this.dialogVisible === visible) {
            return;
        }
        this.dialogVisible = visible;
        if (visible && this.status.phase === 'lint-failed') {
            void this.recheckLint({ auto: true });
        }
        void this.updateLintWatch();
    }

    /**
     * edit-lint だけを走らせ直して、保持している lint 結果を最新へ差し替える。
     * 書き出しは開始しない（phase も 'linting' にしない）ので、画面は lint 停止のまま更新される。
     */
    async recheckLint(options: { auto?: boolean } = {}): Promise<void> {
        if (this.lintRechecking || this.running || !this.projectRoot) {
            return;
        }
        this.lintRechecking = true;
        this.fireChanged();
        let result: QuickExportRecheckResult | undefined;
        try {
            result = await this.quickExportService.recheckLint({ projectRootUri: this.projectRoot.toString() });
        } catch (error) {
            if (!options.auto) {
                void this.messages.error(
                    describeUnexpectedQuickExportFailure(error, 'lint をもう一度検査できませんでした')
                );
            }
        } finally {
            this.lintRechecking = false;
        }
        if (!result) {
            this.fireChanged();
            return;
        }
        const wasLintFailed = this.status.phase === 'lint-failed';
        // 再検査の結果で通知は出さない（画面がそのまま最新の所見を出しているため、
        // 保存のたびにトーストが積み上がる方が邪魔になる）。
        this.applyStatus(result.status, { notify: false });
        if (result.outcome === 'pass' && wasLintFailed) {
            this.setupRequested = true;
            this.failureNotified = false;
            void this.messages.info('lint の問題は解消しました。そのまま書き出せます');
            this.fireChanged();
            return;
        }
        if (result.outcome === 'unavailable' && !options.auto) {
            void this.messages.warn(result.reason ?? 'lint をもう一度検査できませんでした');
        }
    }

    updateSettings(patch: Partial<ExportSettings>): void {
        const previousCodec = this.settings.codec;
        let next = { ...this.settings, ...patch };
        if (next.quality === 'master' && !isMasterSelectable(next.encoder)) {
            next = { ...next, quality: 'standard' };
        }
        this.settings = next;
        if (next.codec !== previousCodec) {
            this.refreshOutputNameForCodec(next.codec);
        }
        this.fireChanged();
    }

    resetToSetup(): void {
        this.setupRequested = true;
        this.fireChanged();
    }

    estimate(quality: QuickExportQuality = this.settings.quality): FormattedExportEstimate {
        const fps = this.settings.fps ?? this.video.fps ?? 30;
        const frames = Math.max(0, Math.round((this.video.durationSeconds ?? 0) * fps));
        const output = resolveOutputResolution(this.video, this.settings);
        const estimate = estimateExport({
            frames,
            width: output.width,
            height: output.height,
            fps,
            quality,
            encoder: this.settings.encoder,
            engine: this.settings.engine,
            codec: this.settings.codec,
            lastRun: this.lastRun
        });
        return formatEstimate(estimate.seconds, estimate.bytes);
    }

    async chooseOutputDirectory(): Promise<void> {
        const destination = await this.fileDialogs.showOpenDialog({
            title: '書き出し先フォルダを選ぶ',
            canSelectFiles: false,
            canSelectFolders: true
        });
        if (!destination) {
            return;
        }
        this.settings = { ...this.settings, outputDirectoryUri: destination.toString() };
        try {
            this.outputName = await this.chooseAvailableOutputName(defaultExportOutputNameForCodec(this.settings.codec));
        } catch (error) {
            this.fail(describeUnexpectedQuickExportFailure(error, '書き出し先を確認できませんでした'));
            return;
        }
        this.fireChanged();
    }

    async start(overrides: Partial<Pick<ExportSettings, 'rerunLint'>> = {}): Promise<boolean> {
        if (this.running) {
            return false;
        }
        await this.refreshProject();
        if (!this.projectRoot) {
            void this.messages.error('プロジェクトルートを取得できないため、書き出しを開始できませんでした');
            return false;
        }
        const settings = { ...this.settings, ...overrides };
        const output = resolveOutputResolution(this.video, settings);
        if (settings.saveAsDefault) {
            await this.savePreferences(settings);
        }
        try {
            this.outputName = await this.chooseAvailableOutputName(defaultExportOutputNameForCodec(settings.codec));
        } catch (error) {
            this.fail(describeUnexpectedQuickExportFailure(error, '書き出し先を確認できませんでした'));
            return false;
        }
        let outcome: QuickExportStartOutcome;
        try {
            outcome = await this.quickExportService.start({
                projectRootUri: this.projectRoot.toString(),
                outputName: this.outputName,
                rerunLint: settings.rerunLint,
                quality: settings.quality,
                engine: settings.engine,
                encoder: settings.encoder,
                codec: settings.codec,
                fps: settings.fps,
                scaleTo: settings.resolution === 'native'
                    ? undefined
                    : { width: output.width, height: output.height },
                outputDirectoryUri: settings.outputDirectoryUri
            });
        } catch (error) {
            this.fail(describeUnexpectedQuickExportFailure(error, '書き出しサービスに接続できませんでした'));
            return false;
        }
        if (!outcome.accepted) {
            this.fail('別の書き出しが実行中のため、開始できませんでした');
            return false;
        }
        this.setupRequested = false;
        this.failureNotified = false;
        this.status = { phase: settings.rerunLint ? 'linting' : 'rendering', logTail: '' };
        this.fireChanged();
        this.beginPolling();
        return true;
    }

    async cancel(): Promise<void> {
        const result = await this.quickExportService.cancel();
        if (!result.cancelled) {
            return;
        }
        this.stopPolling();
        this.status = { ...this.status, phase: 'cancelled', failureSummary: undefined };
        this.setupRequested = true;
        this.fireChanged();
        void this.messages.info('書き出しを中止しました');
    }

    async revealArtifact(): Promise<void> {
        const result = await this.quickExportService.revealArtifact();
        if (!result.revealed) {
            void this.messages.error('Finder で成果物を表示できませんでした');
        }
    }

    async copyArtifact(): Promise<boolean> {
        const result = await this.quickExportService.copyArtifact();
        if (!result.copied) {
            void this.messages.error(result.reason ?? 'コピーできませんでした');
        }
        return result.copied;
    }

    openShareTarget(id: ExportShareTargetId): void {
        const target = EXPORT_SHARE_TARGETS.find(candidate => candidate.id === id);
        if (target) {
            this.windows.openNewWindow(target.url, { external: true });
        }
    }

    async openArtifact(path: string | undefined): Promise<void> {
        if (!path || !this.projectRoot) {
            return;
        }
        try {
            const uri = /^(?:\/|[A-Za-z]:[\\/])/u.test(path)
                ? FileUri.create(path)
                : this.projectRoot.resolve(path);
            await open(this.openers, uri);
        } catch (error) {
            console.warn('[akari-shell-strip] failed to open export path:', error);
        }
    }

    async handOffToPartner(): Promise<void> {
        const outputName = await this.chooseAvailableOutputName(defaultExportOutputNameForCodec(this.settings.codec));
        const packet = composeExportRequestPacket({
            resolutionLabel: 'edit.json のまま',
            outputName,
            rerunLint: this.settings.rerunLint
        });
        await this.commands.executeCommand(PARTNER_INJECT_PROMPT_COMMAND_ID, packet);
    }

    async handOffFinished(): Promise<void> {
        const artifactPath = this.status.artifactPath;
        if (!artifactPath) {
            return;
        }
        let absoluteArtifactPath = artifactPath;
        if (!/^(?:\/|[A-Za-z]:[\\/])/u.test(artifactPath)) {
            if (!this.projectRoot) {
                return;
            }
            absoluteArtifactPath = this.projectRoot.resolve(artifactPath).path.fsPath();
        }
        const packet = composeExportHandOffPacket({
            artifactPath: absoluteArtifactPath,
            durationSeconds: this.video.durationSeconds,
            width: this.video.width,
            height: this.video.height,
            fps: this.settings.fps ?? this.video.fps,
            bytes: this.status.artifactSize,
            engine: this.status.progressEngine
        });
        await this.commands.executeCommand(PARTNER_INJECT_PROMPT_COMMAND_ID, packet);
    }

    async handOffLintFailure(): Promise<void> {
        const findings = this.status.lintFindings ?? [];
        const formatted = findings.length > 0
            ? findings.map(finding => {
                const detail = `${finding.check ? `[${finding.check}] ` : ''}${finding.message ?? 'edit-lint finding'}`;
                return formatLintFailureForUi(
                    finding.severity === 'warning' ? 'lint 警告' : 'lint エラー',
                    [detail],
                    [finding] as readonly UiLintFinding[]
                );
            }).join('\n')
            : '書き出し前の lint を直してください。詳しい内容は lint レポートにあります。';
        const report = this.status.reportPath ? `\nlint レポート: ${this.status.reportPath}` : '';
        await this.commands.executeCommand(PARTNER_INJECT_PROMPT_COMMAND_ID, `${formatted}${report}`);
    }

    protected async refreshProject(): Promise<void> {
        const roots = await this.workspace.roots;
        const nextRoot = roots[0]?.resource;
        const rootChanged = nextRoot?.toString() !== this.projectRoot?.toString();
        this.projectRoot = nextRoot;
        this.projectLabel = this.projectRoot?.path.base ?? '';
        if (rootChanged) {
            this.settings = this.readPreferences();
            this.lastRun = await this.storage.getData<StoredExportLastRun>(LAST_RUN_STORAGE_KEY);
        }
        if (!this.projectRoot) {
            this.editJson = {};
            this.video = { orientation: 'landscape', width: undefined, height: undefined, fps: undefined };
            this.outputName = defaultExportOutputNameForCodec(this.settings.codec);
            this.renderProgress = undefined;
            this.fireChanged();
            return;
        }
        const [editJson, captionsJson, renderJson] = await Promise.all([
            this.readJson(this.projectRoot.resolve('edit.json')),
            this.readJson(this.projectRoot.resolve(CAPTIONS_RELATIVE_PATH)),
            this.readJson(this.projectRoot.resolve(RENDER_JSON_RELATIVE_PATH))
        ]);
        this.editJson = editJson ?? {};
        this.video = describeThisVideo(editJson, captionsJson);
        const fallbackDuration = this.renderDuration(renderJson);
        if (this.video.durationSeconds === undefined && fallbackDuration !== undefined) {
            this.video = { ...this.video, durationSeconds: fallbackDuration };
        }
        this.renderProgress = renderJson ? parseRenderProgress(renderJson) : undefined;
        this.outputName = await this.chooseAvailableOutputName(defaultExportOutputNameForCodec(this.settings.codec));
        void this.updateLintWatch();
        this.fireChanged();
    }

    protected readPreferences(): ExportSettings {
        const quality = this.preferences.get<QuickExportQuality>(AKARI_EXPORT_QUALITY, 'standard');
        const encoder = this.preferences.get<QuickExportEncoder>(AKARI_EXPORT_ENCODER, 'auto');
        const codec = this.preferences.get<QuickExportCodec>(AKARI_EXPORT_CODEC, 'h264');
        const fps = this.preferences.get<number | undefined>(AKARI_EXPORT_FPS);
        const outputDirectory = this.preferences.get<string>(AKARI_EXPORT_OUTPUT_DIRECTORY, '').trim();
        return {
            ...DEFAULT_SETTINGS,
            quality: QUALITIES.includes(quality) ? quality : 'standard',
            encoder: ENCODERS.includes(encoder) ? encoder : 'auto',
            codec: CODECS.includes(codec) ? codec : 'h264',
            fps: [24, 30, 60].includes(fps ?? 0) ? fps : undefined,
            outputDirectoryUri: outputDirectory || undefined
        };
    }

    protected updateSettingFromPreference(preferenceName: string): void {
        const preferences = this.readPreferences();
        switch (preferenceName) {
            case AKARI_EXPORT_QUALITY:
                this.settings = { ...this.settings, quality: preferences.quality };
                break;
            case AKARI_EXPORT_ENCODER:
                this.settings = { ...this.settings, encoder: preferences.encoder };
                break;
            case AKARI_EXPORT_CODEC:
                this.settings = { ...this.settings, codec: preferences.codec };
                this.refreshOutputNameForCodec(preferences.codec);
                break;
            case AKARI_EXPORT_FPS:
                this.settings = { ...this.settings, fps: preferences.fps };
                break;
            case AKARI_EXPORT_OUTPUT_DIRECTORY:
                this.settings = { ...this.settings, outputDirectoryUri: preferences.outputDirectoryUri };
                break;
            default:
                return;
        }
        this.fireChanged();
    }

    protected async savePreferences(settings: ExportSettings): Promise<void> {
        await this.preferences.set(AKARI_EXPORT_QUALITY, settings.quality, PreferenceScope.User);
        await this.preferences.set(AKARI_EXPORT_ENCODER, settings.encoder, PreferenceScope.User);
        await this.preferences.set(AKARI_EXPORT_CODEC, settings.codec, PreferenceScope.User);
        await this.preferences.set(AKARI_EXPORT_FPS, settings.fps, PreferenceScope.User);
        await this.preferences.set(AKARI_EXPORT_OUTPUT_DIRECTORY, settings.outputDirectoryUri ?? '', PreferenceScope.User);
    }

    protected async readJson(uri: URI): Promise<unknown | undefined> {
        try {
            const content = await this.files.readFile(uri);
            return JSON.parse(content.value.toString()) as unknown;
        } catch {
            return undefined;
        }
    }

    protected renderDuration(value: unknown): number | undefined {
        if (!value || typeof value !== 'object') {
            return undefined;
        }
        const plan = (value as { plan?: unknown }).plan;
        if (!plan || typeof plan !== 'object') {
            return undefined;
        }
        const duration = (plan as { predicted_duration_seconds?: unknown }).predicted_duration_seconds;
        return typeof duration === 'number' && Number.isFinite(duration) && duration >= 0
            ? duration
            : undefined;
    }

    protected async chooseAvailableOutputName(baseName: string): Promise<string> {
        if (!this.projectRoot) {
            return nextAvailableOutputName(baseName, []);
        }
        const directory = this.settings.outputDirectoryUri
            ? new URI(this.settings.outputDirectoryUri)
            : this.projectRoot.resolve(QUICK_EXPORT_OUTPUT_DIRECTORY);
        let stat: FileStat;
        try {
            stat = await this.files.resolve(directory);
        } catch (error) {
            if (error instanceof Error && toFileOperationResult(error) === FileOperationResult.FILE_NOT_FOUND) {
                return nextAvailableOutputName(baseName, []);
            }
            throw error;
        }
        const existingNames = (stat.children ?? []).map(child => child.resource.path.base);
        return nextAvailableOutputName(baseName, existingNames);
    }

    protected refreshOutputNameForCodec(codec: QuickExportCodec = this.settings.codec): void {
        const defaultName = defaultExportOutputNameForCodec(codec);
        this.outputName = defaultName;
        void this.chooseAvailableOutputName(defaultName).then(name => {
            if (this.settings.codec === codec) {
                this.outputName = name;
                this.fireChanged();
            }
        }).catch(error => console.info('[akari-shell-strip] export output name unavailable:', error));
    }

    protected async syncStatus(): Promise<void> {
        try {
            this.applyStatus(await this.quickExportService.getStatus());
        } catch (error) {
            console.info('[akari-shell-strip] export status unavailable:', error);
        }
    }

    protected beginPolling(): void {
        if (this.pollHandle !== undefined) {
            return;
        }
        this.pollHandle = window.setInterval(() => void this.poll(), POLL_INTERVAL_MS);
        void this.poll();
    }

    protected stopPolling(): void {
        if (this.pollHandle !== undefined) {
            window.clearInterval(this.pollHandle);
            this.pollHandle = undefined;
        }
    }

    protected async poll(): Promise<void> {
        try {
            this.applyStatus(await this.quickExportService.getStatus());
        } catch (error) {
            this.fail(describeUnexpectedQuickExportFailure(error, '書き出しの進捗を取得できませんでした'));
        }
    }

    protected applyStatus(status: QuickExportStatus, options: { notify?: boolean } = {}): void {
        const wasDone = this.status.phase === 'done';
        this.status = status;
        if (status.phase === 'linting' || status.phase === 'rendering') {
            this.beginPolling();
        } else {
            this.stopPolling();
        }
        if (status.phase === 'done' && !wasDone) {
            void this.rememberLastRun(status);
        }
        if (options.notify ?? true) {
            const notification = quickExportErrorNotification(status, this.failureNotified);
            if (notification !== undefined) {
                this.failureNotified = true;
                void this.messages.error(notification);
            }
        }
        void this.updateLintWatch();
        this.fireChanged();
    }

    /**
     * lint 停止画面を開いている間だけ、編集ドキュメント（edit.json / captions.json）の
     * 変更を見張って自動再検査を仕掛ける。閉じている間・停止していない間は外す
     * （保存のたびに edit-lint を余分に 1 本起こさないため）。
     */
    protected async updateLintWatch(): Promise<void> {
        const root = this.projectRoot;
        const wanted = shouldWatchForLintRecheck(this.status.phase, this.dialogVisible) && root
            ? root.toString()
            : undefined;
        if (wanted === this.lintWatchRoot) {
            return;
        }
        this.lintWatchRoot = wanted;
        this.lintWatch.dispose();
        this.lintWatch = new DisposableCollection();
        if (!wanted || !root) {
            this.cancelPendingLintRecheck();
            return;
        }
        try {
            this.lintWatch.push(await this.files.watch(root));
        } catch (error) {
            console.info('[akari-shell-strip] lint 再検査の watch を張れませんでした:', error);
        }
        this.lintWatch.push(this.files.onDidFilesChange(event => {
            const relevant = event.changes.some(change =>
                root.isEqualOrParent(change.resource) && shouldRecheckLintForPath(change.resource.path.toString()));
            if (relevant) {
                this.scheduleLintRecheck();
            }
        }));
    }

    protected scheduleLintRecheck(): void {
        this.cancelPendingLintRecheck();
        this.lintRecheckTimer = window.setTimeout(() => {
            this.lintRecheckTimer = undefined;
            void this.recheckLint({ auto: true });
        }, LINT_RECHECK_DEBOUNCE_MS);
    }

    protected cancelPendingLintRecheck(): void {
        if (this.lintRecheckTimer !== undefined) {
            window.clearTimeout(this.lintRecheckTimer);
            this.lintRecheckTimer = undefined;
        }
    }

    protected async rememberLastRun(status: QuickExportStatus): Promise<void> {
        if (!status.progressTotalFrames || !status.progressElapsedMs || !status.progressEngine
            || !this.video.width || !this.video.height) {
            return;
        }
        this.lastRun = {
            frames: status.progressTotalFrames,
            width: this.video.width,
            height: this.video.height,
            elapsedMs: status.progressElapsedMs,
            engine: status.progressEngine,
            at: new Date().toISOString()
        };
        await this.storage.setData(LAST_RUN_STORAGE_KEY, this.lastRun);
        this.fireChanged();
    }

    protected fail(failureSummary: string): void {
        this.stopPolling();
        this.status = { phase: 'failed', logTail: '', failureSummary };
        const notification = quickExportErrorNotification(this.status, this.failureNotified);
        if (notification) {
            this.failureNotified = true;
            void this.messages.error(notification);
        }
        this.fireChanged();
    }

    protected fireChanged(): void {
        this.changeEmitter.fire(undefined);
    }
}
