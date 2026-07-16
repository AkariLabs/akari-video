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
    WidgetManager,
    open
} from '@theia/core/lib/browser';
import {
    TabBarToolbarContribution,
    TabBarToolbarRegistry
} from '@theia/core/lib/browser/shell/tab-bar-toolbar';
import { DiffUris } from '@theia/core/lib/browser/diff-uris';
import { FileDialogService } from '@theia/filesystem/lib/browser';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { AkariProjectService, DroppedVideo } from '../common/akari-project-protocol';
import { AkariProjectModeService } from './akari-project-mode-service';
import { AkariWorkflowService } from './akari-workflow-service';

export const NEW_AKARI_PROJECT: Command = {
    id: 'akari.project.new',
    label: '新規プロジェクト作成'
};
export const SHOW_AKARI_CHANGES: Command = {
    id: 'akari.project.showChanges',
    label: '変更を見る'
};
export const TOGGLE_AKARI_DEVELOPER_MODE: Command = {
    id: 'akari.project.toggleDeveloperMode',
    label: '開発者モードを切り替える'
};

@injectable()
export class AkariProjectContribution implements CommandContribution, MenuContribution, FrontendApplicationContribution, TabBarToolbarContribution {
    @inject(AkariProjectService)
    protected readonly projectService!: AkariProjectService;
    @inject(FileDialogService)
    protected readonly dialogs!: FileDialogService;
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
        await this.watchOpenRoots();
        this.workspace.onWorkspaceChanged(() => {
            void this.workflow.load();
            void this.watchOpenRoots();
        });
        document.addEventListener('dragover', event => {
            if (event.dataTransfer?.types.includes('Files') || this.getDroppedVideos(event.dataTransfer).length) {
                event.preventDefault();
            }
        }, true);
        document.addEventListener('drop', event => {
            const videos = this.getDroppedVideos(event.dataTransfer);
            if (videos.length) {
                event.preventDefault();
                event.stopPropagation();
                void this.handleVideoDrop(videos);
            }
        }, true);
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
        await Promise.all(roots.map(root => this.projectService.watchProject(root.resource.toString())));
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

    protected async toggleDeveloperMode(): Promise<void> {
        await this.preferences.set('akari.developerMode', !this.mode.developerMode, PreferenceScope.User);
        await this.workflow.load();
        const navigator = await this.widgets.getOrCreateWidget('files') as any;
        await navigator.model?.refresh?.();
        this.app?.shell.update();
    }

    protected errorMessage(error: unknown): string {
        return error instanceof Error ? error.message : String(error);
    }
}
