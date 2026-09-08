import { inject, injectable } from '@theia/core/shared/inversify';
import * as React from '@theia/core/shared/react';
import URI from '@theia/core/lib/common/uri';
import {
    Command,
    CommandContribution,
    CommandRegistry,
    CommandService,
    MenuContribution,
    MenuModelRegistry,
    MessageService
} from '@theia/core/lib/common';
import { PreferenceScope, PreferenceService } from '@theia/core/lib/common/preferences';
import {
    ApplicationShell,
    CommonMenus,
    FrontendApplication,
    FrontendApplicationContribution,
    OpenerService,
    StorageService,
    WidgetManager,
    open
} from '@theia/core/lib/browser';
import { FrontendApplicationStateService } from '@theia/core/lib/browser/frontend-application-state';
import {
    TabBarToolbarContribution,
    TabBarToolbarRegistry
} from '@theia/core/lib/browser/shell/tab-bar-toolbar';
import { DiffUris } from '@theia/core/lib/browser/diff-uris';
import { FileDialogService } from '@theia/filesystem/lib/browser';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { AkariProjectService, DroppedVideo, DroppedVideoImportResult } from '../common/akari-project-protocol';
import { isDelegatedDropInput } from '../common/delegated-drop';
import { ElectronAkariProjectApi } from '../electron-common/electron-api';
import { AkariProjectModeService } from './akari-project-mode-service';
import { AkariWorkflowService } from './akari-workflow-service';
import { AkariRoleBucketsWidget } from './akari-role-buckets-widget';
import { AKARI_REVEAL_IN_FILE_MANAGER, AKARI_REVEAL_PROJECT_ROOT, AKARI_SHOW_ASSET_INFO } from './akari-reveal-commands';
import { AkariAssetInspector } from './akari-asset-inspector';

/**
 * 「場所を選んで新規作成…」。File メニュー先頭の「新規プロジェクト作成」は
 * 2026-08-07 のオーナー裁定でホームと同じ経路（akari.home.newProject）に移した。
 * こちらは**保存先を自分で決めたい**とき用の副導線として残す
 * （選べるのは空フォルダだけ、という既存契約は不変 — 既存ファイルには触らない）。
 */
export const NEW_AKARI_PROJECT: Command = {
    id: 'akari.project.new',
    label: '場所を選んで新規作成…'
};
export const SHOW_AKARI_CHANGES: Command = {
    id: 'akari.project.showChanges',
    label: '変更を見る'
};
export const TOGGLE_AKARI_DEVELOPER_MODE: Command = {
    id: 'akari.project.toggleDeveloperMode',
    label: '開発者モードを切り替える'
};
export const DISCONNECT_AKARI_STORE_ACCOUNT: Command = {
    id: 'akari.project.disconnectStoreAccount',
    label: 'AKARI アカウントの接続を解除'
};
const PROJECT_CONSENT_MESSAGE =
    'このフォルダを AKARI Video プロジェクトとして使いますか？' +
    '（フォルダ構成の作成と、作業の節目の記録を始めます）';
const PROJECT_CONSENT_ACTION_USE = '使う';
const PROJECT_CONSENT_ACTION_OPEN_ONLY = '開くだけ';
const PARENT_HISTORY_NOTICE_MESSAGE =
    'このフォルダは別の変更履歴の中にあるため、このプロジェクト単体の変更履歴は記録されません。';

/**
 * タイムラインへ「落とした位置」で置く内部コマンド（task 2026-09-08-timeline-file-drop 指示9・10）。
 * 拡張をまたぐ import は作らない流儀なので、akari-annotations 側の宣言と独立に文字列で持つ
 * （TIMELINE_ADD_MATERIAL_AT_PLAYHEAD_COMMAND_ID / akari-role-buckets-widget.tsx と同型）。
 */
const TIMELINE_ADD_MATERIAL_AT_POINT_COMMAND_ID = 'akari.timeline.addMaterialAtPoint';
/** タイムライン widget の root クラス（akari-annotations-widget.ts が node に付けている）。 */
const TIMELINE_WIDGET_SELECTOR = '.akari-annotations-widget';
const VIDEO_EXTENSIONS = /\.(mp4|mov|m4v|webm|mkv|avi)$/i;
const AUDIO_EXTENSIONS = /\.(wav|mp3|m4a|aac|flac|ogg)$/i;
const IMAGE_EXTENSIONS = /\.(png|jpe?g|gif|webp)$/i;

@injectable()
export class AkariProjectContribution implements CommandContribution, MenuContribution, FrontendApplicationContribution, TabBarToolbarContribution {
    @inject(AkariProjectService)
    protected readonly projectService!: AkariProjectService;
    @inject(StorageService)
    protected readonly storage!: StorageService;
    @inject(FrontendApplicationStateService)
    protected readonly stateService!: FrontendApplicationStateService;
    @inject(FileDialogService)
    protected readonly dialogs!: FileDialogService;
    @inject(FileService)
    protected readonly files!: FileService;
    @inject(WorkspaceService)
    protected readonly workspace!: WorkspaceService;
    @inject(MessageService)
    protected readonly messages!: MessageService;
    @inject(CommandService)
    protected readonly commands!: CommandService;
    @inject(OpenerService)
    protected readonly openers!: OpenerService;
    @inject(PreferenceService)
    protected readonly preferences!: PreferenceService;
    @inject(WidgetManager)
    protected readonly widgets!: WidgetManager;
    @inject(AkariProjectModeService)
    protected readonly mode!: AkariProjectModeService;
    @inject(AkariWorkflowService)
    protected readonly workflow!: AkariWorkflowService;
    @inject(ApplicationShell)
    protected readonly shell!: ApplicationShell;

    protected app?: FrontendApplication;

    registerCommands(commands: CommandRegistry): void {
        commands.registerCommand(NEW_AKARI_PROJECT, { execute: () => this.createProject() });
        commands.registerCommand(SHOW_AKARI_CHANGES, { execute: () => this.showChanges() });
        commands.registerCommand(TOGGLE_AKARI_DEVELOPER_MODE, {
            execute: () => this.toggleDeveloperMode(),
            isToggled: () => this.mode.developerMode
        });
        commands.registerCommand(DISCONNECT_AKARI_STORE_ACCOUNT, {
            execute: () => this.disconnectStoreAccount()
        });
        commands.registerCommand(AKARI_REVEAL_IN_FILE_MANAGER, {
            execute: (target: unknown) => this.revealInFileManager(this.toRevealUri(target))
        });
        commands.registerCommand(AKARI_REVEAL_PROJECT_ROOT, {
            execute: () => this.revealProjectRoot()
        });
        commands.registerCommand(AKARI_SHOW_ASSET_INFO, {
            execute: (target: unknown) => this.showAssetInfo(this.toRevealUri(target))
        });
    }

    registerMenus(menus: MenuModelRegistry): void {
        menus.registerMenuAction(CommonMenus.FILE_NEW, {
            commandId: NEW_AKARI_PROJECT.id,
            label: NEW_AKARI_PROJECT.label,
            order: 'a10'
        });
        menus.registerMenuAction(CommonMenus.FILE, {
            commandId: SHOW_AKARI_CHANGES.id,
            label: SHOW_AKARI_CHANGES.label,
            order: 'z10'
        });
        menus.registerMenuAction(CommonMenus.FILE, {
            commandId: AKARI_REVEAL_PROJECT_ROOT.id,
            label: AKARI_REVEAL_PROJECT_ROOT.label,
            order: 'z11'
        });
    }

    registerToolbarItems(toolbar: TabBarToolbarRegistry): void {
        toolbar.registerItem({
            id: 'akari.project.showChanges.toolbar',
            command: SHOW_AKARI_CHANGES.id,
            group: 'navigation',
            priority: 100,
            isVisible: widget => !!widget && this.shell.getAreaFor(widget) === 'main',
            render: () => React.createElement('button', {
                type: 'button',
                className: 'theia-button secondary',
                title: SHOW_AKARI_CHANGES.label,
                'aria-label': SHOW_AKARI_CHANGES.label,
                style: {
                    alignItems: 'center',
                    display: 'inline-flex',
                    gap: '4px',
                    height: '24px',
                    margin: '0 4px',
                    padding: '0 8px'
                },
                onClick: event => {
                    event.preventDefault();
                    event.stopPropagation();
                    void this.commands.executeCommand(SHOW_AKARI_CHANGES.id);
                }
            },
            React.createElement('span', { className: 'codicon codicon-diff', 'aria-hidden': true }),
            React.createElement('span', undefined, SHOW_AKARI_CHANGES.label))
        });
    }

    async onStart(app: FrontendApplication): Promise<void> {
        this.app = app;
        await this.workflow.load();
        this.stateService.reachedState('ready').then(() => {
            void this.watchOpenRoots();
        });
        this.workspace.onWorkspaceChanged(() => {
            void this.workflow.load();
            void this.watchOpenRoots();
        });
        document.addEventListener('dragover', event => {
            if (this.isDelegatedDrop(event) || this.isSelfHandledDropTarget(event.target)) {
                // AKARI 内部ドラッグを受ける data-akari-dropzone、および Theia 本体のメインドックパネル
                // （エディタ領域 — ファイルをタブとして開く自前の 3 点セットを既に持つ、
                // application-shell.js の dockPanel.node 'dragover'/'drop'）は自前で完結する。
                // ここで stopPropagation すると capture 段階の時点でそこまで event が
                // 届かなくなるため、触らない。
                return;
            }
            if (!(event.dataTransfer?.types.includes('Files') || this.getDroppedVideos(event.dataTransfer).length)) {
                return;
            }
            // dropzone-audit 2026-08-09: この capture 段階の preventDefault だけでは
            // 足りない。Theia 本体（frontend-application.js registerEventListeners）が
            // document の**バブル段階**で dataTransfer.dropEffect = 'none' を無条件に
            // 設定しており、stopPropagation で止めない限り最終的にそちらが勝って
            // drop イベントが一度も発火しない（素材パネルで実測済みの同型バグ、4fdf3f6）。
            // ここは委譲先を持たない「どこにドロップしても動画を取り込む」フォールバック
            // 経路なので、素材パネル/ホームと同じ 3 点セットを capture 段階で確定させる。
            event.preventDefault();
            event.stopPropagation();
            if (event.dataTransfer) {
                event.dataTransfer.dropEffect = 'copy';
            }
        }, true);
        document.addEventListener('drop', event => {
            if (this.isDelegatedDrop(event)) {
                // 俯瞰の取り込みドロップゾーンなど、自前でコピーとメッセージ表示まで
                // 完結させたい場所には割り込まない。
                return;
            }
            const videos = this.getDroppedVideos(event.dataTransfer);
            if (videos.length) {
                event.preventDefault();
                event.stopPropagation();
                void this.handleVideoDrop(videos, {
                    clientX: event.clientX,
                    clientY: event.clientY,
                    onTimeline: this.isTimelineDropTarget(event.target)
                });
            }
        }, true);
    }

    /**
     * `data-akari-dropzone` の内側で起きた **AKARI 内部ドラッグ**（自前 MIME 付き）だけを
     * その場所の実装に委ねる（task 2026-09-08-timeline-file-drop 指示2）。判定本体は DOM 非依存の
     * 純関数 `isDelegatedDropInput`（common/delegated-drop.ts）で、ここはその薄い DOM 層。
     *
     * OS からのファイルドロップ（`types` が `Files` だけ）は委譲しない — 委譲先の drop ハンドラは
     * 自 MIME 以外を無視して return するため、委譲すると受け皿が消えて無反応になる（issue #63）。
     */
    protected isDelegatedDrop(event: DragEvent): boolean {
        const target = event.target;
        return isDelegatedDropInput({
            insideDropzone: target instanceof Element && !!target.closest('[data-akari-dropzone]'),
            types: event.dataTransfer ? Array.from(event.dataTransfer.types) : []
        });
    }

    /** ドロップ先がタイムライン widget の内側か（落とした位置へ置くかどうかの判定）。 */
    protected isTimelineDropTarget(target: EventTarget | null): boolean {
        return target instanceof Element && !!target.closest(TIMELINE_WIDGET_SELECTOR);
    }

    /**
     * Theia 本体のメインドックパネル（`#theia-main-content-panel` — エディタのタブ領域）
     * は `application-shell.js` の `createMainPanel` が独自に dragover/drop の 3 点セットを
     * 持ち、ファイルをタブとして開く。ここで割り込むと（ファイル種別を判定できる drop
     * イベント自体は奪わないにせよ）dragover の dropEffect を独自に 'copy' へ書き換えて
     * しまい、本体側の 'link' カーソルを上書きする副作用が出るため、対象から除外する。
     */
    protected isSelfHandledDropTarget(target: EventTarget | null): boolean {
        return target instanceof Element && !!target.closest('#theia-main-content-panel');
    }

    protected async createProject(): Promise<void> {
        const destination = await this.dialogs.showOpenDialog({
            title: '新しいプロジェクトの保存先を選ぶ',
            canSelectFiles: false,
            canSelectFolders: true
        });
        if (!destination) {
            return;
        }
        try {
            await this.projectService.createProject(destination.toString());
            await this.workspace.open(destination);
        } catch (error) {
            this.messages.error(`プロジェクトを作成できませんでした: ${this.errorMessage(error)}`);
        }
    }

    protected async watchOpenRoots(): Promise<void> {
        const roots = await this.workspace.roots;
        await Promise.all(roots.map(root => this.handleRoot(root.resource)));
    }

    protected async handleRoot(rootUri: URI): Promise<void> {
        const uri = rootUri.toString();
        if (await this.projectService.isAkariProject(uri)) {
            await this.projectService.watchProject(uri);
            await this.maybeNoticeParentHistory(uri);
            return;
        }
        const consentKey = this.consentStorageKey(uri);
        const consent = await this.storage.getData<'use' | 'open-only'>(consentKey);
        if (consent === 'open-only') {
            return;
        }
        if (consent === 'use') {
            await this.projectService.convertToProject(uri);
            await this.projectService.watchProject(uri);
            await this.maybeNoticeParentHistory(uri);
            return;
        }
        // messages.info はシェル描画前に await してはならない（起動デッドロック F35）
        const choice = await this.messages.info(
            PROJECT_CONSENT_MESSAGE,
            PROJECT_CONSENT_ACTION_USE,
            PROJECT_CONSENT_ACTION_OPEN_ONLY
        );
        if (choice === PROJECT_CONSENT_ACTION_USE) {
            await this.storage.setData(consentKey, 'use');
            await this.projectService.convertToProject(uri);
            await this.projectService.watchProject(uri);
            await this.maybeNoticeParentHistory(uri);
        } else if (choice === PROJECT_CONSENT_ACTION_OPEN_ONLY) {
            await this.storage.setData(consentKey, 'open-only');
        }
        // choice === undefined（ダイアログを選択せず閉じた）場合は何も記録しない。
        // 次回オープン時にもう一度尋ねる（安全側のデフォルト）。
    }

    protected async maybeNoticeParentHistory(uri: string): Promise<void> {
        const eligibility = await this.projectService.getGitEligibility(uri);
        if (eligibility !== 'inside-parent-repository') {
            return;
        }
        const noticeKey = this.parentHistoryNoticeStorageKey(uri);
        if (await this.storage.getData<boolean>(noticeKey, false)) {
            return;
        }
        await this.storage.setData(noticeKey, true);
        this.messages.info(PARENT_HISTORY_NOTICE_MESSAGE);
    }

    protected consentStorageKey(uri: string): string {
        return `akari.project.consent:${uri}`;
    }

    protected parentHistoryNoticeStorageKey(uri: string): string {
        return `akari.project.parentHistoryNotice:${uri}`;
    }

    /**
     * グローバルなファイルドロップの取り込み（task 2026-09-08-timeline-file-drop 指示9・10・12 で
     * 「落とした位置へ置く」導線を追加）。
     *
     * options.onTimeline のとき、取り込んだ素材を落とした座標のトラック・時刻へ順に置く
     * （`akari.timeline.addMaterialAtPoint`）。取り込み自体（recordDroppedVideos = video 限定）は
     * 従来どおりで変えない（司令塔裁定2 — 音声・画像のタイムラインドロップは別タスク）。
     */
    protected async handleVideoDrop(
        videos: DroppedVideo[],
        options?: { clientX: number; clientY: number; onTimeline: boolean }
    ): Promise<void> {
        const roots = await this.workspace.roots;
        const root = roots[0]?.resource;
        if (!root) {
            this.messages.warn('先にプロジェクトを開いてください。');
            return;
        }
        try {
            const results = await this.projectService.recordDroppedVideos(root.toString(), videos);
            const imported = results.filter(result => result.success).length;
            const failed = results.length - imported;
            if (imported) {
                const placed = options?.onTimeline
                    ? await this.placeImportedOnTimeline(results, options.clientX, options.clientY)
                    : 0;
                this.messages.info(placed > 0
                    ? `${imported} 本の動画をタイムラインに置きました。`
                    : `${imported} 本の動画を素材に取り込みました。`
                        + 'タイムラインへ置くには素材カードを右クリック →「タイムラインに追加」。');
                const navigator = await this.widgets.getOrCreateWidget('files') as any;
                await navigator.model?.refresh?.();
            }
            if (failed) {
                const message = '動画を取り込めませんでした。Finder からもう一度ドラッグしてください。';
                if (imported) {
                    this.messages.warn(`${failed} 本の${message}`);
                } else {
                    this.messages.error(message);
                }
            }
        } catch {
            this.messages.error('動画を取り込めませんでした。Finder からもう一度ドラッグしてください。');
        }
    }

    /**
     * 取り込み済みの素材を「落とした位置」へ順に置く（指示10）。置けた本数を返す。
     *
     * 取り込み結果（DroppedVideoImportResult）は `eventUri` しか持たず、`assets/` 上の実ファイル名は
     * 同名衝突時に `stem-2.ext` へずれる（akari-project-service.ts の availableName）。ここで名前を
     * 推測すると外すので、書かれた `.akari/events/*.json` の `asset` を読んで正とする
     * （src/node/** は本タスクの編集対象外 — サービスの戻り値は変えない）。
     */
    protected async placeImportedOnTimeline(
        results: DroppedVideoImportResult[], clientX: number, clientY: number
    ): Promise<number> {
        let placed = 0;
        for (const result of results) {
            if (!result.success) {
                continue;
            }
            const relativePath = await this.importedAssetPath(result.eventUri);
            const kind = this.classifyDroppedAssetKind(result.name);
            if (!relativePath || !kind) {
                continue;
            }
            try {
                await this.commands.executeCommand(TIMELINE_ADD_MATERIAL_AT_POINT_COMMAND_ID, {
                    relativePath, kind, clientX, clientY
                });
                placed++;
            } catch {
                // タイムラインへ置けなくても取り込みは成功している。ここで止めず、
                // 「素材に取り込みました」側のメッセージで次の一手を案内する。
            }
        }
        return placed;
    }

    /** `.akari/events/*.json` の `asset`（プロジェクト相対パス）を読む。読めなければ undefined。 */
    protected async importedAssetPath(eventUri: string): Promise<string | undefined> {
        try {
            const content = await this.files.readFile(new URI(eventUri));
            const value = JSON.parse(content.value.toString()) as { asset?: unknown };
            return typeof value.asset === 'string' && value.asset ? value.asset : undefined;
        } catch {
            return undefined;
        }
    }

    /**
     * 拡張子からの素材種別（src/node/akari-project-service.ts の classifyDroppedAssetExtension と
     * 同じ表）。グローバル経路が取り込むのは video だけだが、種別を固定せず分類結果を渡す（指示10）。
     */
    protected classifyDroppedAssetKind(name: string): 'video' | 'audio' | 'image' | undefined {
        if (VIDEO_EXTENSIONS.test(name)) {
            return 'video';
        }
        if (AUDIO_EXTENSIONS.test(name)) {
            return 'audio';
        }
        if (IMAGE_EXTENSIONS.test(name)) {
            return 'image';
        }
        return undefined;
    }

    protected getDroppedVideos(transfer: DataTransfer | null): DroppedVideo[] {
        if (!transfer) {
            return [];
        }
        const extensions = VIDEO_EXTENSIONS;
        const fromFiles = Array.from(transfer.files)
            .filter(file => extensions.test(file.name))
            .map(file => {
                const theiaCore = (window as Window & {
                    electronTheiaCore?: { getPathForFile?: (candidate: File) => string };
                }).electronTheiaCore;
                let sourcePath: string | undefined;
                if (typeof theiaCore?.getPathForFile === 'function') {
                    try {
                        sourcePath = theiaCore.getPathForFile(file) || undefined;
                    } catch {
                        // Fall back for environments without the Electron preload bridge.
                    }
                }
                sourcePath ||= (file as File & { path?: string }).path;
                return { name: file.name, sourcePath };
            });
        if (fromFiles.length) {
            return fromFiles;
        }
        const uriList = transfer.getData('text/uri-list');
        return uriList.split(/\r?\n/)
            .filter(line => line.startsWith('file:') && extensions.test(line))
            .map(line => {
                const uri = new URI(line);
                return { name: uri.path.base, sourcePath: uri.path.fsPath() };
            });
    }

    protected async showChanges(): Promise<void> {
        const roots = await this.workspace.roots;
        const root = roots[0]?.resource;
        if (!root) {
            this.messages.warn('プロジェクトを開いてください。');
            return;
        }
        try {
            const { capable, pairs } = await this.projectService.prepareDiffs(root.toString());
            if (!capable) {
                this.messages.info('このフォルダーでは変更履歴を使えません。');
                return;
            }
            if (!pairs.length) {
                this.messages.info('表示できる変更はまだありません。');
                return;
            }
            for (const pair of pairs) {
                const diffUri = DiffUris.encode(new URI(pair.leftUri), new URI(pair.rightUri));
                await open(this.openers, diffUri, { mode: 'activate' });
            }
        } catch (error) {
            this.messages.error(`変更を表示できませんでした: ${this.errorMessage(error)}`);
        }
    }

    /**
     * 3 箇所（ホームのプロジェクトカード / できたもの各項目 / File メニュー）が共有する
     * 実体（task 2026-08-09-reveal-in-finder）。存在確認は FileService で先に行い、
     * 「黙って何も起きない」を避けてエラーメッセージを必ず出す。実際に開く処理は
     * electron-main の `shell.showItemInFolder`（`electron-api-main.ts`）に委ねる。
     */
    protected async revealInFileManager(uri: URI): Promise<void> {
        const exists = await this.files.exists(uri);
        if (!exists) {
            this.messages.error(`見つかりませんでした: ${uri.path.fsPath()}`);
            return;
        }
        const api = (window as Window & { electronAkariProject?: ElectronAkariProjectApi }).electronAkariProject;
        if (!api) {
            this.messages.error('この機能は AKARI Video アプリでのみ使えます。');
            return;
        }
        const result = await api.revealInFileManager(uri.path.fsPath());
        if (!result.ok) {
            this.messages.error(result.message ?? `開けませんでした: ${uri.path.fsPath()}`);
        }
    }

    protected toRevealUri(target: unknown): URI {
        return target instanceof URI ? target : new URI(String(target));
    }

    protected async revealProjectRoot(): Promise<void> {
        const roots = await this.workspace.roots;
        const root = roots[0]?.resource;
        if (!root) {
            this.messages.warn('プロジェクトを開いてください。');
            return;
        }
        await this.revealInFileManager(root);
    }

    /**
     * 素材カード「素材の情報を表示」（`akari.project.showAssetInfo`、task
     * 2026-08-10-material-menu-r2 指示3）。素材の情報パネル（`akari-asset-inspector-widget`、
     * Explorer view container の常設パート）を reveal/activate してから showAsset を呼ぶ
     * （司令塔裁定5・指示3）。パネルが見つからない/reveal に失敗する場合は深追いせず
     * 例外を握って messages.warn に落とす（実機挙動は司令塔検収）。
     */
    protected async showAssetInfo(uri: URI): Promise<void> {
        try {
            const inspector = await this.widgets.getOrCreateWidget<AkariAssetInspector>(AkariAssetInspector.ID);
            await this.shell.revealWidget(inspector.id);
            await this.shell.activateWidget(inspector.id);
            await inspector.showAsset(uri);
        } catch (error) {
            this.messages.warn(`素材の情報を表示できませんでした: ${this.errorMessage(error)}`);
        }
    }

    protected async toggleDeveloperMode(): Promise<void> {
        await this.preferences.set('akari.developerMode', !this.mode.developerMode, PreferenceScope.User);
        await this.workflow.load();
        const navigator = await this.widgets.getOrCreateWidget('files') as any;
        await navigator.model?.refresh?.();
        this.app?.shell.update();
    }

    protected async disconnectStoreAccount(): Promise<void> {
        try {
            const connection = await this.projectService.getStoreConnectionStatus();
            if (!connection.connected) {
                this.messages.info('AKARI アカウントは未接続です。');
                return;
            }
            const action = await this.messages.warn(
                `${connection.identifier} として接続中です。この端末の接続情報を削除しますか？`,
                '切断する'
            );
            if (action !== '切断する') {
                return;
            }
            await this.projectService.disconnectStoreAccount();
            const widget = await this.widgets.getOrCreateWidget(AkariRoleBucketsWidget.ID) as AkariRoleBucketsWidget;
            await widget.refreshStoreConnectionStatus();
            this.messages.info('AKARI アカウントの接続を解除しました。');
        } catch (error) {
            this.messages.error(`接続を解除できませんでした: ${this.errorMessage(error)}`);
        }
    }

    protected errorMessage(error: unknown): string {
        return error instanceof Error ? error.message : String(error);
    }
}
