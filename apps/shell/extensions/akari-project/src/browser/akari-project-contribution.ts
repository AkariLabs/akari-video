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
import { AkariProjectService, DroppedVideo } from '../common/akari-project-protocol';
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
            if (this.isDelegatedDropzone(event.target) || this.isSelfHandledDropTarget(event.target)) {
                // data-akari-dropzone を持つ場所、および Theia 本体のメインドックパネル
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
            if (this.isDelegatedDropzone(event.target)) {
                // 俯瞰の取り込みドロップゾーンなど、自前でコピーとメッセージ表示まで
                // 完結させたい場所には割り込まない。
                return;
            }
            const videos = this.getDroppedVideos(event.dataTransfer);
            if (videos.length) {
                event.preventDefault();
                event.stopPropagation();
                void this.handleVideoDrop(videos);
            }
        }, true);
    }

    /** `data-akari-dropzone` を持つ要素（の子孫）へのドロップは、その場所の実装に委ねる。 */
    protected isDelegatedDropzone(target: EventTarget | null): boolean {
        return target instanceof Element && !!target.closest('[data-akari-dropzone]');
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

    protected async handleVideoDrop(videos: DroppedVideo[]): Promise<void> {
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
                this.messages.info(`${imported} 本の動画を素材に取り込みました。`);
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

    protected getDroppedVideos(transfer: DataTransfer | null): DroppedVideo[] {
        if (!transfer) {
            return [];
        }
        const extensions = /\.(mp4|mov|m4v|webm|mkv|avi)$/i;
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
