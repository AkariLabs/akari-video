import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution, FrontendApplication, WidgetManager, ApplicationShell, BaseWidget } from '@theia/core/lib/browser';
import { CommandService } from '@theia/core/lib/common';
import { Message } from '@theia/core/shared/@lumino/messaging';
import { TabBar, Widget } from '@theia/core/shared/@lumino/widgets';
import { resolveLeftPanelRestore } from './left-panel-order';

/** An activity bar button; the home page itself belongs to akari-surfaces. */
@injectable()
export class AkariHomeOpener extends BaseWidget {
    static readonly ID = 'akari-home-opener';
    @inject(CommandService) protected readonly commands!: CommandService;
    @inject(ApplicationShell) protected readonly shell!: ApplicationShell;

    protected lastSelectedId: string | undefined;
    protected wasCollapsed = true;

    @postConstruct()
    protected init(): void {
        this.id = AkariHomeOpener.ID;
        this.title.label = 'ホーム';
        this.title.caption = 'ホーム';
        this.title.iconClass = 'codicon codicon-home';
        this.title.closable = false;
    }

    watchLeftPanel(tabBar: TabBar<Widget>): void {
        const remember = () => {
            const id = tabBar.currentTitle?.owner.id;
            if (id === AkariHomeOpener.ID) { return; }
            this.wasCollapsed = !id;
            if (id) { this.lastSelectedId = id; }
        };
        remember();
        tabBar.currentChanged.connect(remember);
    }

    protected override onActivateRequest(_message: Message): void {
        // Layout restore or a command can select this tab without a pointer event.
        // Restore the previous side panel state synchronously before opening home.
        const tabBar = this.shell.leftPanelHandler.tabBar;
        if (tabBar.currentTitle?.owner.id === AkariHomeOpener.ID) {
            const id = resolveLeftPanelRestore(
                Array.from(tabBar.titles, title => title.owner.id), this.lastSelectedId, this.wasCollapsed
            );
            tabBar.currentTitle = id ? Array.from(tabBar.titles).find(title => title.owner.id === id) ?? null : null;
        }
        void this.commands.executeCommand('akari.home.open').catch(() => undefined);
    }
}

@injectable()
export class AkariHomeOpenerContribution implements FrontendApplicationContribution {
    @inject(WidgetManager) protected readonly widgetManager!: WidgetManager;

    async onStart(app: FrontendApplication): Promise<void> {
        const widget = await this.widgetManager.getOrCreateWidget<AkariHomeOpener>(AkariHomeOpener.ID);
        widget.watchLeftPanel(app.shell.leftPanelHandler.tabBar);
        if (!widget.isAttached) { await app.shell.addWidget(widget, { area: 'left', rank: 50 }); }
    }
}
