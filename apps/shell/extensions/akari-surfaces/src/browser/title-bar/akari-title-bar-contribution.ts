import { inject, injectable } from '@theia/core/shared/inversify';
import { ApplicationShell, FrontendApplication, Widget } from '@theia/core/lib/browser';
import { ContextKeyService } from '@theia/core/lib/browser/context-key-service';
import { CommandRegistry } from '@theia/core/lib/common/command';
import { EnvVariablesServer } from '@theia/core/lib/common/env-variables';
import URI from '@theia/core/lib/common/uri';
import { isOSX, isWindows } from '@theia/core/lib/common/os';
import { PreferenceService } from '@theia/core/lib/common/preferences';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { WindowTitleService } from '@theia/core/lib/browser/window/window-title-service';
import { AkariAnnotationsClientImpl } from 'akari-annotations/lib/browser/akari-annotations-client';
import { AkariWelcomeWindowTitleContribution } from '../akari-welcome-window-title-contribution';
import { ProjectProgressService } from '../home/project-progress';
import { channelFromRelativePath, savedChip, shouldRerenderOnContextKeys, stageDots, titleBarCenter, titleBarGeometry, windowButtons } from './title-bar-model';

// この拡張には既存の限定的な electronTheiaCore 宣言があるため、Theia の
// Window 宣言を重ねず実行時のクラスを使う。継承メソッドは Theia の .d.ts と同じ可視性。
// eslint-disable-next-line @typescript-eslint/no-var-requires
const ElectronMenuContribution = require('@theia/core/lib/electron-browser/menu/electron-menu-contribution').ElectronMenuContribution;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const ElectronMainMenuFactory = require('@theia/core/lib/electron-browser/menu/electron-main-menu-factory').ElectronMainMenuFactory;

export const AKARI_TITLE_BAR_CSS = `
#theia-top-panel { height: var(--akari-title-height, 40px) !important; min-height: var(--akari-title-height, 40px) !important; opacity: var(--akari-title-opacity, 1); background: var(--theia-titleBar-activeBackground) !important; color: var(--theia-titleBar-activeForeground); }
#theia-top-panel > * { -webkit-app-region: drag; }
#theia-drag-panel { position: relative !important; inset: auto !important; margin: 0 !important; width: 100% !important; height: 100% !important; display: grid !important; grid-template-columns: 1fr auto 1fr; align-items: center; -webkit-app-region: drag !important; font-size: 12px; user-select: none; }
#theia-drag-panel button { -webkit-app-region: no-drag !important; }
#theia-drag-panel .akari-title-left { padding-left: 14px; font-weight: 700; letter-spacing: .02em; }
body.akari-title-mac #theia-drag-panel .akari-title-left { padding-left: var(--akari-title-leading-space, 78px); }
#theia-drag-panel .akari-title-center { display: flex; align-items: center; justify-content: center; gap: 8px; min-width: 0; white-space: nowrap; }
#theia-drag-panel .akari-title-channel { color: inherit; border: 0; padding: 3px 5px; background: transparent; font: inherit; cursor: pointer; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 180px; }
#theia-drag-panel .akari-title-channel:hover { background: rgba(127,127,127,.14); border-radius: 5px; }
#theia-drag-panel .akari-title-project { overflow: hidden; text-overflow: ellipsis; max-width: 240px; font-weight: 600; }
#theia-drag-panel .akari-title-separator { opacity: .5; }
#theia-drag-panel .akari-title-dots { display: flex; gap: 4px; margin-left: 6px; }
#theia-drag-panel .akari-title-dot { width: 5px; height: 5px; border: 1px solid var(--akari-line, currentColor); border-radius: 50%; }
#theia-drag-panel .akari-title-dot.done { background: #4ade80; border-color: #4ade80; opacity: 1; }
#theia-drag-panel .akari-title-dot.current { background: var(--akari-accent, #f97316); border-color: var(--akari-accent, #f97316); }
#theia-drag-panel .akari-title-chip { display: inline-flex; align-items: center; gap: 5px; margin-left: 6px; opacity: .85; }
#theia-drag-panel .akari-title-chip::before { content: ''; width: 6px; height: 6px; border-radius: 50%; background: #4ade80; }
#theia-drag-panel .akari-title-chip.busy { color: var(--akari-accent, #f97316); }
#theia-drag-panel .akari-title-chip.busy::before { background: currentColor; animation: akari-title-pulse 1.2s ease-in-out infinite; }
#theia-drag-panel .akari-title-chip.pending::before { background: var(--akari-accent, #f97316); }
@keyframes akari-title-pulse { 50% { opacity: .35; } }
#theia-drag-panel .akari-title-controls { justify-self: end; height: 100%; display: flex; }
#theia-drag-panel .akari-title-controls button { width: 46px; height: 100%; background: transparent; border: 0; color: inherit; font: inherit; cursor: pointer; }
#theia-drag-panel .akari-title-controls button:hover { background: rgba(127,127,127,.22); }
#theia-drag-panel .akari-title-controls button:last-child:hover { background: #e81123; color: white; }
body.maximized #theia-top-panel { border-radius: 0; }
`;

@injectable()
export class AkariTitleBarContribution extends ElectronMenuContribution {
    declare protected readonly factory: { setMenuBar(): void };
    declare protected readonly preferenceService: PreferenceService;
    declare protected readonly shell: ApplicationShell;
    @inject(WorkspaceService) protected readonly workspace: WorkspaceService;
    @inject(FileService) protected readonly files: FileService;
    @inject(EnvVariablesServer) protected readonly environment: EnvVariablesServer;
    @inject(ProjectProgressService) protected readonly progress: ProjectProgressService;
    @inject(AkariWelcomeWindowTitleContribution) protected readonly welcomeTitle: AkariWelcomeWindowTitleContribution;
    @inject(WindowTitleService) protected readonly windowTitle: WindowTitleService;
    @inject(AkariAnnotationsClientImpl) protected readonly annotations: AkariAnnotationsClientImpl;
    @inject(ContextKeyService) protected readonly contextKeys: ContextKeyService;
    @inject(CommandRegistry) protected readonly commands: CommandRegistry;

    protected center: HTMLElement | undefined;
    protected controls: HTMLElement | undefined;
    protected pending = 0;
    protected maximized = false;
    protected renderVersion = 0;
    protected channelCache: { root: string; channel: Promise<string | undefined> } | undefined;

    constructor(@inject(ElectronMainMenuFactory) factory: { setMenuBar(): void }) { super(factory); }

    onStart(app: FrontendApplication): void {
        super.onStart(app);
        this.workspace.onWorkspaceChanged(() => {
            this.channelCache = undefined;
            void this.renderCenter();
        });
        this.windowTitle.onDidChangeTitle(() => void this.renderCenter());
        this.progress.onDidChange(() => void this.renderCenter());
        this.annotations.onWillWriteEvent(() => { this.pending++; void this.renderCenter(); });
        this.annotations.onDidWriteEvent(() => { this.pending = Math.max(0, this.pending - 1); void this.renderCenter(); });
        this.contextKeys.onDidChange(event => {
            if (shouldRerenderOnContextKeys(keys => event.affects(keys))) { void this.renderCenter(); }
        });
        const updateWindow = (): void => {
            this.maximized = this.core.isMaximized();
            document.body.classList.toggle('maximized', this.maximized);
            this.renderControls();
        };
        this.core.onWindowEvent('maximize', updateWindow);
        this.core.onWindowEvent('unmaximize', updateWindow);
        updateWindow();
        const updateFullScreen = (fullScreen: boolean): void => {
            document.body.dataset.akariWindowFullscreen = String(fullScreen);
            const geometry = titleBarGeometry(isOSX ? 'mac' : isWindows ? 'windows' : 'other', fullScreen);
            document.body.style.setProperty('--akari-title-height', `${geometry.height}px`);
            document.body.style.setProperty('--akari-title-leading-space', `${geometry.leadingSpace}px`);
            document.body.style.setProperty('--akari-title-opacity', String(geometry.opacity));
        };
        window.addEventListener('akari-window-fullscreen', event => {
            updateFullScreen((event as CustomEvent<{ fullScreen: boolean }>).detail.fullScreen);
        });
        updateFullScreen(this.core.isFullScreen());
    }

    handleTitleBarStyling(app: FrontendApplication): void {
        this.hideTopPanel(app);
        this.setMenu(app);
        void this.preferenceService.ready.then(() => this.core.setMenuBarVisible(false));
    }

    protected hideTopPanel(app: FrontendApplication): void {
        app.shell.topPanel.show();
    }

    protected setMenu(app: FrontendApplication): void {
        this.createCustomTitleBar(app);
        if (isOSX) { this.factory.setMenuBar(); }
        else { this.core.setMenuBarVisible(false); }
    }

    protected createCustomTitleBar(app: FrontendApplication): void {
        if (document.getElementById('theia-drag-panel')) { return; }
        if (!document.getElementById('akari-title-bar-style')) {
            const style = document.createElement('style');
            style.id = 'akari-title-bar-style';
            style.textContent = AKARI_TITLE_BAR_CSS;
            document.head.appendChild(style);
        }
        document.body.classList.toggle('akari-title-mac', isOSX);
        const bar = new Widget();
        bar.id = 'theia-drag-panel';
        const left = document.createElement('div');
        left.className = 'akari-title-left';
        left.textContent = 'AKARI Video';
        this.center = document.createElement('div');
        this.center.className = 'akari-title-center';
        this.controls = document.createElement('div');
        this.controls.className = 'akari-title-controls';
        bar.node.append(left, this.center, this.controls);
        app.shell.addWidget(bar, { area: 'top' });
        void this.renderCenter();
        this.renderControls();
    }

    protected handleFullScreen(_menuBarVisibility: string): void {
        this.shell.topPanel.show();
        this.core.setMenuBarVisible(false);
    }

    handleToggleMaximized(): void { /* メニューバーを帯へ戻さない。 */ }

    protected get core(): {
        isMaximized(): boolean;
        isFullScreen(): boolean;
        setMenuBarVisible(visible: boolean): void;
        onWindowEvent(name: 'maximize' | 'unmaximize', listener: () => void): unknown;
        minimize(): void;
        maximize(): void;
        unMaximize(): void;
        close(): void;
    } {
        return (window as unknown as { electronTheiaCore: AkariTitleBarContribution['core'] }).electronTheiaCore;
    }

    protected async readWorkspaceChannel(root: URI): Promise<string | undefined> {
        try {
            const override = await this.environment.getValue('AKARI_HOME');
            const home = override?.value ? URI.fromFilePath(override.value) : new URI(await this.environment.getHomeDirUri()).resolve('.akari');
            const pointer = JSON.parse((await this.files.readFile(home.resolve('creator-root.json'))).value.toString());
            if (typeof pointer?.lastRoot !== 'string') { return undefined; }
            const relative = URI.fromFilePath(pointer.lastRoot).relative(root)?.toString();
            return channelFromRelativePath(relative);
        } catch { return undefined; }
    }

    protected cachedWorkspaceChannel(root: URI): Promise<string | undefined> {
        const rootKey = root.toString();
        if (this.channelCache?.root !== rootKey) {
            this.channelCache = { root: rootKey, channel: this.readWorkspaceChannel(root) };
        }
        return this.channelCache.channel;
    }

    protected async renderCenter(): Promise<void> {
        const center = this.center;
        if (!center) { return; }
        const version = ++this.renderVersion;
        const root = (await this.workspace.roots)[0]?.resource;
        const opened = this.workspace.opened && !!root;
        const channel = opened ? await this.cachedWorkspaceChannel(root) : window.localStorage.getItem('akari.home.lastChannel') || undefined;
        if (version !== this.renderVersion) { return; }
        const project = opened ? Reflect.get(this.welcomeTitle, 'resolvedTitle') as string | null || root.path.base : undefined;
        const parts = titleBarCenter({ scope: opened ? 'project' : 'channel', channel, project, standalone: opened && !channel });
        const channelButton = document.createElement('button');
        channelButton.className = 'akari-title-channel';
        channelButton.type = 'button';
        channelButton.textContent = `${channel ? '◈ ' : ''}${parts[0]}`;
        channelButton.addEventListener('click', () => {
            if (this.commands.getCommand('akari.home.openProjectList')) { void this.commands.executeCommand('akari.home.openProjectList'); }
        });
        const nodes: HTMLElement[] = [channelButton];
        if (opened) {
            const separator = document.createElement('span');
            separator.className = 'akari-title-separator';
            separator.textContent = '›';
            const projectName = document.createElement('span');
            projectName.className = 'akari-title-project';
            projectName.textContent = parts[1];
            const dots = document.createElement('span');
            dots.className = 'akari-title-dots';
            stageDots(this.progress.stages).forEach((state, index) => {
                const dot = document.createElement('span');
                dot.className = `akari-title-dot ${state}`;
                dot.title = this.progress.stages?.[index]?.label || '';
                dots.appendChild(dot);
            });
            const busy = this.contextKeys.match('akari.partner.busy');
            const chip = document.createElement('span');
            chip.className = `akari-title-chip${busy ? ' busy' : this.pending ? ' pending' : ''}`;
            chip.textContent = savedChip({ pending: this.pending, busy });
            nodes.push(separator, projectName, dots, chip);
        }
        center.replaceChildren(...nodes);
    }

    protected renderControls(): void {
        if (!this.controls) { return; }
        const buttons = windowButtons(isOSX ? 'mac' : isWindows ? 'windows' : 'other', this.maximized);
        const handlers = [
            () => this.core.minimize(),
            () => this.maximized ? this.core.unMaximize() : this.core.maximize(),
            () => this.core.close()
        ];
        this.controls.replaceChildren(...buttons.map((label, index) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.title = label;
            button.setAttribute('aria-label', label);
            button.textContent = ['─', this.maximized ? '▢' : '□', '×'][index];
            button.addEventListener('click', handlers[index]);
            return button;
        }));
    }
}
